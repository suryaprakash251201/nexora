package middleware

import (
	"compress/gzip"
	"io"
	"net/http"
	"strings"
)

// compressibleTypes lists the Content-Type prefixes a response must start
// with to be worth gzip-compressing. Binary media (images, audio, video,
// archives) is never compressed — those types are already compressed or are
// streamed with Range requests.
var compressibleTypes = []string{
	"text/",
	"application/json",
	"application/javascript",
	"application/x-javascript",
	"application/xml",
	"application/xhtml+xml",
	"application/wasm",
	"image/svg+xml",
	"font/ttf",
	"font/otf",
}

func isCompressible(contentType string) bool {
	for _, prefix := range compressibleTypes {
		if strings.HasPrefix(contentType, prefix) {
			return true
		}
	}
	return false
}

// gzipWriter is a ResponseWriter that transparently gzips the body when the
// request accepts gzip and the response has a compressible Content-Type.
// The decision is deferred until WriteHeader so handlers that set
// Content-Type/Content-Encoding themselves (thumbnails, raw media, download
// streams) pass through untouched.
type gzipWriter struct {
	http.ResponseWriter
	w             *gzip.Writer
	compressible  bool
	headerWritten bool
	status        int
}

func (g *gzipWriter) decide(code int) {
	if g.headerWritten {
		return
	}
	g.headerWritten = true
	g.status = code
	if code == http.StatusNoContent || code == http.StatusNotModified || code/100 != 2 {
		return
	}
	if g.Header().Get("Content-Encoding") != "" {
		return
	}
	g.compressible = isCompressible(g.Header().Get("Content-Type"))
	if g.compressible {
		g.Header().Set("Content-Encoding", "gzip")
		g.Header().Add("Vary", "Accept-Encoding")
		// Body size changes under compression; force chunked encoding so a
		// stale Content-Length can never be emitted.
		g.Header().Del("Content-Length")
	}
}

func (g *gzipWriter) WriteHeader(code int) {
	g.decide(code)
	g.ResponseWriter.WriteHeader(code)
}

func (g *gzipWriter) Write(b []byte) (int, error) {
	if !g.headerWritten {
		g.decide(http.StatusOK)
		g.ResponseWriter.WriteHeader(http.StatusOK)
	}
	if !g.compressible {
		return g.ResponseWriter.Write(b)
	}
	if g.w == nil {
		// Level 5: noticeably faster than 9 with a small size penalty.
		g.w, _ = gzip.NewWriterLevel(g.ResponseWriter, gzip.BestSpeed)
	}
	return g.w.Write(b)
}

func (g *gzipWriter) Flush() {
	if g.w != nil {
		_ = g.w.Flush()
	}
	if f, ok := g.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (g *gzipWriter) Unwrap() http.ResponseWriter { return g.ResponseWriter }

// Compress gzips compressible responses (HTML, CSS, JS, JSON, SVG, …) for
// clients that advertise gzip support. Media, downloads, and Range requests
// are passed through untouched.
func Compress(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Accept-Encoding may include "gzip" in a larger list, e.g.
		// "br, gzip, deflate". Match the token without false positives
		// ("gzipx" must not match).
		ae := r.Header.Get("Accept-Encoding")
		ok := false
		for _, part := range strings.Split(ae, ",") {
			tok := strings.TrimSpace(strings.SplitN(part, ";", 2)[0])
			if strings.EqualFold(tok, "gzip") {
				ok = true
				break
			}
		}
		// Range requests are served as streams — never compress those.
		if !ok || r.Header.Get("Range") != "" {
			next.ServeHTTP(w, r)
			return
		}
		gz := &gzipWriter{ResponseWriter: w}
		next.ServeHTTP(gz, r)
		if gz.w != nil {
			_ = gz.w.Close()
		}
	})
}

var _ io.Writer = (*gzipWriter)(nil)
var _ http.Flusher = (*gzipWriter)(nil)