package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"

	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/storage"
)

// transcodeSem limits concurrent ffmpeg jobs so a low-spec host is not
// overwhelmed by several transcodes at once.
var transcodeSem = make(chan struct{}, 2)

var (
	ffmpegOnce sync.Once
	ffmpegBin  string
	ffprobeBin string
	ffmpegErr  error
)

// detectFfmpeg locates the ffmpeg binary once and caches the result.
func detectFfmpeg() (string, string, error) {
	ffmpegOnce.Do(func() {
		ffmpegBin, ffmpegErr = exec.LookPath("ffmpeg")
		if ffmpegErr == nil {
			ffprobeBin, _ = exec.LookPath("ffprobe")
		}
	})
	return ffmpegBin, ffprobeBin, ffmpegErr
}

// knownUnsupportedCodecs lists codecs that FFmpeg commonly cannot decode or
// that would produce unwatchable output. This is used as a pre-flight check.
var knownUnsupportedCodecs = map[string]string{
	"dts":              "DTS audio is not supported — use a file with AAC or MP3 audio",
	"dca":              "DTS audio is not supported — use a file with AAC or MP3 audio",
	"truehd":           "Dolby TrueHD audio is not supported",
	"mlp":              "MLP (Meridian Lossless Packing) audio is not supported",
	"wmav1":            "Windows Media Audio 1 is not supported",
	"wmav2":            "Windows Media Audio 2 is not supported",
	"wmapro":           "Windows Media Audio Pro is not supported",
	"alac":             "ALAC audio is not supported — use a file with AAC or MP3",
	"dolbyvision":      "Dolby Vision video is not supported",
	"vp6":              "VP6 video is not supported",
	"vp6f":             "VP6 video is not supported",
	"svq1":             "Sorenson Video 1 is not supported",
	"svq3":             "Sorenson Video 3 is not supported",
	"wmv3":             "Windows Media Video 9 is not supported",
	"vc1":              "VC-1 video is not supported",
	"indeo5":           "Indeo 5 video is not supported",
	"cook":             "Cooker audio is not supported",
	"truespeech":       "TrueSpeech audio is not supported",
	"qdmc":             "QDesign Music audio is not supported",
	"qdm2":             "QDesign Music 2 audio is not supported",
	"siren":            "Siren audio is not supported",
	"atrac3":           "ATRAC3 audio is not supported",
	"atrac3p":          "ATRAC3+ audio is not supported",
	"atrac9":           "ATRAC9 audio is not supported",
	"opus":             "Opus audio requires a compatible decoder (not available)",
	// 10-bit HEVC is supported via pixel format conversion; warn but allow.
}

