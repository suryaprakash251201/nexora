package api

import (
	"database/sql"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/storage"
)

// ── Synced lyrics (.lrc) ─────────────────────────────────────────────────────
//
// Lyrics live STRICTLY as a sibling .lrc file next to the audio track:
//   "01. Rowdy Baby.flac" → "01. Rowdy Baby.lrc" (same directory).
// Saving always writes that file through the storage provider (so it works on
// S3 roots too and shows up in the file explorer); deleting removes it. A
// legacy `lyrics` DB table may still hold pre-strict overrides — reads prefer
// it for backwards compatibility, but every save deletes the shadow row so
// the .lrc file becomes the single source of truth.

type lyricCue struct {
	// Time is the cue position in seconds. A negative Time marks an unsynced
	// (plain-text) line that should be rendered but never highlighted.
	Time  float64 `json:"time"`
	Text  string  `json:"text"`
}

type lyricsMeta struct {
	Title  string  `json:"title"`
	Artist string  `json:"artist"`
	Album  string  `json:"album"`
	Offset float64 `json:"offset"` // seconds; subtracted from every cue time
}

type lyricsResponse struct {
	HasLyrics bool       `json:"has_lyrics"`
	Raw        string    `json:"raw"`
	Format     string    `json:"format"` // lrc | plain
	Source     string    `json:"source"` // auto | user | ""
	Synced     bool      `json:"synced"` // true when at least one timed cue exists
	Meta       lyricsMeta `json:"meta"`
	Cues       []lyricCue `json:"cues"`
}

// lrcTag matches a single LRC time tag: [mm:ss.xx] or [mm:ss.xxx] (the
// fractional separator may be "." or ":").
var lrcTag = regexp.MustCompile(`\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]`)

// lrcMetaTag matches an ID-tag line such as [ar:Artist] or [offset:-250].
var lrcMetaTag = regexp.MustCompile(`^\[([a-zA-Z]+):(.*)\]$`)

// parseLRC converts raw .lrc text into timed cues plus any ID3-style metadata.
// Lines may carry multiple time tags; each produces its own cue. Lines without a
// time tag are treated as plain (unsynced) text lines. The optional [offset:]
// tag shifts every cue earlier (positive) or later (negative) by that many ms.
func parseLRC(raw string) (lyricsMeta, []lyricCue, bool) {
	meta := lyricsMeta{}
	type pending struct {
		times []float64
		text  string
	}
	var pendings []pending
	hasTiming := false

	for _, rawLine := range strings.Split(raw, "\n") {
		line := strings.TrimRight(rawLine, "\r")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}

		if m := lrcMetaTag.FindStringSubmatch(trimmed); m != nil {
			// Only treat as metadata when it is exactly one [key:value] tag and
			// the value contains no further time tags.
			key := strings.ToLower(m[1])
			val := strings.TrimSpace(m[2])
			switch key {
			case "ti":
				meta.Title = val
			case "ar":
				meta.Artist = val
			case "al":
				meta.Album = val
			case "offset":
				if v, err := fmt.Sscanf(val, "%f", &meta.Offset); v == 1 && err == nil {
					meta.Offset /= 1000 // milliseconds → seconds
				}
			}
			continue
		}

		tags := lrcTag.FindAllStringSubmatch(line, -1)
		if len(tags) == 0 {
			// Plain line (no time tag) — keep as unsynced text.
			pendings = append(pendings, pending{times: nil, text: trimmed})
			continue
		}

		// Strip all time tags to recover the lyric text.
		text := lrcTag.ReplaceAllString(line, "")
		text = strings.TrimSpace(text)

		var times []float64
		for _, t := range tags {
			mm := atoiSafe(t[1])
			ss := atoiSafe(t[2])
			frac := t[3]
			div := 1.0
			switch len(frac) {
			case 1:
				div = 10
			case 2:
				div = 100
			case 3:
				div = 1000
			}
			fv := 0.0
			if frac != "" {
				fv = float64(atoiSafe(frac)) / div
			}
			times = append(times, float64(mm)*60+float64(ss)+fv)
		}
		hasTiming = true
		pendings = append(pendings, pending{times: times, text: text})
	}

	cues := make([]lyricCue, 0, len(pendings))
	for _, p := range pendings {
		if len(p.times) == 0 {
			cues = append(cues, lyricCue{Time: -1, Text: p.text})
			continue
		}
		for _, tm := range p.times {
			cues = append(cues, lyricCue{Time: tm - meta.Offset, Text: p.text})
		}
	}

	// Clamp negatives (from a large positive offset) and sort by time so the
	// player can binary-search the active line. Unsynced (-1) lines sort first.
	for i := range cues {
		if cues[i].Time < 0 && cues[i].Time != -1 {
			cues[i].Time = 0
		}
	}
	sortCues(cues)

	return meta, cues, hasTiming
}

