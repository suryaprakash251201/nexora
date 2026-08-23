package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/storage"
)

// ── Audio metadata (ffprobe) ────────────────────────────────────────────────

// flexInt unmarshals JSON numbers AND numeric strings, because ffprobe output
// is inconsistent between versions (bits_per_raw_sample comes as "16",
// bits_per_sample as 16, and "N/A" for some codecs).
type flexInt int

func (f *flexInt) UnmarshalJSON(b []byte) error {
	*f = 0
	if len(b) == 0 || string(b) == "null" {
		return nil
	}
	var n float64
	if err := json.Unmarshal(b, &n); err == nil {
		*f = flexInt(n)
		return nil
	}
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		if v, perr := strconv.ParseFloat(strings.TrimSpace(s), 64); perr == nil {
			*f = flexInt(v)
		}
	}
	return nil // tolerate "N/A" and other non-numeric markers
}

type audioProbeStream struct {
	CodecType        string            `json:"codec_type"`
	CodecName        string            `json:"codec_name"`
	CodecLongName    string            `json:"codec_long_name"`
	SampleRate       string            `json:"sample_rate"`
	BitsPerRawSample flexInt           `json:"bits_per_raw_sample"`
	BitsPerSample    flexInt           `json:"bits_per_sample"`
	Channels         int               `json:"channels"`
	ChannelLayout    string            `json:"channel_layout"`
	BitRate          string            `json:"bit_rate"`
	Duration         string            `json:"duration"`
	Tags             map[string]string `json:"tags"`
}

type audioProbeFormat struct {
	FormatName string            `json:"format_name"`
	Duration   string            `json:"duration"`
	BitRate    string            `json:"bit_rate"`
	Tags       map[string]string `json:"tags"`
}

type audioProbe struct {
	Streams []audioProbeStream `json:"streams"`
	Format  audioProbeFormat   `json:"format"`
}

// probeAudio runs a rich ffprobe (streams + format) on the given input.
func probeAudio(ffprobe, input string) (*audioProbe, error) {
	cmd := exec.Command(ffprobe,
		"-v", "quiet",
		"-print_format", "json",
		"-show_streams",
		"-show_format",
		input,
	)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ffprobe failed: %w — %s", err, strings.TrimSpace(stderr.String()))
	}
	var out audioProbe
	if err := json.Unmarshal(stdout.Bytes(), &out); err != nil {
		return nil, fmt.Errorf("ffprobe JSON parse error: %w", err)
	}
	return &out, nil
}

// audioInfo is the JSON response of GET /audio/info.
type audioInfo struct {
	Codec        string            `json:"codec"`
	CodecLong    string            `json:"codec_long"`
	SampleRate   int               `json:"sample_rate"`
	BitDepth     int               `json:"bit_depth"`
	Channels     int               `json:"channels"`
	ChannelLayout string           `json:"channel_layout"`
	BitRate      int64             `json:"bit_rate"`
	Duration     float64           `json:"duration"`
	Format       string            `json:"format"`
	Tags         map[string]string `json:"tags"`
	Lossless     bool              `json:"lossless"`
}

var losslessCodecs = map[string]bool{
	"flac": true, "alac": true, "wav": true, "pcm_s16le": true,
	"pcm_s24le": true, "pcm_s32le": true, "aiff": true, "ape": true,
	"wavpack": true, "tta": true, "pcm_f32le": true, "pcm_f64le": true,
}

// resolveAudioInput validates the request and returns an ffmpeg-friendly input
// argument ("pipe:0" or a real seekable path), the open reader (which must be
// closed unless it was converted to a real path), and the file info.
func (s *Server) resolveAudioInput(r *http.Request) (string, io.ReadCloser, storage.FileInfo, error) {
	rootID := queryParam(r, "root", "")
	rel, err := storage.CleanRelative(queryParam(r, "path", ""))
	if err != nil || rel == "" {
		return "", nil, storage.FileInfo{}, errInvalidAudioPath
	}
	acc, err := s.resolveAccess(r, rootID, false)
	if err != nil {
		return "", nil, storage.FileInfo{}, err
	}
	info, err := acc.provider.Stat(rel)
	if err != nil {
		return "", nil, storage.FileInfo{}, err
	}
	if info.IsDir {
		return "", nil, storage.FileInfo{}, errIsDirectory
	}
	if !strings.HasPrefix(info.Mime, "audio/") {
		return "", nil, storage.FileInfo{}, errNotAudio
	}
	rc, err := acc.provider.Read(rel)
	if err != nil {
		return "", nil, storage.FileInfo{}, err
	}
	inputArg := "pipe:0"
	if f, ok := rc.(*os.File); ok {
		inputArg = f.Name()
		rc.Close()
	}
	return inputArg, rc, info, nil
}

var (
	errInvalidAudioPath = fmt.Errorf("invalid audio path")
	errNotAudio         = fmt.Errorf("not an audio file")
	errIsDirectory      = fmt.Errorf("path is a directory")
)