// ffprobeStream represents a single stream from ffprobe JSON output.
type ffprobeStream struct {
	Index       int    `json:"index"`
	CodecType   string `json:"codec_type"`
	CodecName   string `json:"codec_name"`
	CodecLongName string `json:"codec_long_name"`
	Profile     string `json:"profile"`
	PixFmt      string `json:"pix_fmt"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	SampleRate  string `json:"sample_rate"`
	Channels    int    `json:"channels"`
}

type ffprobeOutput struct {
	Streams []ffprobeStream `json:"streams"`
}

// probeFile runs ffprobe on the input file and returns parsed stream info.
func probeFile(ffprobe, input string) (*ffprobeOutput, error) {
	cmd := exec.Command(ffprobe,
		"-v", "quiet",
		"-print_format", "json",
		"-show_streams",
		input,
	)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ffprobe failed: %w — %s", err, strings.TrimSpace(stderr.String()))
	}
	var out ffprobeOutput
	if err := json.Unmarshal(stdout.Bytes(), &out); err != nil {
		return nil, fmt.Errorf("ffprobe JSON parse error: %w", err)
	}
	return &out, nil
}

// checkCodecSupport examines ffprobe output and returns a user-friendly error
// if any stream uses an unsupported codec. It also logs warnings for known
// edge-cases (e.g. 10-bit HEVC).
func (s *Server) checkCodecSupport(probe *ffprobeOutput) error {
	var unsupported []string
	for _, st := range probe.Streams {
		codec := strings.ToLower(st.CodecName)
		if reason, ok := knownUnsupportedCodecs[codec]; ok {
			unsupported = append(unsupported, fmt.Sprintf(
				"stream #%d (%s): %s (%s)",
				st.Index, st.CodecType, st.CodecLongName, reason,
			))
			continue
		}
		// Warn about 10-bit video (needs pix_fmt conversion).
		if st.CodecType == "video" && (strings.Contains(st.PixFmt, "10le") || strings.Contains(st.PixFmt, "12le")) {
			s.Log.Warn("transcode: high-bit-depth video, will convert to 8-bit",
				"codec", st.CodecName,
				"pix_fmt", st.PixFmt,
				"stream", st.Index,
			)
		}
	}
	if len(unsupported) > 0 {
		return fmt.Errorf("unsupported codec(s): %s", strings.Join(unsupported, "; "))
	}
	return nil
}

// flushWriter streams ffmpeg's stdout to the client and flushes so the
// browser can begin playback before the whole file is transcoded.
type flushWriter struct {
	w http.ResponseWriter
	f http.Flusher
}

func (fw *flushWriter) Write(p []byte) (int, error) {
	n, err := fw.w.Write(p)
	if fw.f != nil {
		fw.f.Flush()
	}
	return n, err
}

// handleTranscode converts an unsupported video (e.g. Matroska/.mkv) into a
// browser-playable, streamable fragmented MP4 using ffmpeg. The transcoded
// bytes are piped straight to the client so playback can start immediately.
//
// Parameters:
//   - root, path   — file identifier (required)
//   - session      — client-generated UUID for session management (required)
//   - start        — seek offset in seconds (optional, default 0)
//
// The session parameter lets the server explicitly kill the previous ffmpeg
// process when the client seeks, rather than relying on HTTP connection abort.
// Clients should generate a UUID via crypto.randomUUID() and reuse it across
// seeks for the same playback session.
func (s *Server) handleTranscode(w http.ResponseWriter, r *http.Request) {
	// Ensure the stale-session cleanup goroutine is running.
	tcm.startCleanup()

	rootID := queryParam(r, "root", "")
	rel, err := storage.CleanRelative(queryParam(r, "path", ""))
	sessionID := queryParam(r, "session", "")

	// Parse optional start offset (seconds) for server-side seeking.
	var startOffset float64
	if startStr := queryParam(r, "start", ""); startStr != "" {
		if parsed, parseErr := strconv.ParseFloat(startStr, 64); parseErr == nil && parsed > 0 {
			startOffset = parsed
		}
	}

	if err != nil || rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid path", middleware.GetRequestID(r.Context()))
		return
	}
	if sessionID == "" {
		writeError(w, http.StatusBadRequest, "missing_session", "session parameter is required", middleware.GetRequestID(r.Context()))
		return
	}
	acc, err := s.resolveAccess(r, rootID, false)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	info, err := acc.provider.Stat(rel)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	if info.IsDir {
		writeError(w, http.StatusBadRequest, "is_directory", "cannot transcode a directory", middleware.GetRequestID(r.Context()))
		return
	}
	if !strings.HasPrefix(info.Mime, "video/") {
		writeError(w, http.StatusUnsupportedMediaType, "unsupported", "only video files can be transcoded", middleware.GetRequestID(r.Context()))
		return
	}
	if r.Header.Get("Range") == "" {
		s.recordRecent(r, rootID, rel, "access")
	}

	ffp, ffprobeP, err := detectFfmpeg()
	if err != nil {
		writeError(w, http.StatusNotImplemented, "transcode_unavailable", "transcoding is not available on this server (ffmpeg not installed)", middleware.GetRequestID(r.Context()))
		return
	}

	// Limit concurrency to protect the host.
	select {
	case transcodeSem <- struct{}{}:
		defer func() { <-transcodeSem }()
	default:
		writeError(w, http.StatusTooManyRequests, "transcode_busy", "too many transcodes in progress, try again later", middleware.GetRequestID(r.Context()))
		return
	}

	rc, err := acc.provider.Read(rel)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}

	// Prefer passing the real file path (seekable) when we have a local file;
	// otherwise stream the reader into ffmpeg's stdin.
	inputArg := "pipe:0"
	if f, ok := rc.(*os.File); ok {
		inputArg = f.Name()
		rc.Close()
	}

	// --- Pre-flight codec check (only when we have a real file path) ---
	if inputArg != "pipe:0" && ffprobeP != "" {
		probe, pErr := probeFile(ffprobeP, inputArg)
		if pErr != nil {
			s.Log.Warn("transcode: ffprobe preflight failed, proceeding anyway", "error", pErr)
		} else if cErr := s.checkCodecSupport(probe); cErr != nil {
			s.Log.Error("transcode: preflight rejected", "error", cErr)
			writeError(w, http.StatusUnsupportedMediaType, "unsupported_codec", cErr.Error(), middleware.GetRequestID(r.Context()))
			return
		}
	}

	// Create a cancellable context for this session.
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// Kill any existing ffmpeg for this session before creating the new one.
	// This prevents overlapping processes when the client seeks rapidly.
	tcm.killSession(sessionID)

	// Build ffmpeg args. When a start offset is requested, use fast input
	// seeking (-ss before -i) so ffmpeg jumps to the nearest keyframe and
	// begins transcoding from there instead of processing the whole file.
	ffArgs := []string{
		"-hide_banner", "-loglevel", "warning",
	}
	if startOffset > 0 {
		ffArgs = append(ffArgs, "-ss", fmt.Sprintf("%.3f", startOffset))
	}
	ffArgs = append(ffArgs,
		"-i", inputArg,
		"-map", "0:v:0", "-map", "0:a:0?",
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
		"-vf", "format=yuv420p",
		"-c:a", "aac", "-b:a", "128k",
		"-sn", "-dn",
		"-movflags", "frag_keyframe+empty_moov",
		"-f", "mp4",
		"pipe:1",
	)

	cmd := exec.CommandContext(ctx, ffp, ffArgs...)
	if inputArg == "pipe:0" {
		cmd.Stdin = rc
	}

	// Register the command with the session manager so it can be killed on seek.
	tcm.startSession(sessionID, rootID, rel, cancel, cmd)

	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Content-Disposition", "inline; filename*=UTF-8''"+urlEncode(info.Name))
	w.WriteHeader(http.StatusOK)

	stderr := &bytes.Buffer{}
	cmd.Stderr = stderr
	if flusher, ok := w.(http.Flusher); ok {
		cmd.Stdout = &flushWriter{w: w, f: flusher}
	} else {
		cmd.Stdout = w
	}

	runErr := cmd.Run()
	if inputArg == "pipe:0" && rc != nil {
		rc.Close()
	}

	// Clean up the session after ffmpeg exits (or is killed).
	tcm.stopSession(sessionID)

	if runErr != nil {
		if ctx.Err() == context.Canceled || ctx.Err() == context.DeadlineExceeded {
			return // client disconnected or session was replaced by a seek
		}
		s.Log.Error("transcode failed", "error", runErr, "detail", stderr.String())
	}
}
