package api

import (
	"database/sql"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"

	"github.com/nexora/nexora/internal/audit"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/config"
	"github.com/nexora/nexora/internal/logger"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/storage"
)

// Server bundles dependencies for the HTTP API and static file server.
type Server struct {
	Cfg          *config.Config
	Log          *logger.Logger
	DB           *sql.DB
	Sessions     *auth.SessionStore
	Users        *auth.UserStore
	Audit        *audit.Store
	Guard        *auth.LoginGuard
	Limiter      *middleware.RateLimiter
	StorageRoots *storage.RootService
	WebRoot      string
}

// NewServer constructs the API server with its dependencies.
func NewServer(cfg *config.Config, log *logger.Logger, db *sql.DB, users *auth.UserStore, sessions *auth.SessionStore, audit *audit.Store, guard *auth.LoginGuard, limiter *middleware.RateLimiter, roots *storage.RootService) *Server {
	return &Server{
		Cfg:          cfg,
		Log:          log,
		DB:           db,
		Users:        users,
		Sessions:     sessions,
		Audit:        audit,
		Guard:        guard,
		Limiter:      limiter,
		StorageRoots: roots,
	}
}

// Routes builds the top-level HTTP handler.
func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()

	csrfExempt := []string{
		"/healthz", "/readyz",
		"/api/v1/auth/setup", "/api/v1/auth/login",
		"/api/v1/share", "/api/v1/csrf",
	}

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP(s.Cfg.TrustedProxies))
	r.Use(middleware.Recoverer(s.Log))
	r.Use(middleware.SecurityHeaders(s.Cfg))
	r.Use(middleware.CSRF(csrfExempt))
	r.Use(auth.SessionAuth(s.Sessions, s.Users))

	// Health endpoints (no auth).
	r.Get("/healthz", s.handleHealthz)
	r.Get("/readyz", s.handleReadyz)

	// Optional CORS (disabled by default).
	if len(s.Cfg.CORSOrigins) > 0 {
		r.Use(cors.Handler(cors.Options{
			AllowedOrigins:   s.Cfg.CORSOrigins,
			AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
			AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token", "X-Request-ID"},
			AllowCredentials: true,
			MaxAge:           300,
		}))
	}

	// Versioned API.
	api := chi.NewRouter()
	api.Get("/version", s.handleVersion)

	// Auth routes live under a single mount to avoid prefix collisions.
	authRouter := chi.NewRouter()
	authRouter.Post("/setup", s.handleSetup)
	authRouter.With(s.Limiter.RateLimit(middleware.KeyByClientIP())).Post("/login", s.handleLogin)
	authRouter.Get("/needs-setup", s.handleNeedsSetup)
	authRouter.Group(func(protected chi.Router) {
		protected.Use(auth.RequireAuth)
		protected.Get("/session", s.handleSession)
		protected.Post("/logout", s.handleLogout)
		protected.Post("/password", s.handleChangePassword)
	})
	api.Mount("/auth", authRouter)

	// Authenticated routes (everything else).
	authed := chi.NewRouter()
	authed.Use(auth.RequireAuth)
	authed.Get("/roots", s.handleListRoots)
	authed.Get("/files", s.handleListFiles)
	authed.Get("/files/stat", s.handleStatFile)
	authed.Post("/files/directory", s.handleCreateDir)
	authed.Post("/files/rename", s.handleRename)
	authed.Post("/files/move", s.handleMove)
	authed.Post("/files/copy", s.handleCopy)
	authed.Post("/files/file", s.handleCreateFile)
	authed.Delete("/files", s.handleDelete)
	authed.Post("/files/upload", s.handleUpload)
	authed.Get("/files/download", s.handleDownload)
	authed.Get("/files/raw", s.handleRaw)
	authed.Get("/trash", s.handleListTrash)
	authed.Post("/trash/restore", s.handleRestoreTrash)
	authed.Delete("/trash", s.handleDeleteTrash)

	// Admin-only routes.
	admin := chi.NewRouter()
	admin.Use(auth.RequireRole(auth.RoleAdmin))
	admin.Get("/roots", s.handleAdminListRoots)
	admin.Post("/roots", s.handleAdminCreateRoot)
	admin.Put("/roots/{id}", s.handleAdminUpdateRoot)
	admin.Delete("/roots/{id}", s.handleAdminDeleteRoot)
	admin.Get("/users", s.handleAdminListUsers)
	admin.Get("/audit", s.handleAdminListAudit)
	api.Mount("/admin", admin)

	api.Mount("/", authed)

	r.Mount("/api/v1", api)

	// Static UI + SPA fallback.
	r.NotFound(s.handleStatic)
	return r
}