func (s *Server) writeAudioInputError(w http.ResponseWriter, r *http.Request, err error) {
	rid := middleware.GetRequestID(r.Context())
	switch err {
	case errInvalidAudioPath:
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid path", rid)
	case errNotAudio:
		writeError(w, http.StatusUnsupportedMediaType, "not_audio", "file is not audio", rid)
	case errIsDirectory:
		writeError(w, http.StatusBadRequest, "is_directory", "cannot read audio metadata for a directory", rid)
	default:
		s.writeProviderError(w, r, err)
	}
}

// handleAudioInfo returns rich ffprobe metadata (codec, sample rate, bit depth,
// channels, tags, duration) for the audio file at root+path.
//
// Results are memoized per resolved input + size + modtime: the client probes
// every ambiguous .m4a/.m4b on first play, and multiple clients (or a cleared
// browser cache) would otherwise respawn ffprobe for identical files. A
// replaced file gets a new size/mtime and re-probes naturally.
var (
	audioInfoCache   sync.Map // string -> audioInfo
	audioInfoCacheN  atomic.Int64
	audioInfoCacheMax = 4096
)

func (s *Server) handleAudioInfo(w http.ResponseWriter, r *http.Request) {
	inputArg, rc, fi, err := s.resolveAudioInput(r)
	if err != nil {
		s.writeAudioInputError(w, r, err)
		return
	}
	defer func() {
		if rc != nil {
			rc.Close()
		}
	}()

	// Freshness-aware cache key from root|path|size|modtime (NOT inputArg:
	// non-local inputs all resolve to "pipe:0"). Unknown stat info skips
	// caching rather than serving potentially stale metadata forever.
	var cacheKey string
	cacheable := !fi.Modified.IsZero() || fi.Size != 0
	if cacheable {
		cacheKey = fmt.Sprintf("%s|%s|%d|%d",
			queryParam(r, "root", ""), queryParam(r, "path", ""), fi.Size, fi.Modified.Unix())
		if cached, ok := audioInfoCache.Load(cacheKey); ok {
			writeJSON(w, http.StatusOK, cached.(audioInfo))
			return
		}
	}

	ffp, ffprobeP, err := detectFfmpeg()
	if err != nil {
		writeError(w, http.StatusNotImplemented, "transcode_unavailable", "audio metadata requires ffmpeg on the server", middleware.GetRequestID(r.Context()))
		return
	}
	_ = ffp

	probe, err := probeAudio(ffprobeP, inputArg)
	if err != nil {
		s.Log.Warn("audio/info: ffprobe failed", "error", err)
		writeError(w, http.StatusUnprocessableEntity, "probe_failed", "could not read audio metadata", middleware.GetRequestID(r.Context()))
		return
	}

	var st *audioProbeStream
	for i := range probe.Streams {
		if probe.Streams[i].CodecType == "audio" {
			st = &probe.Streams[i]
			break
		}
	}
	if st == nil {
		writeError(w, http.StatusUnprocessableEntity, "no_audio_stream", "no audio stream found", middleware.GetRequestID(r.Context()))
		return
	}

	info := audioInfo{
		Codec:         st.CodecName,
		CodecLong:     st.CodecLongName,
		SampleRate:    parseIntSafe(st.SampleRate),
		BitDepth:      firstPositive(int(st.BitsPerRawSample), int(st.BitsPerSample)),
		Channels:      st.Channels,
		ChannelLayout: st.ChannelLayout,
		BitRate:       parseInt64Safe(firstNonEmpty(st.BitRate, probe.Format.BitRate)),
		Duration:      parseFloatSafe(firstNonEmpty(st.Duration, probe.Format.Duration)),
		Format:        probe.Format.FormatName,
		Tags:          st.Tags,
		Lossless:      losslessCodecs[st.CodecName],
	}
	if len(info.Tags) == 0 {
		info.Tags = probe.Format.Tags
	}
	if cacheable && audioInfoCacheN.Add(1) > int64(audioInfoCacheMax) {
		// Naive bound: wipe and start over rather than growing unbounded.
		audioInfoCache.Range(func(k, _ any) bool {
			audioInfoCache.Delete(k)
			return true
		})
		audioInfoCacheN.Store(0)
	}
	if cacheable {
		audioInfoCache.Store(cacheKey, info)
	}
	writeJSON(w, http.StatusOK, info)
}

// ── Server capabilities ─────────────────────────────────────────────────────

// handleAudioFormats reports what the server can do for audio playback so the
// frontend can adapt (e.g. hide the lossless toggle when ffmpeg is missing).
func (s *Server) handleAudioFormats(w http.ResponseWriter, r *http.Request) {
	_, _, ffmpegErr := detectFfmpeg()
	writeJSON(w, http.StatusOK, map[string]any{
		"ffmpeg":    ffmpegErr == nil,
		"transcode": ffmpegErr == nil,
		"formats":   []string{"aac", "flac", "flac24", "wav"},
	})
}

// ── small helpers ───────────────────────────────────────────────────────────

func parseIntSafe(s string) int {
	v, _ := strconv.Atoi(s)
	return v
}

func parseInt64Safe(s string) int64 {
	v, _ := strconv.ParseInt(s, 10, 64)
	return v
}

func parseFloatSafe(s string) float64 {
	v, _ := strconv.ParseFloat(s, 64)
	return v
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func firstPositive(vals ...int) int {
	for _, v := range vals {
		if v > 0 {
			return v
		}
	}
	return 0
}
