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
	Name     string
	Path     string
	ReadOnly bool
	Indexed  bool
}

// Config holds the fully resolved runtime configuration.
type Config struct {
	ListenAddr         string
	DataDir            string
	DatabasePath       string
	DatabaseType       string // "sqlite" or "postgres"
	DatabaseURL        string // PostgreSQL connection URL
	BaseURL            string
	SessionSecret      string
	SessionLifetime    time.Duration
	LogLevel           string
	LogFormat          string
	CORSOrigins        []string
	TrustedProxies     []string
	MaxUploadSize      int64
	AllowedMimeTypes   []string // empty = allow all
	RateLimitPerMin    int
	LockoutAttempts    int
	LockoutWindow      time.Duration
	EnablePrometheus   bool
	ThumbnailCacheDir  string
	ThumbnailMaxSize   int64
	ThumbnailTTL       time.Duration
	EnableFFmpegThumbs bool
	MaxEditableSize    int64
	// TranscodeTimeout caps how long a single ffmpeg invocation may run
	// before it's killed and its semaphore slot released. Without this
	// bound, a slow client (or a 50GB file) can pin one of the two
	// transcode slots indefinitely. 0 = use the default (4h).
	TranscodeTimeout  time.Duration
	// TranscodeClientWriteTimeout caps how long the server waits for the
	// client to keep reading bytes before giving up on the transcode.
	// 0 = use the default (10m).
	TranscodeClientWriteTimeout time.Duration
	DefaultRoots       []RootConfig
	AllowRegistration  bool
	BackupDir          string        // "" disables scheduled backups
	TrashTTL           time.Duration // 0 disables auto-purge
	UploadTTL          time.Duration // stale chunked-upload sessions (0 = 24h default applied in main)
	BackupKeep         int
	BackupHour         int
	SecureCookies      bool
	ReadonlyFS         bool
	PlaylistCoverPath  string
	TailscaleAuth      bool

	// Full-text extraction (search inside PDFs/text/OCR). All values are
	// safe to leave at zero (meaning "use default").
	ExtractEnabled      bool   // master switch; default true
	ExtractMaxFileSize  int64  // skip files larger than this; default 10 MB
	ExtractMaxTextLen   int    // cap stored text; default 512 KiB
	ExtractOCRBin       string // tesseract binary path; empty disables image OCR

	// File versioning (N-series). All values are safe to leave at zero
	// (meaning "use default") — the versions package fills them in.
	VersionEnabled     bool          // master switch; default true
	VersionAuto        bool          // auto-snapshot on overwrite; default true
	VersionMaxPerFile  int           // cap per file; default 50
	VersionMaxFileSize int64         // skip files larger than this; default 256 MB
	VersionMaxTotalAge time.Duration // prune versions older than this; 0 = forever
	VersionMaxTotalBytes int64       // prune oldest when total exceeds; 0 = unlimited
}

