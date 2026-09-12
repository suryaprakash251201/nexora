package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/config"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/storage"
	"github.com/nexora/nexora/internal/util"
)

type userDTO struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
	Status      string `json:"status"`
	TOTPEnabled bool   `json:"totp_enabled"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

func toUserDTO(u auth.User) userDTO {
	return userDTO{
		ID:          u.ID,
		Username:    u.Username,
		Email:       u.Email,
		DisplayName: u.DisplayName,
		Role:        string(u.Role),
		Status:      u.Status,
		TOTPEnabled: u.TOTPEnabled,
		CreatedAt:   u.CreatedAt,
		UpdatedAt:   u.UpdatedAt,
	}
}

type setupRequest struct {
	Username    string `json:"username"`
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
}

func (s *Server) handleSetup(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	needs, err := s.Users.NeedsSetup()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not check setup state", middleware.GetRequestID(r.Context()))
		return
	}
	if !needs {
		writeError(w, http.StatusConflict, "already_configured", "an administrator account already exists", middleware.GetRequestID(r.Context()))
		return
	}
	var req setupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "request body is not valid JSON", middleware.GetRequestID(r.Context()))
		return
	}
	if err := validateSignup(req.Username, req.Email, req.Password); err != nil {
		writeError(w, http.StatusBadRequest, "validation_error", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	if req.DisplayName == "" {
		req.DisplayName = req.Username
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not hash password", middleware.GetRequestID(r.Context()))
		return
	}
	admin := auth.User{
		Username:     req.Username,
		Email:        req.Email,
		DisplayName:  req.DisplayName,
		PasswordHash: hash,
		Role:         auth.RoleAdmin,
		Status:       "active",
	}
	created, err := s.Users.Create(admin)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not create admin account", middleware.GetRequestID(r.Context()))
		return
	}

	// Provision default storage roots and grant admin access.
	roots := configRootsToStorage(s.Cfg.DefaultRoots)
	if err := s.StorageRoots.EnsureDefaultRoots(roots, created.ID); err != nil {
		s.Log.Error("failed to provision default roots", "error", err)
	}

	token := s.startSession(w, r, created.ID)
	_ = s.Audit.Record(created.ID, "setup", "system", "initial admin created", clientIP(r))
	writeJSON(w, http.StatusCreated, map[string]any{"user": toUserDTO(created), "token": token})
}

type loginRequest struct {
	Login    string `json:"login"`
	Password string `json:"password"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "request body is not valid JSON", middleware.GetRequestID(r.Context()))
		return
	}
	if req.Login == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "login and password are required", middleware.GetRequestID(r.Context()))
		return
	}
	ip := clientIP(r)

	if locked, _ := s.Guard.IsLocked(loginKey(req.Login, ip)); locked {
		_ = s.Audit.Record("", "login_failed", req.Login, "account locked", ip)
		writeError(w, http.StatusTooManyRequests, "account_locked", "account temporarily locked, try again later", middleware.GetRequestID(r.Context()))
		return
	}

	user, ok, err := s.Users.GetByLogin(req.Login)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "authentication error", middleware.GetRequestID(r.Context()))
		return
	}
	if !ok || !auth.VerifyPassword(req.Password, user.PasswordHash) {
		backoff := s.Guard.RecordFailure(loginKey(req.Login, ip))
		_ = s.Audit.Record("", "login_failed", req.Login, "invalid credentials", ip)
		if s.Metrics != nil {
			s.Metrics.IncLoginFailure()
		}
		if backoff > 0 {
			writeError(w, http.StatusTooManyRequests, "account_locked", "too many failures, account locked briefly", middleware.GetRequestID(r.Context()))
		} else {
			writeError(w, http.StatusUnauthorized, "invalid_credentials", "invalid username or password", middleware.GetRequestID(r.Context()))
		}
		return
	}
	if user.Status != "active" {
		_ = s.Audit.Record(user.ID, "login_failed", user.Username, "account disabled", ip)
		writeError(w, http.StatusForbidden, "account_disabled", "this account is disabled", middleware.GetRequestID(r.Context()))
		return
	}

	s.Guard.RecordSuccess(loginKey(req.Login, ip))

	if user.TOTPEnabled {
		writeJSON(w, http.StatusOK, map[string]any{"totp_required": true, "user_id": user.ID})
		return
	}

	token := s.startSession(w, r, user.ID)
	_ = s.Audit.Record(user.ID, "login", user.Username, "successful login", ip)
	writeJSON(w, http.StatusOK, map[string]any{"user": toUserDTO(user), "token": token})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	user, _ := auth.UserFromContext(r.Context())
	if c, err := r.Cookie(auth.SessionCookieName); err == nil {
		_ = s.Sessions.Delete(c.Value)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     auth.SessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   s.Cfg.SecureCookies,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   -1,
	})
	if user.ID != "" {
		_ = s.Audit.Record(user.ID, "logout", user.Username, "", clientIP(r))
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleSession(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"user": nil})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": toUserDTO(user)})
}

