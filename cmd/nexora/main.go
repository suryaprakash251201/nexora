// Command nexora is the main server process for the Nexora file workspace.
package main

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/nexora/nexora/internal/api"
	"github.com/nexora/nexora/internal/audit"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/config"
	"github.com/nexora/nexora/internal/database"
	"github.com/nexora/nexora/internal/jobs"
	"github.com/nexora/nexora/internal/logger"
	"github.com/nexora/nexora/internal/metrics"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/preview"
	"github.com/nexora/nexora/internal/search"
	"github.com/nexora/nexora/internal/sharing"
	"github.com/nexora/nexora/internal/storage"
	"github.com/nexora/nexora/internal/util"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config error: %v\n", err)
		os.Exit(1)
	}
	if err := cfg.Validate(); err != nil {
		fmt.Fprintf(os.Stderr, "config invalid: %v\n", err)
		os.Exit(1)
	}

	log := logger.New(cfg.LogLevel, "nexora")
	log.Info("starting nexora", "version", api.Version, "listen", cfg.ListenAddr)

	db, err := database.Open(cfg.DatabasePath)
	if err != nil {
		log.Error("failed to open database", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := ensureSessionSecret(db, cfg, log); err != nil {
		log.Error("failed to ensure session secret", "error", err)
	}

	users := auth.NewUserStore(db)
	sessions := auth.NewSessionStore(db, cfg.SessionLifetime)
	auditStore := audit.NewStore(db)
	guard := auth.NewLoginGuard(cfg.LockoutAttempts, cfg.LockoutWindow)
	limiter := middleware.NewRateLimiter(cfg.RateLimitPerMin, cfg.LockoutWindow)
	roots := storage.NewRootService(db)
	searchSvc := search.NewService(db, roots, log)
	shareStore := sharing.NewStore(db)
	previewSvc := preview.NewService(cfg.ThumbnailCacheDir, cfg.ThumbnailMaxSize, cfg.ThumbnailTTL)
	jobMgr := jobs.NewManager(db, roots, log, filepath.Join(cfg.DataDir, "cache", "archives"), 2)
	defer jobMgr.Stop()

	var reg *metrics.Registry
	if cfg.EnablePrometheus {
		reg = metrics.New()
		reg.SetGauge("nexora_active_jobs", func() float64 { return float64(jobMgr.ActiveCount()) })
		reg.SetGauge("nexora_search_indexed", func() float64 {
			_, _, n := searchSvc.Status()
			return float64(n)
		})
	}

	srv := api.NewServer(cfg, log, db, users, sessions, auditStore, guard, limiter, roots)
	srv.Search = searchSvc
	srv.Shares = shareStore
	srv.Preview = previewSvc
	srv.Jobs = jobMgr
	srv.Metrics = reg
	srv.WebRoot = webRoot()

	// Background: initial low-priority index scan (never blocks startup) and
	// periodic maintenance.
	go func() {
		time.Sleep(5 * time.Second)
		searchSvc.ScanAll(context.Background())
	}()
	go runMaintenance(db, sessions, limiter, searchSvc, shareStore, previewSvc, jobMgr, log)

	httpSrv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           srv.Routes(),
		ReadHeaderTimeout: 15 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      0, // streaming (Range) needs no write timeout
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		log.Info("listening", "addr", cfg.ListenAddr)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("http server failed", "error", err)
			os.Exit(1)
		}
	}()

	// Graceful shutdown.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Info("shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(ctx); err != nil {
		log.Error("shutdown error", "error", err)
	}
}

func ensureSessionSecret(db *sql.DB, cfg *config.Config, log *logger.Logger) error {
	if cfg.SessionSecret != "" {
		return nil
	}
	var val string
	err := db.QueryRow(`SELECT value FROM settings WHERE key='session_secret'`).Scan(&val)
	if err == sql.ErrNoRows {
		val = util.RandToken(32)
		if _, err := db.Exec(`INSERT INTO settings(key, value) VALUES('session_secret', ?)`, val); err != nil {
			return err
		}
		log.Warn("generated session secret (persisted in DB settings)")
	} else if err != nil {
		return err
	}
	cfg.SessionSecret = val
	return nil
}

func webRoot() string {
	if v := os.Getenv("NEXORA_WEB_ROOT"); v != "" {
		return v
	}
	return "web/dist"
}

func runMaintenance(db *sql.DB, sessions *auth.SessionStore, limiter *middleware.RateLimiter, searchSvc *search.Service, shares *sharing.Store, previewSvc *preview.Service, jobMgr *jobs.Manager, log *logger.Logger) {
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()
	scanTicker := time.NewTicker(6 * time.Hour)
	defer scanTicker.Stop()
	for {
		select {
		case <-ticker.C:
			if n, err := sessions.Cleanup(); err == nil && n > 0 {
				log.Debug("cleaned expired sessions", "count", n)
			}
			limiter.Sweep()
			if n, err := shares.PurgeExpired(); err == nil && n > 0 {
				log.Debug("purged expired shares", "count", n)
			}
			previewSvc.PurgeStale()
			jobMgr.CleanupOldArchives(24 * time.Hour)
		case <-scanTicker.C:
			searchSvc.ScanAll(context.Background())
		}
	}
}