// Load reads configuration from .env (if present) then environment variables.
func Load() (*Config, error) {
	_ = godotenv.Load()
	_ = godotenv.Load(".env")

	c := &Config{
		ListenAddr:         env("NEXORA_LISTEN_ADDR", ":8080"),
		DataDir:            env("NEXORA_DATA_DIR", "./data"),
		BaseURL:            env("NEXORA_BASE_URL", ""),
		SessionSecret:      env("NEXORA_SESSION_SECRET", ""),
		SessionLifetime:    envDuration("NEXORA_SESSION_LIFETIME", 7*24*time.Hour),
		LogLevel:           env("NEXORA_LOG_LEVEL", "info"),
		LogFormat:          env("NEXORA_LOG_FORMAT", "json"),
		CORSOrigins:        envList("NEXORA_CORS_ORIGINS", []string{}),
		TrustedProxies:     envList("NEXORA_TRUSTED_PROXIES", []string{}),
		MaxUploadSize:      envBytes("NEXORA_MAX_UPLOAD_SIZE", 512<<30), // 512GB — effectively unlimited single-file uploads
		AllowedMimeTypes:   envList("NEXORA_ALLOWED_MIME", []string{}),
		RateLimitPerMin:    envInt("NEXORA_RATE_LIMIT_PER_MIN", 60),
		LockoutAttempts:    envInt("NEXORA_LOCKOUT_ATTEMPTS", 5),
		LockoutWindow:      envDuration("NEXORA_LOCKOUT_WINDOW", 15*time.Minute),
		EnablePrometheus:   envBool("NEXORA_ENABLE_PROMETHEUS", false),
		ThumbnailMaxSize:   envBytes("NEXORA_THUMBNAIL_MAX_SIZE", 20<<20),
		ThumbnailTTL:       envDuration("NEXORA_THUMBNAIL_TTL", 24*7*time.Hour),
		EnableFFmpegThumbs: envBool("NEXORA_ENABLE_FFMPEG_THUMBS", false),
		MaxEditableSize:    envBytes("NEXORA_MAX_EDITABLE_SIZE", 5<<20),
		TranscodeTimeout:   envDuration("NEXORA_TRANSCODE_TIMEOUT", 4*time.Hour),
		TranscodeClientWriteTimeout: envDuration("NEXORA_TRANSCODE_CLIENT_WRITE_TIMEOUT", 10*time.Minute),
		DefaultRoots:       parseRoots(env("NEXORA_DEFAULT_ROOTS", "Files:/mnt/files:false,Media:/mnt/media:true,Backups:/mnt/backups:false,Shared:/mnt/shared:false")),
		AllowRegistration:  envBool("NEXORA_ALLOW_REGISTRATION", true),
		SecureCookies:      envBool("NEXORA_SECURE_COOKIES", true), // secure by default; set false for plain-HTTP/LAN installs
		ReadonlyFS:         envBool("NEXORA_READONLY_FS", false),
		PlaylistCoverPath:  env("NEXORA_PLAYLIST_COVER_PATH", ""),
		TailscaleAuth:      envBool("NEXORA_TAILSCALE_AUTH", false),
	}
	c.DatabasePath = env("NEXORA_DATABASE_PATH", c.DataDir+"/nexora.db")
	c.DatabaseType = env("NEXORA_DATABASE_TYPE", "sqlite")
	c.DatabaseURL = env("NEXORA_DATABASE_URL", "")
	c.ThumbnailCacheDir = env("NEXORA_THUMBNAIL_CACHE_DIR", c.DataDir+"/cache/thumbnails")
	c.BackupDir = env("NEXORA_BACKUP_DIR", "")
	c.BackupKeep = envInt("NEXORA_BACKUP_KEEP", 7)
	c.BackupHour = envInt("NEXORA_BACKUP_HOUR", 3)
	c.TrashTTL = envDuration("NEXORA_TRASH_TTL", 0)
	c.UploadTTL = envDuration("NEXORA_UPLOAD_TTL", 24*time.Hour)

	// Full-text extraction defaults.
	c.ExtractEnabled = envBool("NEXORA_EXTRACT_ENABLED", true)
	c.ExtractMaxFileSize = envBytes("NEXORA_EXTRACT_MAX_SIZE", 10<<20)
	c.ExtractMaxTextLen = envInt("NEXORA_EXTRACT_MAX_TEXT", 512<<10)
	c.ExtractOCRBin = env("NEXORA_OCR_BIN", "")
	if c.ExtractOCRBin == "" {
		// Auto-detect a tesseract binary in PATH (common in self-hosted
		// setups); users can point NEXORA_OCR_BIN at another path.
		if _, err := os.Stat("/usr/bin/tesseract"); err == nil {
			c.ExtractOCRBin = "/usr/bin/tesseract"
		}
	}

	// File versioning defaults. Each default is applied conditionally so the
	// zero value still represents "off" / "unlimited" where it should.
	c.VersionEnabled = envBool("NEXORA_VERSION_ENABLED", true)
	c.VersionAuto = envBool("NEXORA_VERSION_AUTO", true)
	c.VersionMaxPerFile = envInt("NEXORA_VERSION_MAX_PER_FILE", 50)
	if c.VersionMaxPerFile < 1 {
		c.VersionMaxPerFile = 1
	}
	c.VersionMaxFileSize = envBytes("NEXORA_VERSION_MAX_FILE_SIZE", 256<<20)
	c.VersionMaxTotalAge = envDuration("NEXORA_VERSION_MAX_AGE", 0)
	c.VersionMaxTotalBytes = envBytes("NEXORA_VERSION_MAX_TOTAL_BYTES", 0)

	if err := os.MkdirAll(c.DataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	if err := os.MkdirAll(c.ThumbnailCacheDir, 0o755); err != nil {
		return nil, fmt.Errorf("create thumbnail cache dir: %w", err)
	}
	return c, nil
}

// Validate checks that required security settings are sane. It fails fast on
// misconfiguration that would otherwise surface as obscure runtime errors.
func (c *Config) Validate() error {
	if c.ListenAddr == "" {
		return fmt.Errorf("listen address must not be empty")
	}
	if c.MaxUploadSize <= 0 {
		return fmt.Errorf("max upload size must be positive")
	}
	switch c.DatabaseType {
	case "sqlite", "postgres":
	default:
		return fmt.Errorf("NEXORA_DATABASE_TYPE must be 'sqlite' or 'postgres' (got %q)", c.DatabaseType)
	}
	if c.DatabaseType == "postgres" && strings.TrimSpace(c.DatabaseURL) == "" {
		return fmt.Errorf("NEXORA_DATABASE_URL is required when NEXORA_DATABASE_TYPE=postgres")
	}
	if c.DatabaseType == "sqlite" && strings.TrimSpace(c.DatabasePath) == "" {
		return fmt.Errorf("NEXORA_DATABASE_PATH must not be empty for sqlite")
	}
	if c.SessionSecret != "" && len(c.SessionSecret) < 16 {
		return fmt.Errorf("NEXORA_SESSION_SECRET must be at least 16 characters when set (got %d)", len(c.SessionSecret))
	}
	for _, o := range c.CORSOrigins {
		o = strings.TrimSpace(o)
		if o == "" || o == "*" {
			continue
		}
		if !strings.HasPrefix(o, "http://") && !strings.HasPrefix(o, "https://") && !strings.HasPrefix(o, "tauri://") {
			return fmt.Errorf("NEXORA_CORS_ORIGINS entry %q must be an http(s):// or tauri:// origin", o)
		}
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
		// Accept day suffixes ("30d", "7d12h") in addition to Go units.
		if d, err := parseDurationWithDays(v); err == nil {
			return d
		}
	}
	return def
}

func parseDurationWithDays(v string) (time.Duration, error) {
	if i := strings.IndexByte(v, 'd'); i >= 0 {
		daysPart, rest := v[:i], v[i+1:]
		if n, err := strconv.Atoi(daysPart); err == nil && rest != "" && !strings.ContainsAny(rest[:1], "0123456789") {
			extra, err := time.ParseDuration(rest)
			if err != nil {
				return 0, err
			}
			return time.Duration(n)*24*time.Hour + extra, nil
		}
		if n, err := strconv.Atoi(daysPart); err == nil && rest == "" {
			return time.Duration(n) * 24 * time.Hour, nil
		}
	}
	return time.ParseDuration(v)
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
		if n, err := ParseBytes(v); err == nil {
			return n
		}
	}
	return def
}

