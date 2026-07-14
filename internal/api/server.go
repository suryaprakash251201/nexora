package api

import (
	"database/sql"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"

	"github.com/nexora/nexora/internal/audit"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/config"
	"github.com/nexora/nexora/internal/jobs"
	"github.com/nexora/nexora/internal/logger"
	"github.com/nexora/nexora/internal/metrics"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/preview"
	"github.com/nexora/nexora/internal/search"
	"github.com/nexora/nexora/internal/sharing"
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
	Search       *search.Service
	Shares       *sharing.Store
	Jobs         *jobs.Manager
	Preview      *preview.Service
	Metrics      *metrics.Registry
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
	if s.Metrics != nil {
		r.Use(s.Metrics.HTTPMiddleware())
	}
	r.Use(middleware.SecurityHeaders(s.Cfg))
	r.Use(middleware.CSRF(csrfExempt))
	r.Use(auth.SessionAuth(s.Sessions, s.Users))

	// Health endpoints (no auth).
	r.Get("/healthz", s.handleHealthz)
	r.Get("/readyz", s.handleReadyz)
	if s.Cfg.EnablePrometheus && s.Metrics != nil {
		r.Get("/metrics", s.Metrics.Handler())
	}

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

	// Public share endpoints (no auth; rate-limited).
	shareRouter := chi.NewRouter()
	shareRouter.With(s.Limiter.RateLimit(middleware.KeyByClientIP())).Get("/{token}", s.handleSharePublicInfo)
	shareRouter.With(s.Limiter.RateLimit(middleware.KeyByClientIP())).Post("/{token}/verify", s.handleSharePublicVerify)
	shareRouter.With(s.Limiter.RateLimit(middleware.KeyByClientIP())).Get("/{token}/download", s.handleSharePublicDownload)
	shareRouter.With(s.Limiter.RateLimit(middleware.KeyByClientIP())).Get("/{token}/raw", s.handleSharePublicRaw)
	api.Mount("/share", shareRouter)

	// Auth routes live under a single mount to avoid prefix collisions.
	authRouter := chi.NewRouter()
	authRouter.Post("/setup", s.handleSetup)
	authRouter.With(s.Limiter.RateLimit(middleware.KeyByClientIP())).Post("/login", s.handleLogin)
	authRouter.Get("/needs-setup", s.handleNeedsSetup)
	authRouter.Get("/session", s.handleSession)
	authRouter.Group(func(protected chi.Router) {
		protected.Use(auth.RequireAuth)
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

	// Previews, metadata, editor.
	authed.Get("/files/thumbnail", s.handleThumbnail)
	authed.Get("/files/checksum", s.handleChecksum)
	authed.Get("/files/metadata", s.handleMetadata)
	authed.Get("/files/content", s.handleGetContent)
	authed.Post("/files/save", s.handleSaveContent)

	// Search.
	authed.Get("/search", s.handleSearch)

	// Archive / extract jobs.
	authed.Post("/archive", s.handleCreateArchive)
	authed.Post("/extract", s.handleExtract)
	authed.Get("/jobs", s.handleListJobs)
	authed.Get("/jobs/{id}", s.handleGetJob)
	authed.Get("/jobs/{id}/events", s.handleJobEvents)
	authed.Get("/jobs/{id}/download", s.handleDownloadArchive)

	// Favorites & recents.
	authed.Get("/favorites", s.handleListFavorites)
	authed.Post("/favorites", s.handleAddFavorite)
	authed.Delete("/favorites", s.handleRemoveFavorite)
	authed.Get("/recents", s.handleListRecents)

	// Share links (authenticated management).
	authed.Get("/shares", s.handleListShares)
	authed.Post("/shares", s.handleCreateShare)
	authed.Delete("/shares/{id}", s.handleRevokeShare)

	// Admin-only routes.
	admin := chi.NewRouter()
	admin.Use(auth.RequireRole(auth.RoleAdmin))
	admin.Get("/roots", s.handleAdminListRoots)
	admin.Post("/roots", s.handleAdminCreateRoot)
	admin.Put("/roots/{id}", s.handleAdminUpdateRoot)
	admin.Delete("/roots/{id}", s.handleAdminDeleteRoot)
	admin.Get("/users", s.handleAdminListUsers)
	admin.Post("/users", s.handleAdminCreateUser)
	admin.Put("/users/{id}", s.handleAdminUpdateUser)
	admin.Delete("/users/{id}", s.handleAdminDeleteUser)
	admin.Get("/users/{id}/roots", s.handleAdminGetUserRoots)
	admin.Post("/users/{id}/roots", s.handleAdminGrantRoot)
	admin.Delete("/users/{id}/roots/{rootId}", s.handleAdminRevokeRoot)
	admin.Get("/audit", s.handleAdminListAudit)
	admin.Post("/search/reindex", s.handleAdminReindex)
	api.Mount("/admin", admin)

	api.Mount("/", authed)

	r.Mount("/api/v1", api)

	// Static UI + SPA fallback.
	r.NotFound(s.handleStatic)
	return r
}
