package api

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"

	"github.com/nexora/nexora/internal/audit"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/config"
	"github.com/nexora/nexora/internal/database"
	"github.com/nexora/nexora/internal/events"
	"github.com/nexora/nexora/internal/jobs"
	"github.com/nexora/nexora/internal/logger"
	"github.com/nexora/nexora/internal/metrics"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/playlists"
	"github.com/nexora/nexora/internal/preview"
	"github.com/nexora/nexora/internal/search"
	"github.com/nexora/nexora/internal/settings"
	"github.com/nexora/nexora/internal/sharing"
	"github.com/nexora/nexora/internal/storage"
)

// Server bundles dependencies for the HTTP API and static file server.
type Server struct {
	Cfg          *config.Config
	Log          *logger.Logger
	DB           *database.DB
	Sessions     *auth.SessionStore
	Tokens       *auth.TokenStore
	Users        *auth.UserStore
	Audit        *audit.Store
	Guard        *auth.LoginGuard
	Limiter      *middleware.RateLimiter
	StorageRoots *storage.RootService
	Search       *search.Service
	Shares       *sharing.Store
	Playlists    *playlists.Store
	Jobs         *jobs.Manager
	Preview      *preview.Service
	Metrics      *metrics.Registry
	Events       *events.Bus
	Settings     *settings.Store
	WebRoot      string
}

// Deps carries every dependency the API server needs. Passing a single struct
// (rather than positional arguments plus post-construction field assignment)
// forces the compiler to catch missing dependencies and prevents the kind of
// silent nil field that previously left the event bus unwired.
type Deps struct {
	Cfg       *config.Config
	Log       *logger.Logger
	DB        *database.DB
	Users     *auth.UserStore
	Sessions  *auth.SessionStore
	Tokens    *auth.TokenStore
	Audit     *audit.Store
	Guard     *auth.LoginGuard
	Limiter   *middleware.RateLimiter
	Roots     *storage.RootService
	Playlists *playlists.Store

	// Optional services; nil disables the feature.
	Search   *search.Service
	Shares   *sharing.Store
	Preview  *preview.Service
	Jobs     *jobs.Manager
	Metrics  *metrics.Registry
	Events   *events.Bus
	Settings *settings.Store
	WebRoot  string
}

// NewServer constructs the API server with its dependencies.
func NewServer(d Deps) *Server {
	return &Server{
		Cfg:          d.Cfg,
		Log:          d.Log,
		DB:           d.DB,
		Users:        d.Users,
		Sessions:     d.Sessions,
		Tokens:       d.Tokens,
		Audit:        d.Audit,
		Guard:        d.Guard,
		Limiter:      d.Limiter,
		StorageRoots: d.Roots,
		Playlists:    d.Playlists,
		Search:       d.Search,
		Shares:       d.Shares,
		Preview:      d.Preview,
		Jobs:         d.Jobs,
		Metrics:      d.Metrics,
		Events:       d.Events,
		Settings:     d.Settings,
		WebRoot:      d.WebRoot,
	}
}

