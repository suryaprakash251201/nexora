package api

import (
	"bytes"
	"context"
	"net/http"
	"os"
	"os/exec"
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
	ffmpegErr  error
)

// detectFfmpeg locates the ffmpeg binary once and caches the result.
func detectFfmpeg() (string, error) {
	ffmpegOnce.Do(func() {
		ffmpegBin, ffmpegErr = exec.LookPath("ffmpeg")
	})
	return ffmpegBin, ffmpegErr
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
func (s *Server) handleTranscode(w http.ResponseWriter, r *http.Request) {
	rootID := queryParam(r, "root", "")
	rel, err := storage.CleanRelative(queryParam(r, "path", ""))
	if err != nil || rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid path", middleware.GetRequestID(r.Context()))
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

	ffp, err := detectFfmpeg()
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

	ctx := r.Context()
	cmd := exec.CommandContext(ctx, ffp,
		"-hide_banner", "-loglevel", "error",
		"-i", inputArg,
		"-map", "0:v:0", "-map", "0:a:0?",
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
		"-c:a", "aac", "-b:a", "128k",
		"-sn", "-dn",
		"-movflags", "frag_keyframe+empty_moov+default_base_isom",
		"-f", "mp4",
		"pipe:1",
	)
	if inputArg == "pipe:0" {
		cmd.Stdin = rc
	}

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
	if runErr != nil {
		if ctx.Err() == context.Canceled {
			return // client disconnected; nothing to report
		}
		s.Log.Error("transcode failed", "error", runErr, "detail", stderr.String())
	}
}