// ── Exported parsers (used by the admin settings store) ────────────────────

// ParseDuration parses durations with day suffixes like "30d", "7d12h".
func ParseDuration(s string) (time.Duration, error) { return parseDurationWithDays(s) }

// ParseBytes parses human sizes like "512MB", "2GB", or plain integers.
func ParseBytes(s string) (int64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, fmt.Errorf("empty size")
	}
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		return n, nil
	}
	mult := int64(1)
	lower := strings.ToUpper(s)
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
	n, err := strconv.ParseInt(strings.TrimSpace(lower), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid size %q", s)
	}
	return n * mult, nil
}

// ParseBool parses a boolean string.
func ParseBool(s string) (bool, error) { return strconv.ParseBool(strings.TrimSpace(s)) }

// ParseInt parses a decimal integer.
func ParseInt(s string) (int, error) { return strconv.Atoi(strings.TrimSpace(s)) }

// ParseList splits a comma-separated list into trimmed non-empty entries.
func ParseList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// ── DB-backed settings overlay ─────────────────────────────────────────────

// ApplySettings overlays persisted system_settings on top of an already-loaded
// Config (env defaults). Unknown keys are ignored so forward-compatible
// rollbacks don't break. Returns a map of keys that were applied. The update
// is atomic: either all keys validate and the config is mutated, or none are.
func ApplySettings(cfg *Config, m map[string]string) (map[string]string, error) {
	tmp := *cfg
	applied := map[string]string{}
	for k, raw := range m {
		v := strings.TrimSpace(raw)
		switch k {
		case "base_url":
			tmp.BaseURL = v
			applied[k] = v
		case "allow_registration":
			b, err := ParseBool(v)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", k, err)
			}
			tmp.AllowRegistration = b
			applied[k] = v
		case "session_lifetime":
			d, err := ParseDuration(v)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", k, err)
			}
			if d <= 0 {
				return nil, fmt.Errorf("%s must be positive", k)
			}
			tmp.SessionLifetime = d
			applied[k] = v
		case "rate_limit_per_min":
			n, err := ParseInt(v)
			if err != nil || n <= 0 {
				return nil, fmt.Errorf("%s must be a positive integer", k)
			}
			tmp.RateLimitPerMin = n
			applied[k] = v
		case "lockout_attempts":
			n, err := ParseInt(v)
			if err != nil || n <= 0 {
				return nil, fmt.Errorf("%s must be a positive integer", k)
			}
			tmp.LockoutAttempts = n
			applied[k] = v
		case "lockout_window":
			d, err := ParseDuration(v)
			if err != nil || d <= 0 {
				return nil, fmt.Errorf("%s must be a positive duration", k)
			}
			tmp.LockoutWindow = d
			applied[k] = v
		case "secure_cookies":
			b, err := ParseBool(v)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", k, err)
			}
			tmp.SecureCookies = b
			applied[k] = v
		case "cors_origins":
			// Comma-separated list; empty = allow all (default). Validate each.
			if v == "" {
				tmp.CORSOrigins = nil
			} else {
				list := ParseList(v)
				for _, o := range list {
					if o == "*" {
						continue
					}
					if !strings.HasPrefix(o, "http://") && !strings.HasPrefix(o, "https://") && !strings.HasPrefix(o, "tauri://") {
						return nil, fmt.Errorf("%s entry %q must be http(s):// or tauri://", k, o)
					}
				}
				tmp.CORSOrigins = list
			}
			applied[k] = v
		case "trusted_proxies":
			if v == "" {
				tmp.TrustedProxies = nil
			} else {
				tmp.TrustedProxies = ParseList(v)
			}
			applied[k] = v
		case "max_upload_size":
			n, err := ParseBytes(v)
			if err != nil || n <= 0 {
				return nil, fmt.Errorf("%s must be a positive size", k)
			}
			tmp.MaxUploadSize = n
			applied[k] = v
		case "max_editable_size":
			n, err := ParseBytes(v)
			if err != nil || n <= 0 {
				return nil, fmt.Errorf("%s must be a positive size", k)
			}
			tmp.MaxEditableSize = n
			applied[k] = v
		case "allowed_mime":
			if v == "" {
				tmp.AllowedMimeTypes = nil
			} else {
				tmp.AllowedMimeTypes = ParseList(v)
			}
			applied[k] = v
		case "thumbnail_max_size":
			n, err := ParseBytes(v)
			if err != nil || n <= 0 {
				return nil, fmt.Errorf("%s must be a positive size", k)
			}
			tmp.ThumbnailMaxSize = n
			applied[k] = v
		case "thumbnail_ttl":
			d, err := ParseDuration(v)
			if err != nil || d <= 0 {
				return nil, fmt.Errorf("%s must be a positive duration", k)
			}
			tmp.ThumbnailTTL = d
			applied[k] = v
		case "enable_ffmpeg_thumbs":
			b, err := ParseBool(v)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", k, err)
			}
			tmp.EnableFFmpegThumbs = b
			applied[k] = v
		case "trash_ttl":
			d, err := ParseDuration(v)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", k, err)
			}
			// 0 means disabled — allow zero.
			tmp.TrashTTL = d
			applied[k] = v
		case "upload_ttl":
			d, err := ParseDuration(v)
			if err != nil || d <= 0 {
				return nil, fmt.Errorf("%s must be a positive duration", k)
			}
			tmp.UploadTTL = d
			applied[k] = v
		case "backup_keep":
			n, err := ParseInt(v)
			if err != nil || n < 0 {
				return nil, fmt.Errorf("%s must be >= 0", k)
			}
			tmp.BackupKeep = n
			applied[k] = v
		case "backup_hour":
			n, err := ParseInt(v)
			if err != nil || n < 0 || n > 23 {
				return nil, fmt.Errorf("%s must be 0-23", k)
			}
			tmp.BackupHour = n
			applied[k] = v
		case "extract_enabled":
			b, err := ParseBool(v)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", k, err)
			}
			tmp.ExtractEnabled = b
			applied[k] = v
		case "extract_max_size":
			n, err := ParseBytes(v)
			if err != nil || n <= 0 {
				return nil, fmt.Errorf("%s must be a positive size", k)
			}
			tmp.ExtractMaxFileSize = n
			applied[k] = v
		case "extract_max_text":
			n, err := ParseInt(v)
			if err != nil || n <= 0 {
				return nil, fmt.Errorf("%s must be a positive integer", k)
			}
			tmp.ExtractMaxTextLen = n
			applied[k] = v
		case "extract_ocr_bin":
			tmp.ExtractOCRBin = v
			applied[k] = v
		case "version_enabled":
			b, err := ParseBool(v)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", k, err)
			}
			tmp.VersionEnabled = b
			applied[k] = v
		case "version_auto":
			b, err := ParseBool(v)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", k, err)
			}
			tmp.VersionAuto = b
			applied[k] = v
		case "version_max_per_file":
			n, err := ParseInt(v)
			if err != nil || n <= 0 {
				return nil, fmt.Errorf("%s must be a positive integer", k)
			}
			tmp.VersionMaxPerFile = n
			applied[k] = v
		case "version_max_file_size":
			n, err := ParseBytes(v)
			if err != nil || n <= 0 {
				return nil, fmt.Errorf("%s must be a positive size", k)
			}
			tmp.VersionMaxFileSize = n
			applied[k] = v
		case "version_max_age":
			d, err := ParseDuration(v)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", k, err)
			}
			tmp.VersionMaxTotalAge = d
			applied[k] = v
		case "version_max_total_bytes":
			n, err := ParseBytes(v)
			if err != nil || n < 0 {
				return nil, fmt.Errorf("%s must be >= 0", k)
			}
			tmp.VersionMaxTotalBytes = n
			applied[k] = v
		default:
			// Ignore unknown keys for forward compatibility.
		}
	}
	*cfg = tmp
	return applied, nil
}