// sortCues orders cues by time ascending, keeping stable order for ties. Unsynced
// (-1) lines are kept in document order at the top.
func sortCues(cues []lyricCue) {
	for i := 1; i < len(cues); i++ {
		for j := i; j > 0 && cues[j-1].Time > cues[j].Time; j-- {
			cues[j-1], cues[j] = cues[j], cues[j-1]
		}
	}
}

func atoiSafe(s string) int {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return n
		}
		n = n*10 + int(r-'0')
	}
	return n
}

// siblingLRCPath returns the storage-relative path of the .lrc file that sits
// next to the given audio file (same directory, same basename, ".lrc" ext).
func siblingLRCPath(rel string) string {
	name := storage.NameFromPath(rel)
	ext := storage.Ext(name)
	if ext == "" {
		return ""
	}
	base := strings.TrimSuffix(name, "."+ext)
	dir := pathDir(rel)
	lrc := base + ".lrc"
	if dir == "" {
		return lrc
	}
	return dir + "/" + lrc
}

// pathDir is a forward-slash directory of a root-relative path ("" for root).
func pathDir(rel string) string {
	if i := strings.LastIndex(rel, "/"); i >= 0 {
		return rel[:i]
	}
	return ""
}

// handleAudioLyrics returns parsed, time-synced lyrics for an audio/video file.
func (s *Server) handleAudioLyrics(w http.ResponseWriter, r *http.Request) {
	rootID := queryParam(r, "root", "")
	rel, err := storage.CleanRelative(queryParam(r, "path", ""))
	if err != nil || rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid path", middleware.GetRequestID(r.Context()))
		return
	}
	acc, err := s.resolveAccess(r, rootID, false)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	info, err := acc.provider.Stat(rel)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	if info.IsDir {
		writeError(w, http.StatusBadRequest, "is_directory", "path is a directory", middleware.GetRequestID(r.Context()))
		return
	}

	// 1) User-saved lyrics take precedence.
	var dbRaw, dbFormat, dbSource string
	err = s.DB.QueryRow(
		`SELECT raw, format, source FROM lyrics WHERE root_id = ? AND path = ?`,
		rootID, rel,
	).Scan(&dbRaw, &dbFormat, &dbSource)
	if err == nil && strings.TrimSpace(dbRaw) != "" {
		meta, cues, synced := parseLRC(dbRaw)
		writeJSON(w, http.StatusOK, lyricsResponse{
			HasLyrics: true,
			Raw:       dbRaw,
			Format:    dbFormat,
			Source:    dbSource,
			Synced:    synced,
			Meta:      meta,
			Cues:      cues,
		})
		return
	}
	if err != nil && err != sql.ErrNoRows {
		writeError(w, http.StatusInternalServerError, "db_error", "could not read lyrics", middleware.GetRequestID(r.Context()))
		return
	}

	// 2) Auto-detect a sibling .lrc file.
	lrcRel := siblingLRCPath(rel)
	if lrcRel != "" {
		li, lerr := acc.provider.Stat(lrcRel)
		if lerr == nil && !li.IsDir {
			rc, rerr := acc.provider.Read(lrcRel)
			if rerr == nil {
				defer rc.Close()
				buf := new(strings.Builder)
				if _, cerr := copyLimited(rc, buf, 2<<20); cerr == nil {
					raw := buf.String()
					meta, cues, synced := parseLRC(raw)
					writeJSON(w, http.StatusOK, lyricsResponse{
						HasLyrics: true,
						Raw:       raw,
						Format:    "lrc",
						Source:    "auto",
						Synced:    synced,
						Meta:      meta,
						Cues:      cues,
					})
					return
				}
			}
		}
	}

	writeJSON(w, http.StatusOK, lyricsResponse{HasLyrics: false, Format: "lrc", Source: "", Cues: []lyricCue{}})
}

