// Package config provides environment-based configuration with secure
// defaults. No external config file is required; everything can be set via
// environment variables (optionally loaded from .env with godotenv).
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// RootConfig describes a storage root provisioned on first run.
type RootConfig struct {
	Name      string
	Path      string
	ReadOnly  bool
	Indexed   bool
}

// Config holds the fully resolved runtime configuration.
type Config struct {
	ListenAddr       string
	DataDir          string
	DatabasePath     string
	BaseURL          string
	SessionSecret    string
	SessionLifetime  time.Duration
	LogLevel         string
	LogFormat        string
	CORSOrigins      []string
	TrustedProxies   []string
	MaxUploadSize    int64
	AllowedMimeTypes []string // empty = allow all
	RateLimitPerMin  int
	LockoutAttempts  int
	LockoutWindow    time.Duration
	EnablePrometheus bool
	ThumbnailCacheDir string
	ThumbnailMaxSize  int64
	ThumbnailTTL     time.Duration
	EnableFFmpegThumbs bool
	MaxEditableSize  int64
	DefaultRoots     []RootConfig
	AllowRegistration   bool
	SecureCookies       bool
	ReadonlyFS          bool
	PlaylistCoverPath   string
}

// Load reads configuration from .env (if present) then environment variables.
func Load() (*Config, error) {
	_ = godotenv.Load()
	_ = godotenv.Load(".env")

	c := &Config{
		ListenAddr:        env("NEXORA_LISTEN_ADDR", ":8080"),
		DataDir:           env("NEXORA_DATA_DIR", "./data"),
		BaseURL:           env("NEXORA_BASE_URL", ""),
		SessionSecret:     env("NEXORA_SESSION_SECRET", ""),
		SessionLifetime:   envDuration("NEXORA_SESSION_LIFETIME", 7*24*time.Hour),
		LogLevel:          env("NEXORA_LOG_LEVEL", "info"),
		LogFormat:         env("NEXORA_LOG_FORMAT", "json"),
		CORSOrigins:       envList("NEXORA_CORS_ORIGINS", []string{}),
		TrustedProxies:    envList("NEXORA_TRUSTED_PROXIES", []string{}),
		MaxUploadSize:     envBytes("NEXORA_MAX_UPLOAD_SIZE", 2<<30),
		AllowedMimeTypes:  envList("NEXORA_ALLOWED_MIME", []string{}),
		RateLimitPerMin:   envInt("NEXORA_RATE_LIMIT_PER_MIN", 60),
		LockoutAttempts:   envInt("NEXORA_LOCKOUT_ATTEMPTS", 5),
		LockoutWindow:     envDuration("NEXORA_LOCKOUT_WINDOW", 15*time.Minute),
		EnablePrometheus:  envBool("NEXORA_ENABLE_PROMETHEUS", false),
		ThumbnailMaxSize:  envBytes("NEXORA_THUMBNAIL_MAX_SIZE", 20<<20),
		ThumbnailTTL:      envDuration("NEXORA_THUMBNAIL_TTL", 24*7*time.Hour),
		EnableFFmpegThumbs: envBool("NEXORA_ENABLE_FFMPEG_THUMBS", false),
		MaxEditableSize:   envBytes("NEXORA_MAX_EDITABLE_SIZE", 5<<20),
		DefaultRoots:      parseRoots(env("NEXORA_DEFAULT_ROOTS", "Files:/mnt/files:false,Media:/mnt/media:true,Backups:/mnt/backups:false,Shared:/mnt/shared:false")),
		AllowRegistration:   envBool("NEXORA_ALLOW_REGISTRATION", true),
		SecureCookies:       envBool("NEXORA_SECURE_COOKIES", false),
		ReadonlyFS:          envBool("NEXORA_READONLY_FS", false),
		PlaylistCoverPath:   env("NEXORA_PLAYLIST_COVER_PATH", ""),
	}
	c.DatabasePath = env("NEXORA_DATABASE_PATH", c.DataDir+"/nexora.db")
	c.ThumbnailCacheDir = env("NEXORA_THUMBNAIL_CACHE_DIR", c.DataDir+"/cache/thumbnails")

	if err := os.MkdirAll(c.DataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	if err := os.MkdirAll(c.ThumbnailCacheDir, 0o755); err != nil {
		return nil, fmt.Errorf("create thumbnail cache dir: %w", err)
	}
	return c, nil
}

// Validate checks that required security settings are sane.
func (c *Config) Validate() error {
	if c.ListenAddr == "" {
		return fmt.Errorf("listen address must not be empty")
	}
	if c.MaxUploadSize <= 0 {
		return fmt.Errorf("max upload size must be positive")
	}
	return nil
}

func parseRoots(s string) []RootConfig {
	var out []RootConfig
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		fields := strings.Split(part, ":")
		if len(fields) < 2 {
			continue
		}
		rc := RootConfig{Name: fields[0], Path: fields[1], ReadOnly: false, Indexed: true}
		if len(fields) >= 3 {
			rc.ReadOnly = strings.EqualFold(fields[2], "true") || fields[2] == "1" || strings.EqualFold(fields[2], "ro")
		}
		if len(fields) >= 4 {
			rc.Indexed = !strings.EqualFold(fields[3], "false")
		}
		out = append(out, rc)
	}
	return out
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envBool(key string, def bool) bool {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		b, err := strconv.ParseBool(v)
		if err == nil {
			return b
		}
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}

func envList(key string, def []string) []string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		var out []string
		for _, p := range strings.Split(v, ",") {
			p = strings.TrimSpace(p)
			if p != "" {
				out = append(out, p)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	return def
}

// envBytes parses human sizes like 2GB, 512MB, 1048576.
func envBytes(key string, def int64) int64 {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
		mult := int64(1)
		lower := strings.ToUpper(strings.TrimSpace(v))
		switch {
		case strings.HasSuffix(lower, "KB"):
			mult, lower = 1<<10, strings.TrimSuffix(lower, "KB")
		case strings.HasSuffix(lower, "MB"):
			mult, lower = 1<<20, strings.TrimSuffix(lower, "MB")
		case strings.HasSuffix(lower, "GB"):
			mult, lower = 1<<30, strings.TrimSuffix(lower, "GB")
		case strings.HasSuffix(lower, "TB"):
			mult, lower = 1<<40, strings.TrimSuffix(lower, "TB")
		}
		if n, err := strconv.ParseInt(strings.TrimSpace(lower), 10, 64); err == nil {
			return n * mult
		}
	}
	return def
}
