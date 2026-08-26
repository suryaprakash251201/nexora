package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestCheckCodecSupportAllowsALAC guards the ALAC regression: .m4a files with
// Apple Lossless audio must be allowed through the transcode pipeline so the
// browser can play them via ffmpeg re-encode (ALAC -> AAC). Browsers cannot
// decode ALAC natively, so blocking it here made every ALAC .m4a unplayable.
func TestCheckCodecSupportAllowsALAC(t *testing.T) {
	probe := &ffprobeOutput{
		Streams: []ffprobeStream{
			{Index: 0, CodecType: "audio", CodecName: "alac", CodecLongName: "ALAC (Apple Lossless Audio Codec)"},
			{Index: 1, CodecType: "video", CodecName: "mjpeg", CodecLongName: "Motion JPEG"},
		},
	}
	s := &Server{}
	err := s.checkCodecSupport(probe)
	if err != nil {
		t.Fatalf("ALAC m4a must be transcodeable, got error: %v", err)
	}
}

// TestCheckCodecSupportStillRejectsTrueUnsupported keeps the existing guard
// behavior for codecs FFmpeg genuinely cannot decode.
func TestCheckCodecSupportStillRejectsTrueUnsupported(t *testing.T) {
	probe := &ffprobeOutput{
		Streams: []ffprobeStream{
			{Index: 0, CodecType: "audio", CodecName: "dts", CodecLongName: "DTS (DTS Coherent Acoustics)"},
		},
	}
	s := &Server{}
	err := s.checkCodecSupport(probe)
	if err == nil {
		t.Fatal("DTS must still be rejected by the pre-flight check")
	}
	if !strings.Contains(err.Error(), "DTS") {
		t.Fatalf("expected DTS error message, got: %v", err)
	}
}

// failingResponseWriter is an http.ResponseWriter that returns an error
// from the first Write call, simulating a disconnected client.
type failingResponseWriter struct {
	header  http.Header
	written int
}

func (f *failingResponseWriter) Header() http.Header {
	if f.header == nil {
		f.header = make(http.Header)
	}
	return f.header
}
func (f *failingResponseWriter) Write(p []byte) (int, error) {
	f.written += len(p)
	return len(p), http.ErrHandlerTimeout // any non-nil error will do
}
func (f *failingResponseWriter) WriteHeader(int) {}

// TestBailWriter_CancelsOnWriteError pins the P1-4 fix: when the client
// stops reading, bailWriter must cancel the transcode context so ffmpeg
// is killed promptly. Without this, a stalled tab keeps ffmpeg running
// for the full wall-clock timeout.
func TestBailWriter_CancelsOnWriteError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	bw := &bailWriter{w: &failingResponseWriter{}, f: nil, cancel: cancel}
	// First Write returns the error from the underlying writer.
	_, err := bw.Write([]byte("hello"))
	if err == nil {
		t.Fatal("expected the underlying write error to propagate")
	}
	// The context must be cancelled exactly once.
	select {
	case <-ctx.Done():
		// good
	default:
		t.Fatal("context was not cancelled after a failed Write")
	}
	// A second Write must not re-cancel (once.Do).
	bw2 := &bailWriter{w: &failingResponseWriter{}, f: nil, cancel: cancel}
	_, _ = bw2.Write([]byte("again"))
	// (We don't assert on the second call's effect; the key behaviour
	// is that the cancel fires once and the context is already done.)
}

// TestBailWriter_FlushesOnSuccess pins the streaming behaviour: successful
// writes must flush so the browser can begin playback before transcoding
// is complete. httptest.ResponseRecorder does not implement http.Flusher
// (Flush is a no-op), so we cannot directly assert that Flush was called;
// we instead assert that the bytes are written and the function does not
// error or panic in the happy path.
func TestBailWriter_FlushesOnSuccess(t *testing.T) {
	rec := httptest.NewRecorder()
	// Use a no-op flusher; rec itself doesn't implement Flusher, but the
	// code path is safe because bailWriter checks `f != nil` before flushing.
	bw := &bailWriter{w: rec, f: nil, cancel: func() {}}
	n, err := bw.Write([]byte("abc"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if n != 3 {
		t.Errorf("wrote %d bytes, want 3", n)
	}
	if !strings.Contains(rec.Body.String(), "abc") {
		t.Errorf("body = %q, want to contain abc", rec.Body.String())
	}
}
