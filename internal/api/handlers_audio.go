package api

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

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
func (s *Server) handleAudioInfo(w http.ResponseWriter, r *http.Request) {
	inputArg, rc, _, err := s.resolveAudioInput(r)
	if err != nil {
		s.writeAudioInputError(w, r, err)
		return
	}
	defer func() {
		if rc != nil {
			rc.Close()
		}
	}()

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
	writeJSON(w, http.StatusOK, info)
}

// ── Waveform peaks ──────────────────────────────────────────────────────────

const (
	waveformBuckets = 1000
	waveformRate    = 8000 // mono decode rate for peak extraction
	waveformCacheMax = 128
)

type waveformCacheEntry struct {
	peaks    []float64
	duration float64
	at       time.Time
}

var (
	waveformMu    sync.Mutex
	waveformCache = make(map[string]waveformCacheEntry)
)

// handleAudioWaveform decodes the audio to mono PCM and returns per-bucket peak
// amplitudes (0..1) for canvas waveform rendering. Results are cached in memory
// keyed by root+path+size+mtime so repeated renders are instant.
func (s *Server) handleAudioWaveform(w http.ResponseWriter, r *http.Request) {
	inputArg, rc, info, err := s.resolveAudioInput(r)
	if err != nil {
		s.writeAudioInputError(w, r, err)
		return
	}
	defer func() {
		if rc != nil {
			rc.Close()
		}
	}()

	rootID := queryParam(r, "root", "")
	rel, _ := storage.CleanRelative(queryParam(r, "path", ""))

	// Cache key includes size+mtime so edits invalidate the waveform.
	cacheKey := rootID + "|" + rel + "|" + strconv.FormatInt(info.Size, 10) + "|" + info.Modified.UTC().Format(time.RFC3339Nano)

	waveformMu.Lock()
	if entry, ok := waveformCache[cacheKey]; ok {
		entry.at = time.Now()
		waveformCache[cacheKey] = entry
		waveformMu.Unlock()
		writeWaveformJSON(w, entry.peaks, entry.duration)
		return
	}
	waveformMu.Unlock()

	ffp, _, err := detectFfmpeg()
	if err != nil {
		writeError(w, http.StatusNotImplemented, "transcode_unavailable", "waveform generation requires ffmpeg on the server", middleware.GetRequestID(r.Context()))
		return
	}

	peaks, duration, err := computeWaveform(ffp, inputArg, rc)
	if err != nil {
		s.Log.Warn("audio/waveform: generation failed", "error", err)
		writeError(w, http.StatusUnprocessableEntity, "waveform_failed", "could not generate waveform", middleware.GetRequestID(r.Context()))
		return
	}

	waveformMu.Lock()
	if len(waveformCache) >= waveformCacheMax {
		// Simple FIFO eviction: drop the oldest entry.
		var oldestKey string
		var oldest time.Time
		for k, v := range waveformCache {
			if oldestKey == "" || v.at.Before(oldest) {
				oldestKey, oldest = k, v.at
			}
		}
		delete(waveformCache, oldestKey)
	}
	waveformCache[cacheKey] = waveformCacheEntry{peaks: peaks, duration: duration, at: time.Now()}
	waveformMu.Unlock()

	writeWaveformJSON(w, peaks, duration)
}

func writeWaveformJSON(w http.ResponseWriter, peaks []float64, duration float64) {
	writeJSON(w, http.StatusOK, map[string]any{
		"buckets":  len(peaks),
		"duration": duration,
		"peaks":    peaks,
	})
}

// computeWaveform decodes input to mono 8kHz s16le and computes one peak
// (max |sample|) per bucket across the whole track. It streams ffmpeg's stdout
// so memory stays bounded regardless of file length.
func computeWaveform(ffmpegBin, inputArg string, rc io.ReadCloser) ([]float64, float64, error) {
	args := []string{
		"-hide_banner", "-loglevel", "error",
		"-i", inputArg,
		"-map", "0:a:0",
		"-ac", "1",
		"-ar", strconv.Itoa(waveformRate),
		"-f", "s16le",
		"pipe:1",
	}
	cmd := exec.Command(ffmpegBin, args...)
	if inputArg == "pipe:0" {
		cmd.Stdin = rc
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, 0, err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return nil, 0, err
	}

	// Stream in 64KB chunks, accumulate per-bucket max abs sample.
	const chunk = 64 * 1024
	buf := make([]byte, chunk)
	var sampleCount int64
	peaks := make([]float64, waveformBuckets)
	for {
		n, rerr := io.ReadFull(stdout, buf)
		sampleCount += int64(n / 2)
		for i := 0; i+1 < n; i += 2 {
			v := int16(binary.LittleEndian.Uint16(buf[i : i+2]))
			abs := v
			if abs < 0 {
				abs = -abs
			}
			idx := int((sampleCount-1) * int64(waveformBuckets) / max64(sampleCount, 1))
			if idx >= waveformBuckets {
				idx = waveformBuckets - 1
			}
			if idx < 0 {
				idx = 0
			}
			if float64(abs) > peaks[idx] {
				peaks[idx] = float64(abs)
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr == io.ErrUnexpectedEOF && n > 0 {
			// Partial final chunk already processed above; stop.
			break
		}
		if rerr != nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
			return nil, 0, rerr
		}
	}
	if werr := cmd.Wait(); werr != nil {
		return nil, 0, fmt.Errorf("ffmpeg decode failed: %w — %s", werr, strings.TrimSpace(stderr.String()))
	}

	// Normalize to 0..1.
	for i := range peaks {
		peaks[i] = peaks[i] / 32768.0
	}
	duration := float64(sampleCount) / waveformRate
	return peaks, duration, nil
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
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
		"waveform":  ffmpegErr == nil,
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
