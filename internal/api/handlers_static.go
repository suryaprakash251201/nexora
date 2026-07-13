package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/nexora/nexora/internal/middleware"
)

// handleStatic serves the built web UI with SPA fallback, or a minimal
// placeholder when the frontend has not been built yet.
func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeError(w, http.StatusNotFound, "not_found", "API endpoint not found", middleware.GetRequestID(r.Context()))
		return
	}

	root := s.WebRoot
	if root == "" {
		s.servePlaceholder(w, r)
		return
	}

	clean := filepath.Clean(r.URL.Path)
	if clean == "/" || clean == "." {
		clean = "/index.html"
	}
	candidate := filepath.Join(root, filepath.FromSlash(clean))
	// Prevent escaping the web root.
	if !strings.HasPrefix(candidate, filepath.Clean(root)) {
		s.servePlaceholder(w, r)
		return
	}
	if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
		http.ServeFile(w, r, candidate)
		return
	}
	// SPA fallback to index.html for client-side routes.
	index := filepath.Join(root, "index.html")
	if _, err := os.Stat(index); err == nil {
		http.ServeFile(w, r, index)
		return
	}
	s.servePlaceholder(w, r)
}

func (s *Server) servePlaceholder(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(placeholderHTML))
}

const placeholderHTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Nexora</title>
<style>
  :root { color-scheme: dark light; }
  body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    display:grid; place-items:center; min-height:100vh; background:#0f1115; color:#e6e8ec; }
  .card { text-align:center; padding:2rem; max-width:520px; }
  h1 { font-size:2rem; margin:0 0 .25rem; letter-spacing:-.02em; }
  p { color:#9aa3af; line-height:1.5; }
  code { background:#1a1d23; padding:.15rem .4rem; border-radius:.35rem; color:#7dd3fc; }
  .api { margin-top:1.25rem; font-size:.9rem; }
</style>
</head>
<body>
  <div class="card">
    <h1>Nexora</h1>
    <p>Your private file workspace.</p>
    <p>The API is running. Build the web UI with <code>npm run build</code> in <code>/web</code> and it will be served here automatically.</p>
    <div class="api">
      <p>Health: <code>GET /healthz</code><br/>
      API: <code>/api/v1</code><br/>
      Version: <code>GET /api/v1/version</code></p>
	</div>
  </div>
</body>
</html>`