// handleSaveAudioLyrics writes the edited lyrics STRICTLY as a sibling .lrc
// file next to the audio track (song path + song name + ".lrc"). Requires
// write access to the root; read-only roots reject the save. Any legacy DB
// override row is removed so the file is authoritative afterwards.
func (s *Server) handleSaveAudioLyrics(w http.ResponseWriter, r *http.Request) {
	// Mirror the read cap: a JSON body with multi-GB "raw" would otherwise
	// fill the disk because the .lrc sidecar is written verbatim. The read
	// side caps at 2 MiB; we do the same here so the round-trip is
	// symmetric.
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	rootID := queryParam(r, "root", "")
	rel, err := storage.CleanRelative(queryParam(r, "path", ""))
	if err != nil || rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid path", middleware.GetRequestID(r.Context()))
		return
	}
	// Writing a sidecar file needs write access (unlike the old DB-only save).
	acc, err := s.resolveAccess(r, rootID, true)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	if _, err := acc.provider.Stat(rel); err != nil {
		s.writeProviderError(w, r, err)
		return
	}

	var req struct {
		Raw    string `json:"raw"`
		Format string `json:"format"`
	}
	if err := decodeJSONLimit(r, &req, 2<<20); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	if len(req.Raw) > 2<<20 {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "lyrics content exceeds 2 MiB", middleware.GetRequestID(r.Context()))
		return
	}
	raw := strings.TrimRight(req.Raw, "\n")
	if strings.TrimSpace(raw) == "" {
		writeError(w, http.StatusBadRequest, "empty_lyrics", "lyrics content is empty", middleware.GetRequestID(r.Context()))
		return
	}

	lrcRel := siblingLRCPath(rel)
	if lrcRel == "" {
		writeError(w, http.StatusBadRequest, "no_extension", "track has no extension to derive an .lrc name from", middleware.GetRequestID(r.Context()))
		return
	}
	size := int64(len(raw))
	if err := acc.provider.Write(lrcRel, strings.NewReader(raw), size); err != nil {
		s.writeProviderError(w, r, err)
		return
	}

	// Strict mode: drop any legacy DB shadow so the .lrc file wins from now on.
	_, _ = s.DB.Exec(`DELETE FROM lyrics WHERE root_id = ? AND path = ?`, rootID, rel)

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"source": "auto",
		"format": "lrc",
		"path":   lrcRel,
	})
}

// handleDeleteAudioLyrics removes the sibling .lrc file (and any legacy DB
// shadow row), reverting the track to "no lyrics".
func (s *Server) handleDeleteAudioLyrics(w http.ResponseWriter, r *http.Request) {
	rootID := queryParam(r, "root", "")
	rel, err := storage.CleanRelative(queryParam(r, "path", ""))
	if err != nil || rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid path", middleware.GetRequestID(r.Context()))
		return
	}
	acc, err := s.resolveAccess(r, rootID, true)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	if lrcRel := siblingLRCPath(rel); lrcRel != "" {
		if li, err := acc.provider.Stat(lrcRel); err == nil && !li.IsDir {
			if err := acc.provider.Delete(lrcRel); err != nil {
				s.writeProviderError(w, r, err)
				return
			}
		}
	}
	_, _ = s.DB.Exec(`DELETE FROM lyrics WHERE root_id = ? AND path = ?`, rootID, rel)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// copyLimited copies at most max bytes from src to dst (guards against a
// pathological multi-MB "lyrics" file).
func copyLimited(src interface{ Read([]byte) (int, error) }, dst *strings.Builder, max int64) (int64, error) {
	buf := make([]byte, 32*1024)
	var total int64
	for {
		if total >= max {
			return total, nil
		}
		n, err := src.Read(buf)
		if n > 0 {
			// Respect the cap on the final chunk.
			if int64(n) > max-total {
				n = int(max - total)
			}
			dst.Write(buf[:n])
			total += int64(n)
		}
		if err != nil {
			if err.Error() == "EOF" {
				return total, nil
			}
			return total, err
		}
	}
}

