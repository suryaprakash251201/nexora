package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/config"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/storage"
	"github.com/nexora/nexora/internal/util"
)

type userDTO struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	Email        string `json:"email"`
	DisplayName  string `json:"display_name"`
	Role         string `json:"role"`
	Status       string `json:"status"`
	TOTPEnabled  bool   `json:"totp_enabled"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
}

func toUserDTO(u auth.User) userDTO {
	return userDTO{
		ID:           u.ID,
		Username:     u.Username,
		Email:        u.Email,
		DisplayName:  u.DisplayName,
		Role:         string(u.Role),
		Status:       u.Status,
		TOTPEnabled:  u.TOTPEnabled,
		CreatedAt:    u.CreatedAt,
		UpdatedAt:    u.UpdatedAt,
	}
}

type setupRequest struct {
	Username     string `json:"username"`
	Email        string `json:"email"`
	Password     string `json:"password"`
	DisplayName  string `json:"display_name"`
}

func (s *Server) handleSetup(w http.ResponseWriter, r *http.Request) {
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
		Username:    req.Username,
		Email:       req.Email,
		DisplayName: req.DisplayName,
		PasswordHash: hash,
		Role:        auth.RoleAdmin,
		Status:      "active",
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

	s.startSession(w, r, created.ID)
	_ = s.Audit.Record(created.ID, "setup", "system", "initial admin created", clientIP(r))
	writeJSON(w, http.StatusCreated, map[string]any{"user": toUserDTO(created)})
}

type loginRequest struct {
	Login    string `json:"login"`
	Password string `json:"password"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
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

	if locked, _ := s.Guard.IsLocked(loginKey(req.Login)); locked {
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
		backoff := s.Guard.RecordFailure(loginKey(req.Login))
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

	s.Guard.RecordSuccess(loginKey(req.Login))

	if user.TOTPEnabled {
		writeJSON(w, http.StatusOK, map[string]any{"totp_required": true, "user_id": user.ID})
		return
	}

	s.startSession(w, r, user.ID)
	_ = s.Audit.Record(user.ID, "login", user.Username, "successful login", ip)
	writeJSON(w, http.StatusOK, map[string]any{"user": toUserDTO(user)})
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
		SameSite: http.SameSiteLaxMode,
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
	var req struct {
		Login string `json:"login"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Login == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "login is required", middleware.GetRequestID(r.Context()))
		return
	}

	user, ok, err := s.Users.GetByLogin(req.Login)
	if err != nil || !ok {
		// Don't reveal whether the user exists.
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "If the account exists, a reset code has been generated."})
		return
	}

	raw := util.RandToken(24)
	sum := sha256.Sum256([]byte(raw))
	tokenHash := hex.EncodeToString(sum[:])
	expiresAt := time.Now().Add(15 * time.Minute).UTC().Format(time.RFC3339)

	if err := s.Users.CreateResetToken(user.ID, tokenHash, expiresAt); err != nil {
		s.Log.Error("failed to create reset token", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "could not generate reset code", middleware.GetRequestID(r.Context()))
		return
	}

	_ = s.Audit.Record(user.ID, "password_reset_requested", user.Username, "", clientIP(r))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "token": raw, "message": "Use this code to reset your password. It expires in 15 minutes."})
}

func (s *Server) handleResetPassword(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusBadRequest, "invalid_token", "Invalid or expired reset code", middleware.GetRequestID(r.Context()))
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
	s.startSession(w, r, user.ID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// TOTP handlers ------------------------------------------------------------

func (s *Server) handleTOTPSetup(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
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

	if !auth.VerifyTOTPCode(user.TOTPSecret, req.Code) {
		writeError(w, http.StatusBadRequest, "invalid_code", "Invalid verification code", middleware.GetRequestID(r.Context()))
		return
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

	if err := s.Users.UpdateTOTPSecret(user.ID, ""); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not disable TOTP", middleware.GetRequestID(r.Context()))
		return
	}
	if err := s.Users.UpdateTOTPEnabled(user.ID, false); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not disable TOTP", middleware.GetRequestID(r.Context()))
		return
	}

	_ = s.Audit.Record(user.ID, "totp_disabled", user.Username, "", clientIP(r))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleTOTPVerifyLogin(w http.ResponseWriter, r *http.Request) {
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

	user, ok, err := s.Users.GetByLogin(req.Login)
	if err != nil || !ok || !auth.VerifyPassword(req.Password, user.PasswordHash) {
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
		_ = s.Audit.Record(user.ID, "login_failed", user.Username, "invalid 2FA code", ip)
		writeError(w, http.StatusUnauthorized, "invalid_code", "Invalid authentication code", middleware.GetRequestID(r.Context()))
		return
	}

	s.startSession(w, r, user.ID)
	_ = s.Audit.Record(user.ID, "login", user.Username, "successful login (2FA)", ip)
	writeJSON(w, http.StatusOK, map[string]any{"user": toUserDTO(user)})
}

// startSession creates a session and sets the cookie.
func (s *Server) startSession(w http.ResponseWriter, r *http.Request, userID string) {
	sess, err := s.Sessions.Create(userID, clientIP(r), r.UserAgent())
	if err != nil {
		s.Log.Error("failed to create session", "error", err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     auth.SessionCookieName,
		Value:    sess.Token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.Cfg.SecureCookies,
		MaxAge:   int(s.Cfg.SessionLifetime.Seconds()),
	})
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

func loginKey(login string) string { return "login:" + login }

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
	return nil
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