// SettingMeta describes one admin-editable setting for the UI.
type SettingMeta struct {
	Key             string `json:"key"`
	Env             string `json:"env"`
	Type            string `json:"type"` // "string" | "bool" | "int" | "bytes" | "duration" | "list"
	Category        string `json:"category"`
	Label           string `json:"label"`
	Description     string `json:"description"`
	Default         string `json:"default"`
	RequiresRestart bool   `json:"requires_restart"`
}

// SettingsRegistry is the canonical list of admin-editable settings.
// Order matters for UI rendering.
var SettingsRegistry = []SettingMeta{
	{Key: "base_url", Env: "NEXORA_BASE_URL", Type: "string", Category: "general", Label: "Base URL", Description: "Public URL used for share links", Default: "", RequiresRestart: false},
	{Key: "allow_registration", Env: "NEXORA_ALLOW_REGISTRATION", Type: "bool", Category: "general", Label: "Allow Registration", Description: "Whether new users can self-register", Default: "true", RequiresRestart: false},
	{Key: "session_lifetime", Env: "NEXORA_SESSION_LIFETIME", Type: "duration", Category: "security", Label: "Session Lifetime", Description: "How long sessions stay valid (e.g. 168h)", Default: "168h", RequiresRestart: false},
	{Key: "secure_cookies", Env: "NEXORA_SECURE_COOKIES", Type: "bool", Category: "security", Label: "Secure Cookies", Description: "Require HTTPS for session/CSRF cookies", Default: "true", RequiresRestart: false},
	{Key: "rate_limit_per_min", Env: "NEXORA_RATE_LIMIT_PER_MIN", Type: "int", Category: "security", Label: "Rate Limit (per min)", Description: "Login attempts allowed per minute per IP", Default: "60", RequiresRestart: false},
	{Key: "lockout_attempts", Env: "NEXORA_LOCKOUT_ATTEMPTS", Type: "int", Category: "security", Label: "Lockout Attempts", Description: "Failed logins before lockout", Default: "5", RequiresRestart: false},
	{Key: "lockout_window", Env: "NEXORA_LOCKOUT_WINDOW", Type: "duration", Category: "security", Label: "Lockout Window", Description: "Window for counting failures (e.g. 15m)", Default: "15m", RequiresRestart: false},
	{Key: "cors_origins", Env: "NEXORA_CORS_ORIGINS", Type: "list", Category: "security", Label: "CORS Origins", Description: "Comma-separated allowed origins (empty = allow all)", Default: "", RequiresRestart: false},
	{Key: "trusted_proxies", Env: "NEXORA_TRUSTED_PROXIES", Type: "list", Category: "security", Label: "Trusted Proxies", Description: "CIDRs allowed to set X-Forwarded-For", Default: "", RequiresRestart: true},
	{Key: "max_upload_size", Env: "NEXORA_MAX_UPLOAD_SIZE", Type: "bytes", Category: "storage", Label: "Max Upload Size", Description: "Largest single file upload (e.g. 512GB)", Default: "512GB", RequiresRestart: false},
	{Key: "max_editable_size", Env: "NEXORA_MAX_EDITABLE_SIZE", Type: "bytes", Category: "storage", Label: "Max Editable Size", Description: "Largest file editable in the browser", Default: "5MB", RequiresRestart: false},
	{Key: "allowed_mime", Env: "NEXORA_ALLOWED_MIME", Type: "list", Category: "storage", Label: "Allowed MIME Types", Description: "Comma-separated allowlist (empty = all)", Default: "", RequiresRestart: false},
	{Key: "thumbnail_max_size", Env: "NEXORA_THUMBNAIL_MAX_SIZE", Type: "bytes", Category: "storage", Label: "Thumbnail Max Source", Description: "Skip thumbnails for files larger than this", Default: "20MB", RequiresRestart: false},
	{Key: "thumbnail_ttl", Env: "NEXORA_THUMBNAIL_TTL", Type: "duration", Category: "storage", Label: "Thumbnail TTL", Description: "How long thumbnails are cached", Default: "168h", RequiresRestart: false},
	{Key: "enable_ffmpeg_thumbs", Env: "NEXORA_ENABLE_FFMPEG_THUMBS", Type: "bool", Category: "storage", Label: "FFmpeg Thumbnails", Description: "Enable video thumbnails (requires ffmpeg)", Default: "false", RequiresRestart: false},
	{Key: "trash_ttl", Env: "NEXORA_TRASH_TTL", Type: "duration", Category: "maintenance", Label: "Trash TTL", Description: "Auto-purge trash after this (0 = keep forever)", Default: "0", RequiresRestart: false},
	{Key: "upload_ttl", Env: "NEXORA_UPLOAD_TTL", Type: "duration", Category: "maintenance", Label: "Upload Session TTL", Description: "Clean up stale resumable uploads after", Default: "24h", RequiresRestart: false},
	{Key: "backup_keep", Env: "NEXORA_BACKUP_KEEP", Type: "int", Category: "maintenance", Label: "Backup Keep", Description: "Number of DB snapshots to retain", Default: "7", RequiresRestart: false},
	{Key: "backup_hour", Env: "NEXORA_BACKUP_HOUR", Type: "int", Category: "maintenance", Label: "Backup Hour", Description: "Local hour (0-23) for daily backup", Default: "3", RequiresRestart: false},
	{Key: "extract_enabled", Env: "NEXORA_EXTRACT_ENABLED", Type: "bool", Category: "search", Label: "Content Extraction", Description: "Extract text from PDFs/text/OCR for search", Default: "true", RequiresRestart: false},
	{Key: "extract_max_size", Env: "NEXORA_EXTRACT_MAX_SIZE", Type: "bytes", Category: "search", Label: "Extract Max File Size", Description: "Skip files larger than this for extraction", Default: "10MB", RequiresRestart: false},
	{Key: "extract_max_text", Env: "NEXORA_EXTRACT_MAX_TEXT", Type: "int", Category: "search", Label: "Extract Max Text", Description: "Cap stored extracted text per file (bytes)", Default: "524288", RequiresRestart: false},
	{Key: "extract_ocr_bin", Env: "NEXORA_OCR_BIN", Type: "string", Category: "search", Label: "OCR Binary", Description: "Path to tesseract binary (empty = auto)", Default: "", RequiresRestart: false},
	{Key: "version_enabled", Env: "NEXORA_VERSION_ENABLED", Type: "bool", Category: "versioning", Label: "Versioning Enabled", Description: "Master switch for file versioning", Default: "true", RequiresRestart: false},
	{Key: "version_auto", Env: "NEXORA_VERSION_AUTO", Type: "bool", Category: "versioning", Label: "Auto Snapshots", Description: "Snapshot before each overwrite", Default: "true", RequiresRestart: false},
	{Key: "version_max_per_file", Env: "NEXORA_VERSION_MAX_PER_FILE", Type: "int", Category: "versioning", Label: "Max Per File", Description: "Oldest pruned when exceeded", Default: "50", RequiresRestart: false},
	{Key: "version_max_file_size", Env: "NEXORA_VERSION_MAX_FILE_SIZE", Type: "bytes", Category: "versioning", Label: "Version Max File Size", Description: "Skip snapshots for larger files", Default: "256MB", RequiresRestart: false},
	{Key: "version_max_age", Env: "NEXORA_VERSION_MAX_AGE", Type: "duration", Category: "versioning", Label: "Version Max Age", Description: "Purge versions older than this (0 = forever)", Default: "0", RequiresRestart: false},
	{Key: "version_max_total_bytes", Env: "NEXORA_VERSION_MAX_TOTAL_BYTES", Type: "bytes", Category: "versioning", Label: "Version Max Total", Description: "Global size cap (0 = unlimited)", Default: "0", RequiresRestart: false},
}