// Routes builds the top-level HTTP handler.
func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()

	csrfExempt := []string{
		"/healthz", "/readyz",
		"/s3", // S3 gateway authenticates via AWS4 signature, not cookies
		"/api/v1/auth/setup", "/api/v1/auth/login",
		"/api/v1/auth/tailscale",
		"/api/v1/auth/forgot-password", "/api/v1/auth/reset-password",
		"/api/v1/auth/totp/verify-login",
		"/api/v1/share", "/api/v1/csrf",
	}

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP(s.Cfg.TrustedProxies))
	r.Use(middleware.Recoverer(s.Log))
	if s.Metrics != nil {
		r.Use(s.Metrics.HTTPMiddleware())
	}
	r.Use(middleware.SecurityHeaders(s.Cfg))
	r.Use(middleware.CSRF(csrfExempt, s.Cfg.SecureCookies))
	r.Use(auth.SessionAuth(s.Sessions, s.Users, s.Tokens))

	// CORS — origins come from NEXORA_CORS_ORIGINS (comma-separated) when set;
	// with an empty list the server falls back to allow-any-origin so desktop
	// (Tauri custom scheme) and Tailscale clients keep working out of the box.
	// Token-based auth (Authorization header) is used for cross-origin requests.
	// When configured, we echo the exact Origin header back (never "*") so
	// AllowCredentials works correctly on restrictive WebKit environments.
	allowedHeaders := []string{"Accept", "Content-Type", "X-CSRF-Token", "X-Request-ID", "Authorization", "X-Share-Password"}

	// CORS AllowOriginFunc reads s.Cfg live so admin edits to cors_origins
	// take effect without a process restart.
	r.Use(cors.Handler(cors.Options{
		AllowOriginFunc: func(_ *http.Request, origin string) bool {
			origins := s.Cfg.CORSOrigins
			if len(origins) == 0 {
				return true
			}
			for _, o := range origins {
				if strings.TrimSpace(o) == origin {
					return true
				}
			}
			// Also allow wildcard "*" if configured.
			for _, o := range origins {
				if strings.TrimSpace(o) == "*" {
					return true
				}
			}
			return false
		},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   allowedHeaders,
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Health endpoints (no auth).
	r.Get("/healthz", s.handleHealthz)
	r.Get("/readyz", s.handleReadyz)
	if s.Cfg.EnablePrometheus && s.Metrics != nil {
		r.Get("/metrics", s.Metrics.Handler())
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
	authRouter.With(s.Limiter.RateLimit(middleware.KeyByClientIP())).Post("/tailscale", s.handleTailscaleLogin)
	authRouter.With(s.Limiter.RateLimit(middleware.KeyByClientIP())).Post("/forgot-password", s.handleForgotPassword)
	authRouter.With(s.Limiter.RateLimit(middleware.KeyByClientIP())).Post("/reset-password", s.handleResetPassword)
	authRouter.With(s.Limiter.RateLimit(middleware.KeyByClientIP())).Post("/password", s.handleChangePassword)
	authRouter.Get("/needs-setup", s.handleNeedsSetup)
	authRouter.Get("/session", s.handleSession)
	authRouter.Group(func(protected chi.Router) {
		protected.Use(auth.RequireAuth)
		protected.Post("/logout", s.handleLogout)
		protected.Get("/sessions", s.handleListSessions)
		protected.Delete("/sessions/{id}", s.handleRevokeSession)
		protected.Post("/sessions/revoke-others", s.handleRevokeOtherSessions)
		protected.Get("/tokens", s.handleListTokens)
		protected.With(s.Limiter.RateLimit(middleware.KeyByClientIP())).Post("/tokens", s.handleCreateToken)
		protected.Delete("/tokens/{id}", s.handleRevokeToken)
		protected.Post("/password", s.handleChangePassword)
		protected.Post("/totp/setup", s.handleTOTPSetup)
		protected.Post("/totp/verify", s.handleTOTPVerify)
		protected.Post("/totp/disable", s.handleTOTPDisable)
	})
	authRouter.With(s.Limiter.RateLimit(middleware.KeyByClientIP())).Post("/totp/verify-login", s.handleTOTPVerifyLogin)
	api.Mount("/auth", authRouter)

	// Authenticated routes (everything else).
	authed := chi.NewRouter()
	authed.Use(auth.RequireAuth)
	authed.Get("/roots", s.handleListRoots)
	authed.Get("/files", s.handleListFiles)
	authed.Get("/files/stat", s.handleStatFile)
	authed.Get("/files/duplicates", s.handleFindDuplicates)
	authed.Get("/files/comments", s.listFileComments)
	// Resumable chunked uploads (large files).
	authed.Post("/files/uploads/init", s.handleUploadInit)
	authed.Put("/files/uploads/{id}/chunk", s.handleUploadChunk)
	authed.Get("/files/uploads/{id}/status", s.handleUploadStatus)
	authed.Post("/files/uploads/{id}/complete", s.handleUploadComplete)
	authed.Delete("/files/uploads/{id}", s.handleUploadCancel)
	authed.Post("/files/comments", s.createFileComment)
	authed.Delete("/files/comments/{id}", s.deleteFileComment)
	authed.Get("/stats", s.handleStorageStats)
	authed.Post("/files/directory", s.handleCreateDir)
	authed.Post("/files/rename", s.handleRename)
	authed.Post("/files/move", s.handleMove)
	authed.Post("/files/copy", s.handleCopy)
	authed.Post("/files/file", s.handleCreateFile)
	authed.Delete("/files", s.handleDelete)
	authed.Post("/files/upload", s.handleUpload)
	authed.Get("/files/download", s.handleDownload)
	authed.Get("/files/raw", s.handleRaw)
	authed.Get("/files/transcode", s.handleTranscode)
	authed.Get("/files/hls/playlist.m3u8", s.handleHLSPlaylist)
	authed.Get("/files/hls/segment.ts", s.handleHLSSegment)

	// Lossless audio metadata and server capabilities.
	authed.Get("/audio/info", s.handleAudioInfo)
	authed.Post("/audio/info/batch", s.handleAudioInfoBatch)
	authed.Get("/audio/formats", s.handleAudioFormats)
	authed.Get("/audio/lyrics", s.handleAudioLyrics)
	authed.Post("/audio/lyrics", s.handleSaveAudioLyrics)
	authed.Delete("/audio/lyrics", s.handleDeleteAudioLyrics)
	authed.Get("/trash", s.handleListTrash)
	authed.Post("/trash/restore", s.handleRestoreTrash)
	authed.Delete("/trash", s.handleDeleteTrash)

	// Previews, metadata, editor.
	authed.Get("/files/thumbnail", s.handleThumbnail)
	authed.Get("/files/checksum", s.handleChecksum)
	authed.Get("/files/metadata", s.handleMetadata)
	authed.Get("/files/content", s.handleGetContent)
	authed.Post("/files/save", s.handleSaveContent)

	// File versioning.
	authed.Get("/files/versions", s.handleListVersions)
	authed.Post("/files/versions", s.handleCreateVersion)
	authed.Get("/files/versions/{id}/download", s.handleDownloadVersion)
	authed.Post("/files/versions/{id}/restore", s.handleRestoreVersion)
	authed.Delete("/files/versions/{id}", s.handleDeleteVersion)

	// Search.
	authed.Get("/search", s.handleSearch)

	// Playlists.
	authed.Get("/playlists", s.handleListPlaylists)
	authed.Post("/playlists", s.handleCreatePlaylist)
	authed.Delete("/playlists/{id}", s.handleDeletePlaylist)
	authed.Put("/playlists/{id}", s.handleRenamePlaylist)
	authed.Post("/playlists/{id}/items", s.handleAddPlaylistItems)
	authed.Delete("/playlists/{id}/items", s.handleRemovePlaylistItem)
	authed.Put("/playlists/{id}/items/order", s.handleReorderPlaylistItems)
	authed.Patch("/playlists/{id}", s.handleUpdatePlaylist)
	authed.Get("/playlists/cover-config", s.handleCoverConfig)
	authed.Get("/playlists/public", s.handleListPublicPlaylists)
	authed.Post("/playlists/{id}/collaborators", s.handleManageCollaborators)
	authed.Get("/playlists/{id}/collaborators", s.handleListCollaborators)

	// User directory (collaborator picker).
	authed.Get("/users/search", s.handleUserSearch)

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
	authed.Get("/home", s.handleHome)
	authed.Get("/home/usage", s.handleHomeUsage)

	// Tags
	authed.Get("/tags", s.handleListTags)
	authed.Post("/tags", s.handleCreateTag)
	authed.Patch("/tags/{id}", s.handleUpdateTag)
	authed.Delete("/tags/{id}", s.handleDeleteTag)
	authed.Post("/files/tag", s.handleTagFile)
	authed.Delete("/files/tag", s.handleUntagFile)

	// Share links (authenticated management).

	authed.Get("/photos", s.handleGetPhotosTimeline)

	authed.Get("/saved-searches", s.handleListSavedSearches)
	authed.Post("/saved-searches", s.handleCreateSavedSearch)
	authed.Put("/saved-searches/{id}", s.handleUpdateSavedSearch)
	authed.Delete("/saved-searches/{id}", s.handleDeleteSavedSearch)

	// Webhooks
	authed.Get("/webhooks", s.handleListWebhooks)
	authed.Post("/webhooks", s.handleCreateWebhook)
	authed.Delete("/webhooks/{id}", s.handleDeleteWebhook)
	authed.Get("/saved-searches/{id}/execute", s.handleExecuteSavedSearch)
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
	admin.Get("/usage", s.handleAdminGetStorageUsage)
	admin.Get("/overview", s.handleAdminOverview)
	admin.Get("/backups", s.handleAdminListBackups)
	admin.Post("/backups", s.handleAdminCreateBackup)
	admin.Delete("/backups/{name}", s.handleAdminDeleteBackup)
	admin.Get("/settings", s.handleAdminGetSettings)
	admin.Put("/settings", s.handleAdminUpdateSettings)
	admin.Delete("/settings/{key}", s.handleAdminDeleteSetting)
	api.Mount("/admin", admin)

	api.Mount("/", authed)

	// S3-compatible gateway — buckets are storage roots, objects are files.
	// Auth: personal API tokens used as AWS4 access key + secret.
	s3Router := chi.NewRouter()
	s3Router.Use(s.s3AuthMiddleware)
	s3Router.Get("/", s.handleS3ListBuckets)
	s3Router.Get("/{bucket}", s.handleS3ListObjects)
	s3Router.Put("/{bucket}", s.handleS3PutBucket)
	s3Router.Delete("/{bucket}", s.handleS3DeleteBucket)
	s3Router.Get("/{bucket}/*", s.handleS3GetObject)
	s3Router.Head("/{bucket}/*", s.handleS3HeadObject)
	s3Router.Put("/{bucket}/*", s.handleS3PutObject)
	s3Router.Post("/{bucket}/*", s.handleS3PostObject)
	s3Router.Delete("/{bucket}/*", s.handleS3DeleteObject)
	r.Mount("/s3", s3Router)

	r.Mount("/api/v1", api)

	// Static UI + SPA fallback.
	r.NotFound(s.handleStatic)
	return middleware.Compress(r)
}