func (s *Server) handleNeedsSetup(w http.ResponseWriter, r *http.Request) {
	needs, err := s.Users.NeedsSetup()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not check setup", middleware.GetRequestID(r.Context()))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"configured": !needs})
}

type changePasswordRequest struct {
	Current string `json:"current"`
	New     string `json:"new"`
}

func (s *Server) handleForgotPassword(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		Login string `json:"login"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Login) == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "login is required", middleware.GetRequestID(r.Context()))
		return
	}
	req.Login = strings.TrimSpace(req.Login)
	ip := clientIP(r)

	// Per-account throttle: at most LockoutAttempts reset codes per window.
	// Without this, anyone who knows a login can mint an unbounded number of
	// live reset tokens (and — since there is no mail channel and the code
	// is returned in the response — probe the endpoint freely).
	if s.Guard != nil {
		if locked, _ := s.Guard.IsLocked("pwdreset:" + strings.ToLower(req.Login)); locked {
			_ = s.Audit.Record("", "password_reset_throttled", req.Login, "", ip)
			writeError(w, http.StatusTooManyRequests, "too_many_attempts",
				"too many reset attempts; try again later", middleware.GetRequestID(r.Context()))
			return
		}
	}

	user, ok, err := s.Users.GetByLogin(req.Login)
	if err != nil || !ok {
		// Don't reveal whether the user exists.
		if s.Guard != nil {
			_ = s.Guard.RecordFailure("pwdreset:" + strings.ToLower(req.Login))
		}
		// Constant-time delay to prevent timing-based user enumeration.
		time.Sleep(200 * time.Millisecond)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "If the account exists, a reset code has been generated."})
		return
	}

	raw := util.RandToken(24)
	sum := sha256.Sum256([]byte(raw))
	tokenHash := hex.EncodeToString(sum[:])
	expiresAt := time.Now().Add(15 * time.Minute).UTC().Format(time.RFC3339)

	// Single active token per user: invalidate older codes so a leaked
	// earlier code cannot be replayed after a newer one was issued.
	_ = s.Users.DeleteResetTokensForUser(user.ID)
	if err := s.Users.CreateResetToken(user.ID, tokenHash, expiresAt); err != nil {
		s.Log.Error("failed to create reset token", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "could not generate reset code", middleware.GetRequestID(r.Context()))
		return
	}
	if s.Guard != nil {
		_ = s.Guard.RecordFailure("pwdreset:" + strings.ToLower(req.Login))
	}

	_ = s.Audit.Record(user.ID, "password_reset_requested", user.Username, "", ip)
	// NOTE: the raw code is returned in the response because Nexora has no
	// mail channel. Treat this endpoint as sensitive: it is rate-limited
	// per IP, throttled per account, and only one code is valid at a time.
	// Deployments that expose the API publicly should front it with an
	// additional proxy-level limit.
	time.Sleep(200 * time.Millisecond)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "token": raw, "message": "Use this code to reset your password. It expires in 15 minutes."})
}

func (s *Server) handleResetPassword(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "request body is not valid JSON", middleware.GetRequestID(r.Context()))
		return
	}
	if req.Token == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "token and password are required", middleware.GetRequestID(r.Context()))
		return
	}
	if err := validatePassword(req.Password); err != nil {
		writeError(w, http.StatusBadRequest, "validation_error", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}

	sum := sha256.Sum256([]byte(req.Token))
	tokenHash := hex.EncodeToString(sum[:])

	userID, err := s.Users.ConsumeResetToken(tokenHash)
	if err != nil {
		// Surface "expired" as a distinct error code so the web client can
		// tell the user to request a new code (vs. a typo'd one). A
		// non-Expiry sql.ErrNoRows falls through to the generic
		// "invalid_token" path.
		if errors.Is(err, auth.ErrResetExpired) {
			// Never log token material, not even a prefix: prefixes of a
			// low-entropy code shrink the search space for anyone with log access.
			_ = s.Audit.Record("", "password_reset_failed", "[redacted]", "expired", clientIP(r))
			writeError(w, http.StatusBadRequest, "token_expired", "This reset code has expired — please request a new one", middleware.GetRequestID(r.Context()))
			return
		}
		_ = s.Audit.Record("", "password_reset_failed", "[redacted]", "invalid", clientIP(r))
		writeError(w, http.StatusBadRequest, "invalid_token", "Invalid reset code", middleware.GetRequestID(r.Context()))
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not hash password", middleware.GetRequestID(r.Context()))
		return
	}
	if err := s.Users.UpdatePassword(userID, hash); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not update password", middleware.GetRequestID(r.Context()))
		return
	}
	_ = s.Sessions.DeleteAllForUser(userID)
	_ = s.Audit.Record(userID, "password_reset", "", "", clientIP(r))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "Password has been reset. You can now log in."})
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	var req changePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "request body is not valid JSON", middleware.GetRequestID(r.Context()))
		return
	}
	if !auth.VerifyPassword(req.Current, user.PasswordHash) {
		writeError(w, http.StatusBadRequest, "invalid_credentials", "current password is incorrect", middleware.GetRequestID(r.Context()))
		return
	}
	if err := validatePassword(req.New); err != nil {
		writeError(w, http.StatusBadRequest, "validation_error", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	hash, err := auth.HashPassword(req.New)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not hash password", middleware.GetRequestID(r.Context()))
		return
	}
	if err := s.Users.UpdatePassword(user.ID, hash); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not update password", middleware.GetRequestID(r.Context()))
		return
	}
	// Revoke other sessions for safety.
	_ = s.Sessions.DeleteAllForUser(user.ID)
	_ = s.Audit.Record(user.ID, "password_change", user.Username, "", clientIP(r))
	token := s.startSession(w, r, user.ID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "token": token})
}

// TOTP handlers ------------------------------------------------------------

func (s *Server) handleTOTPSetup(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	// Refuse to overwrite an active second factor: without this, any
	// hijacked session could silently replace the victim's TOTP secret
	// (the setup response contains the new QR) and lock them out. Users
	// must disable (password-confirmed) before re-enrolling.
	if user.TOTPEnabled {
		writeError(w, http.StatusConflict, "totp_already_enabled", "Two-factor authentication is already enabled — disable it first to re-enroll", middleware.GetRequestID(r.Context()))
		return
	}

	setup, err := auth.GenerateTOTPSetup(user.Username, "Nexora")
	if err != nil {
		s.Log.Error("failed to generate TOTP setup", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "could not generate TOTP secret", middleware.GetRequestID(r.Context()))
		return
	}

	if err := s.Users.UpdateTOTPSecret(user.ID, setup.Secret); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not save TOTP secret", middleware.GetRequestID(r.Context()))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"secret": setup.Secret,
		"uri":    setup.URI,
		"qr":     setup.QR,
	})
}

func (s *Server) handleTOTPVerify(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	var req struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "request body is not valid JSON", middleware.GetRequestID(r.Context()))
		return
	}

	// Throttle enrollment-code guessing: the 6-digit space is small and
	// this endpoint is reachable with only a (possibly hijacked) session.
	totpKey := "totp-enroll:" + user.ID
	if s.Guard != nil {
		if locked, _ := s.Guard.IsLocked(totpKey); locked {
			writeError(w, http.StatusTooManyRequests, "too_many_attempts",
				"too many failed attempts; try again later", middleware.GetRequestID(r.Context()))
			return
		}
	}

	if !auth.VerifyTOTPCode(user.TOTPSecret, req.Code) {
		if s.Guard != nil {
			_ = s.Guard.RecordFailure(totpKey)
		}
		writeError(w, http.StatusBadRequest, "invalid_code", "Invalid verification code", middleware.GetRequestID(r.Context()))
		return
	}
	if s.Guard != nil {
		s.Guard.RecordSuccess(totpKey)
	}

	if err := s.Users.UpdateTOTPEnabled(user.ID, true); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not enable TOTP", middleware.GetRequestID(r.Context()))
		return
	}

	_ = s.Audit.Record(user.ID, "totp_enabled", user.Username, "", clientIP(r))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleTOTPDisable(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "request body is not valid JSON", middleware.GetRequestID(r.Context()))
		return
	}

	if !auth.VerifyPassword(req.Password, user.PasswordHash) {
		writeError(w, http.StatusBadRequest, "invalid_credentials", "password is incorrect", middleware.GetRequestID(r.Context()))
		return
	}

	if err := s.Users.DisableTOTP(user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not disable TOTP", middleware.GetRequestID(r.Context()))
		return
	}

	_ = s.Audit.Record(user.ID, "totp_disabled", user.Username, "", clientIP(r))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleTOTPVerifyLogin(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		Login    string `json:"login"`
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "request body is not valid JSON", middleware.GetRequestID(r.Context()))
		return
	}

	ip := clientIP(r)

	// Per-account+IP lockout (same key as the password step) so a
	// brute-force attack on the 6-digit TOTP code is rate-limited even
	// when the attacker already has valid credentials. Without this, the
	// IP-based limiter allows ~1000 attempts/min/account and the TOTP
	// space (10^6) is exhausted in a few hours.
	if s.Guard != nil {
		if locked, _ := s.Guard.IsLocked(loginKey(req.Login, ip)); locked {
			writeError(w, http.StatusTooManyRequests, "too_many_attempts",
				"too many failed attempts; try again later", middleware.GetRequestID(r.Context()))
			return
		}
	}

	user, ok, err := s.Users.GetByLogin(req.Login)
	if err != nil || !ok || !auth.VerifyPassword(req.Password, user.PasswordHash) {
		if s.Guard != nil {
			_ = s.Guard.RecordFailure(loginKey(req.Login, ip))
		}
		_ = s.Audit.Record("", "login_failed", req.Login, "invalid credentials (2FA step)", ip)
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "invalid credentials", middleware.GetRequestID(r.Context()))
		return
	}
	if user.Status != "active" {
		writeError(w, http.StatusForbidden, "account_disabled", "this account is disabled", middleware.GetRequestID(r.Context()))
		return
	}
	if !user.TOTPEnabled {
		writeError(w, http.StatusBadRequest, "totp_not_enabled", "TOTP is not enabled for this account", middleware.GetRequestID(r.Context()))
		return
	}
	if !auth.VerifyTOTPCode(user.TOTPSecret, req.Code) {
		if s.Guard != nil {
			_ = s.Guard.RecordFailure(loginKey(req.Login, ip))
		}
		_ = s.Audit.Record(user.ID, "login_failed", user.Username, "invalid 2FA code", ip)
		writeError(w, http.StatusUnauthorized, "invalid_code", "Invalid authentication code", middleware.GetRequestID(r.Context()))
		return
	}
	if s.Guard != nil {
		s.Guard.RecordSuccess(loginKey(req.Login, ip))
	}

	token := s.startSession(w, r, user.ID)
	_ = s.Audit.Record(user.ID, "login", user.Username, "successful login (2FA)", ip)
	writeJSON(w, http.StatusOK, map[string]any{"user": toUserDTO(user), "token": token})
}

// Tailscale login --------------------------------------------------------

func (s *Server) handleTailscaleLogin(w http.ResponseWriter, r *http.Request) {
	if !s.Cfg.TailscaleAuth {
		writeError(w, http.StatusForbidden, "tailscale_auth_disabled", "Tailscale authentication is not enabled", middleware.GetRequestID(r.Context()))
		return
	}

	// The Tailscale identity headers are plain HTTP headers: anyone who can
	// reach the listener can forge them. Only honor them when the TCP peer
	// is the local Tailscale sidecar (loopback) or an explicitly trusted
	// reverse proxy that strips client-supplied values and re-injects them.
	if !tailscalePeerAllowed(r, s.Cfg.TrustedProxies) {
		_ = s.Audit.Record("", "tailscale_rejected", "", "untrusted peer", clientIP(r))
		writeError(w, http.StatusForbidden, "tailscale_untrusted_peer",
			"Tailscale identity is only accepted from the local tailnet sidecar or a trusted proxy", middleware.GetRequestID(r.Context()))
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	tailscaleUser := r.Header.Get("Tailscale-User-Login") // header injected by Tailscale Serve
	if tailscaleUser == "" {
		tailscaleUser = r.Header.Get("Tailscale-User") // fallback for Caddy-style proxies
	}
	tailscaleUser = strings.TrimSpace(tailscaleUser)
	if !validTailscaleIdentity(tailscaleUser) {
		writeError(w, http.StatusUnauthorized, "tailscale_user_missing", "Tailscale identity header not found — ensure you're accessing via Tailscale", middleware.GetRequestID(r.Context()))
		return
	}

	// tailscaleUser is an email like "user@domain" or "user@github"
	user, exists, err := s.Users.GetByLogin(tailscaleUser)
	if err != nil {
		s.Log.Error("failed to look up tailscale user", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "authentication error", middleware.GetRequestID(r.Context()))
		return
	}

	if !exists {
		// Auto-provision a new user from Tailscale identity.
		// Username is the part before @; role defaults to "user".
		parts := strings.SplitN(tailscaleUser, "@", 2)
		username := sanitizeTailscaleUsername(parts[0])
		if username == "" {
			username = sanitizeTailscaleUsername(tailscaleUser)
		}
		if username == "" {
			writeError(w, http.StatusBadRequest, "tailscale_user_invalid", "Tailscale identity cannot be mapped to a username", middleware.GetRequestID(r.Context()))
			return
		}
		user = auth.User{
			Username:    username,
			Email:       tailscaleUser,
			DisplayName: tailscaleUser,
			Role:        auth.RoleUser,
			Status:      "active",
			// No password — Tailscale identity replaces it.
		}
		created, err := s.Users.Create(user)
		if err != nil {
			s.Log.Error("failed to create user from tailscale identity", "error", err)
			writeError(w, http.StatusInternalServerError, "internal_error", "could not create user", middleware.GetRequestID(r.Context()))
			return
		}
		user = created
		s.Log.Info("auto-provisioned user from tailscale", "email", tailscaleUser, "id", user.ID, "username", user.Username)
	}

	if user.Status != "active" {
		writeError(w, http.StatusForbidden, "account_disabled", "this account is disabled", middleware.GetRequestID(r.Context()))
		return
	}

	token := s.startSession(w, r, user.ID)
	_ = s.Audit.Record(user.ID, "tailscale_login", user.Username, "logged in via Tailscale", clientIP(r))
	writeJSON(w, http.StatusOK, map[string]any{"user": toUserDTO(user), "token": token})
}

// startSession creates a session and sets the cookie.
func (s *Server) startSession(w http.ResponseWriter, r *http.Request, userID string) string {
	sess, err := s.Sessions.Create(userID, clientIP(r), r.UserAgent())
	if err != nil {
		s.Log.Error("failed to create session", "error", err)
		return ""
	}
	http.SetCookie(w, &http.Cookie{
		Name:     auth.SessionCookieName,
		Value:    sess.Token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   s.Cfg.SecureCookies,
		MaxAge:   int(s.Cfg.SessionLifetime.Seconds()),
		Expires:  sess.ExpiresAt,
	})
	return sess.Token
}

func configRootsToStorage(in []config.RootConfig) []storage.Root {
	out := make([]storage.Root, 0, len(in))
	for _, c := range in {
		out = append(out, storage.Root{
			Name:     c.Name,
			Path:     c.Path,
			ReadOnly: c.ReadOnly,
			Enabled:  true,
			Indexed:  c.Indexed,
		})
	}
	return out
}

// loginKey scopes brute-force tracking to an account AND a client IP.
//
// A per-account-only key lets any remote attacker hard-lock a victim's
// account (lockout DoS). Keying by account+IP keeps the backoff effective
// against single-source guessing while one attacker's failures can no
// longer lock the legitimate user out from their own network. Distributed
// guessing across many IPs is still bounded by the per-IP rate limiter.
func loginKey(login, ip string) string {
	return "login:" + strings.ToLower(strings.TrimSpace(login)) + "|" + strings.TrimSpace(ip)
}

// tailscalePeerAllowed reports whether the TCP peer of r is allowed to
// assert a Tailscale identity: loopback (local `tailscale serve` sidecar)
// or a CIDR from the trusted-proxies list. It deliberately inspects
// RemoteAddr — not the resolved client IP — because X-Forwarded-For is
// attacker-controlled whenever the peer itself is untrusted.
func tailscalePeerAllowed(r *http.Request, trusted []string) bool {
	host := r.RemoteAddr
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.TrimSpace(host)
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return true
	}
	for _, c := range trusted {
		c = strings.TrimSpace(c)
		if c == "" {
			continue
		}
		if !strings.Contains(c, "/") {
			if c == host {
				return true
			}
			continue
		}
		if _, ipnet, err := net.ParseCIDR(c); err == nil && ipnet.Contains(net.ParseIP(host)) {
			return true
		}
	}
	return false
}

// validTailscaleIdentity rejects empty, oversized, or control-character
// laden identity headers (header-injection / log-forging hardening).
func validTailscaleIdentity(v string) bool {
	if v == "" || len(v) > 254 {
		return false
	}
	for _, c := range v {
		if c < 0x20 || c == 0x7f {
			return false
		}
	}
	return true
}

// sanitizeTailscaleUsername maps an identity fragment to a safe username:
// lowercase alphanumerics plus . _ -, 3–64 chars. Anything else yields ""
// so the caller can reject instead of persisting attacker-shaped names.
func sanitizeTailscaleUsername(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	for _, c := range s {
		if c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '.' || c == '_' || c == '-' {
			b.WriteRune(c)
		}
	}
	out := strings.Trim(b.String(), "._-")
	if len(out) < 3 || len(out) > 64 {
		return ""
	}
	return out
}

func clientIP(r *http.Request) string { return middleware.GetClientIP(r.Context()) }

func validateSignup(username, email, password string) error {
	if username == "" || len(username) < 3 {
		return fmt.Errorf("username must be at least 3 characters")
	}
	if !emailLooksValid(email) {
		return fmt.Errorf("a valid email is required")
	}
	return validatePassword(password)
}

func validatePassword(pw string) error {
	if len(pw) < 8 {
		return fmt.Errorf("password must be at least 8 characters")
	}
	if len(pw) > 256 {
		return fmt.Errorf("password is too long")
	}
	// Require a mix of letters and digits so trivial passwords like
	// "password" or "aaaaaaaa" are rejected even at 8+ characters.
	var hasLetter, hasDigit bool
	for _, c := range pw {
		switch {
		case c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z':
			hasLetter = true
		case c >= '0' && c <= '9':
			hasDigit = true
		}
	}
	if !hasLetter || !hasDigit {
		return fmt.Errorf("password must contain both letters and numbers")
	}
	if commonPasswords[strings.ToLower(pw)] {
		return fmt.Errorf("password is too common, choose a less predictable one")
	}
	return nil
}

// commonPasswords is a short denylist of the most abused passwords. It is
// not a substitute for a breach-corpus check, but it blocks the guesses
// that succeed first in credential-stuffing attacks.
var commonPasswords = map[string]bool{
	"password1": true, "password12": true, "password123": true,
	"qwerty123": true, "abc12345": true, "12345678": true,
	"letmein1": true, "welcome1": true, "admin123": true,
	"nexora123": true, "changeme1": true, "monkey123": true,
	"dragon123": true, "master123": true, "sunshine1": true,
	"football1": true, "iloveyou1": true, "trustno1": true,
}

func emailLooksValid(email string) bool {
	at := 0
	for i, c := range email {
		if c == '@' {
			at = i
		}
	}
	return at > 0 && at < len(email)-1 && email[len(email)-1] != '@'
}

// ---- Session management (user's own sessions) ----

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "login required", middleware.GetRequestID(r.Context()))
		return
	}
	sessions, err := s.Sessions.ListForUser(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	currentID := s.currentSessionID(r)
	out := make([]map[string]any, 0, len(sessions))
	for _, m := range sessions {
		out = append(out, map[string]any{
			"id": m.ID, "ip": m.IP, "user_agent": m.UserAgent,
			"created_at": m.CreatedAt, "expires_at": m.ExpiresAt,
			"is_current": m.ID == currentID,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

func (s *Server) handleRevokeSession(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "login required", middleware.GetRequestID(r.Context()))
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "missing session id", middleware.GetRequestID(r.Context()))
		return
	}
	if id == s.currentSessionID(r) {
		writeError(w, http.StatusBadRequest, "bad_request", "use logout to end the current session", middleware.GetRequestID(r.Context()))
		return
	}
	if err := s.Sessions.DeleteByID(id, user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	_ = s.Audit.Record(user.ID, "session.revoke", user.Username, id, clientIP(r))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleRevokeOtherSessions(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "login required", middleware.GetRequestID(r.Context()))
		return
	}
	currentID := s.currentSessionID(r)
	if currentID == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "no current session", middleware.GetRequestID(r.Context()))
		return
	}
	n, err := s.Sessions.DeleteOthersForUser(user.ID, currentID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	_ = s.Audit.Record(user.ID, "session.revoke_others", user.Username, fmt.Sprintf("%d", n), clientIP(r))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "revoked": n})
}

// currentSessionID resolves the caller's own session id from its cookie.
func (s *Server) currentSessionID(r *http.Request) string {
	c, err := r.Cookie(auth.SessionCookieName)
	if err != nil || c.Value == "" {
		return ""
	}
	if sess, ok := s.Sessions.Lookup(c.Value); ok {
		return sess.ID
	}
	return ""
}

// ---- Personal API tokens ----

func (s *Server) handleListTokens(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	items, err := s.Tokens.List(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCreateToken(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	var body struct {
		Name          string `json:"name"`
		ExpiresInDays int    `json:"expires_in_days"` // 0 = never
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		body.Name = ""
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = "api-token"
	}
	if len(name) > 80 {
		name = name[:80]
	}
	expires := time.Time{}
	if body.ExpiresInDays > 0 && body.ExpiresInDays <= 3650 {
		expires = time.Now().AddDate(0, 0, body.ExpiresInDays)
	}
	raw, err := s.Tokens.Create(user.ID, name, expires)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	_ = s.Audit.Record(user.ID, "token.create", user.Username, name, clientIP(r))
	writeJSON(w, http.StatusCreated, map[string]any{"token": raw})
}

func (s *Server) handleRevokeToken(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "missing token id", middleware.GetRequestID(r.Context()))
		return
	}
	if err := s.Tokens.Delete(id, user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	_ = s.Audit.Record(user.ID, "token.revoke", user.Username, id, clientIP(r))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
