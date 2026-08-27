package api

import (
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/config"
	"github.com/nexora/nexora/internal/middleware"
)

// handleAdminGetSettings returns the canonical registry plus effective values.
func (s *Server) handleAdminGetSettings(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserFromContext(r.Context()); !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	persisted := map[string]string{}
	if s.Settings != nil {
		if m, err := s.Settings.All(); err == nil {
			persisted = m
		}
	}
	type item struct {
		Key             string `json:"key"`
		Env             string `json:"env"`
		Type            string `json:"type"`
		Category        string `json:"category"`
		Label           string `json:"label"`
		Description     string `json:"description"`
		Default         string `json:"default"`
		RequiresRestart bool   `json:"requires_restart"`
		Value           string `json:"value"`
		Effective       string `json:"effective"`
		IsOverridden    bool   `json:"is_overridden"`
		Source          string `json:"source"`
	}
	out := make([]item, 0, len(config.SettingsRegistry))
	for _, meta := range config.SettingsRegistry {
		eff := effectiveValue(s, meta.Key, meta.Default)
		persistedVal, overridden := persisted[meta.Key]
		source := "env"
		val := eff
		if overridden {
			val = persistedVal
			source = "db"
		}
		out = append(out, item{
			Key: meta.Key, Env: meta.Env, Type: meta.Type, Category: meta.Category,
			Label: meta.Label, Description: meta.Description, Default: meta.Default,
			RequiresRestart: meta.RequiresRestart,
			Value:           val,
			Effective:       eff,
			IsOverridden:    overridden,
			Source:          source,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Category == out[j].Category {
			return out[i].Key < out[j].Key
		}
		return out[i].Category < out[j].Category
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"settings": out,
		"count":    len(out),
	})
}

func effectiveValue(s *Server, key, fallback string) string {
	switch key {
	case "base_url":
		return s.Cfg.BaseURL
	case "allow_registration":
		return strconv.FormatBool(s.Cfg.AllowRegistration)
	case "session_lifetime":
		return s.Cfg.SessionLifetime.String()
	case "secure_cookies":
		return strconv.FormatBool(s.Cfg.SecureCookies)
	case "rate_limit_per_min":
		return strconv.Itoa(s.Cfg.RateLimitPerMin)
	case "lockout_attempts":
		return strconv.Itoa(s.Cfg.LockoutAttempts)
	case "lockout_window":
		return s.Cfg.LockoutWindow.String()
	case "cors_origins":
		return strings.Join(s.Cfg.CORSOrigins, ", ")
	case "trusted_proxies":
		return strings.Join(s.Cfg.TrustedProxies, ", ")
	case "max_upload_size":
		return formatBytesHuman(s.Cfg.MaxUploadSize)
	case "max_editable_size":
		return formatBytesHuman(s.Cfg.MaxEditableSize)
	case "allowed_mime":
		return strings.Join(s.Cfg.AllowedMimeTypes, ", ")
	case "thumbnail_max_size":
		return formatBytesHuman(s.Cfg.ThumbnailMaxSize)
	case "thumbnail_ttl":
		return s.Cfg.ThumbnailTTL.String()
	case "enable_ffmpeg_thumbs":
		return strconv.FormatBool(s.Cfg.EnableFFmpegThumbs)
	case "trash_ttl":
		return s.Cfg.TrashTTL.String()
	case "upload_ttl":
		return s.Cfg.UploadTTL.String()
	case "backup_keep":
		return strconv.Itoa(s.Cfg.BackupKeep)
	case "backup_hour":
		return strconv.Itoa(s.Cfg.BackupHour)
	case "extract_enabled":
		return strconv.FormatBool(s.Cfg.ExtractEnabled)
	case "extract_max_size":
		return formatBytesHuman(s.Cfg.ExtractMaxFileSize)
	case "extract_max_text":
		return strconv.Itoa(s.Cfg.ExtractMaxTextLen)
	case "extract_ocr_bin":
		return s.Cfg.ExtractOCRBin
	case "version_enabled":
		return strconv.FormatBool(s.Cfg.VersionEnabled)
	case "version_auto":
		return strconv.FormatBool(s.Cfg.VersionAuto)
	case "version_max_per_file":
		return strconv.Itoa(s.Cfg.VersionMaxPerFile)
	case "version_max_file_size":
		return formatBytesHuman(s.Cfg.VersionMaxFileSize)
	case "version_max_age":
		return s.Cfg.VersionMaxTotalAge.String()
	case "version_max_total_bytes":
		return formatBytesHuman(s.Cfg.VersionMaxTotalBytes)
	default:
		return fallback
	}
}

// handleAdminUpdateSettings validates and persists a batch of settings.
func (s *Server) handleAdminUpdateSettings(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	if s.Settings == nil {
		writeError(w, http.StatusInternalServerError, "settings_unavailable", "settings store not configured", middleware.GetRequestID(r.Context()))
		return
	}
	var raw map[string]json.RawMessage
	if err := decodeJSON(r, &raw); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	payload := map[string]string{}
	if v, ok := raw["settings"]; ok {
		var nested map[string]any
		if err := json.Unmarshal(v, &nested); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_body", "settings must be an object of string values", middleware.GetRequestID(r.Context()))
			return
		}
		for k, vv := range nested {
			payload[k] = anyToString(vv)
		}
	} else {
		for k, v := range raw {
			var str string
			if err := json.Unmarshal(v, &str); err == nil {
				payload[k] = str
			} else {
				var anyVal any
				if err := json.Unmarshal(v, &anyVal); err == nil {
					payload[k] = anyToString(anyVal)
				}
			}
		}
	}
	if len(payload) == 0 {
		writeError(w, http.StatusBadRequest, "validation_error", "no settings provided", middleware.GetRequestID(r.Context()))
		return
	}
	// Reject unknown keys (startup ignores them for forward compat, but the
	// admin API should be strict so typos are caught).
	knownSet := map[string]bool{}
	for _, m := range config.SettingsRegistry {
		knownSet[m.Key] = true
	}
	for k := range payload {
		if !knownSet[k] {
			writeError(w, http.StatusBadRequest, "validation_error", "unknown setting key: "+k, middleware.GetRequestID(r.Context()))
			return
		}
	}
	// Validate by trial-applying to a clone.
	clone := *s.Cfg
	if _, err := config.ApplySettings(&clone, payload); err != nil {
		writeError(w, http.StatusBadRequest, "validation_error", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	if err := s.Settings.SetMany(payload, user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not save settings", middleware.GetRequestID(r.Context()))
		return
	}
	if _, err := config.ApplySettings(s.Cfg, payload); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	// Hot-reload dependent services.
	if _, ok := payload["rate_limit_per_min"]; ok {
		if s.Limiter != nil {
			s.Limiter.SetRate(s.Cfg.RateLimitPerMin, s.Cfg.LockoutWindow)
		}
	}
	if _, ok := payload["lockout_window"]; ok {
		if s.Limiter != nil {
			s.Limiter.SetRate(s.Cfg.RateLimitPerMin, s.Cfg.LockoutWindow)
		}
		if s.Guard != nil {
			s.Guard.SetLimits(s.Cfg.LockoutAttempts, s.Cfg.LockoutWindow)
		}
	}
	if _, ok := payload["lockout_attempts"]; ok {
		if s.Guard != nil {
			s.Guard.SetLimits(s.Cfg.LockoutAttempts, s.Cfg.LockoutWindow)
		}
	}
	if _, ok := payload["session_lifetime"]; ok {
		if s.Sessions != nil {
			s.Sessions.SetLifetime(s.Cfg.SessionLifetime)
		}
	}
	if _, ok := payload["thumbnail_max_size"]; ok {
		if s.Preview != nil {
			s.Preview.UpdateConfig(s.Cfg.ThumbnailMaxSize, s.Cfg.ThumbnailTTL)
		}
	}
	if _, ok := payload["thumbnail_ttl"]; ok {
		if s.Preview != nil {
			s.Preview.UpdateConfig(s.Cfg.ThumbnailMaxSize, s.Cfg.ThumbnailTTL)
		}
	}
	for k := range payload {
		s.audit(r, "settings_update", k, payload[k])
	}
	keys := make([]string, 0, len(payload))
	for k := range payload {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "updated": keys})
}

// handleAdminDeleteSetting reverts one setting to its default/env value.
func (s *Server) handleAdminDeleteSetting(w http.ResponseWriter, r *http.Request) {
	_, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	if s.Settings == nil {
		writeError(w, http.StatusInternalServerError, "settings_unavailable", "settings store not configured", middleware.GetRequestID(r.Context()))
		return
	}
	key := chi.URLParam(r, "key")
	if key == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "key is required", middleware.GetRequestID(r.Context()))
		return
	}
	known := false
	var defaultVal string
	for _, m := range config.SettingsRegistry {
		if m.Key == key {
			known = true
			defaultVal = m.Default
			break
		}
	}
	if !known {
		writeError(w, http.StatusBadRequest, "validation_error", "unknown setting key", middleware.GetRequestID(r.Context()))
		return
	}
	if err := s.Settings.Delete(key); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not delete setting", middleware.GetRequestID(r.Context()))
		return
	}
	defMap := map[string]string{key: defaultVal}
	if _, err := config.ApplySettings(s.Cfg, defMap); err != nil {
		// default should always be valid; if not, keep current value.
	}
	if key == "rate_limit_per_min" || key == "lockout_window" {
		if s.Limiter != nil {
			s.Limiter.SetRate(s.Cfg.RateLimitPerMin, s.Cfg.LockoutWindow)
		}
	}
	if key == "lockout_attempts" || key == "lockout_window" {
		if s.Guard != nil {
			s.Guard.SetLimits(s.Cfg.LockoutAttempts, s.Cfg.LockoutWindow)
		}
	}
	if key == "session_lifetime" && s.Sessions != nil {
		s.Sessions.SetLifetime(s.Cfg.SessionLifetime)
	}
	if (key == "thumbnail_max_size" || key == "thumbnail_ttl") && s.Preview != nil {
		s.Preview.UpdateConfig(s.Cfg.ThumbnailMaxSize, s.Cfg.ThumbnailTTL)
	}
	s.audit(r, "settings_reset", key, "reverted to default")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "key": key, "default": defaultVal})
}

func anyToString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case bool:
		return strconv.FormatBool(t)
	case float64:
		if t == float64(int(t)) {
			return strconv.Itoa(int(t))
		}
		b, _ := json.Marshal(t)
		return string(b)
	case int:
		return strconv.Itoa(t)
	case int64:
		return strconv.FormatInt(t, 10)
	default:
		b, _ := json.Marshal(t)
		return string(b)
	}
}

func formatBytesHuman(n int64) string {
	if n == 0 {
		return "0"
	}
	const (
		KB = 1 << 10
		MB = 1 << 20
		GB = 1 << 30
		TB = 1 << 40
	)
	switch {
	case n%TB == 0 && n >= TB:
		return strconv.FormatInt(n/TB, 10) + "TB"
	case n%GB == 0 && n >= GB:
		return strconv.FormatInt(n/GB, 10) + "GB"
	case n%MB == 0 && n >= MB:
		return strconv.FormatInt(n/MB, 10) + "MB"
	case n%KB == 0 && n >= KB:
		return strconv.FormatInt(n/KB, 10) + "KB"
	default:
		return strconv.FormatInt(n, 10)
	}
}
