// Package metrics provides a tiny, dependency-free metrics registry that
// exposes Prometheus text-format output. It is intentionally minimal to keep
// the binary small and idle memory low; it is only wired in when
// NEXORA_ENABLE_PROMETHEUS=true.
package metrics

import (
	"fmt"
	"net/http"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// Registry holds all counters and gauges.
type Registry struct {
	httpRequests   sync.Map // key: "method|code" -> *int64
	httpDurationNs int64    // total nanoseconds (for average latency)
	httpCount      int64

	loginFailures int64
	uploads       int64
	uploadBytes   int64

	// External providers (functions returning gauge values).
	gaugeMu sync.Mutex
	gauges  map[string]func() float64
}

// New creates a registry.
func New() *Registry {
	return &Registry{gauges: make(map[string]func() float64)}
}

// SetGauge registers a named gauge backed by a live function.
func (r *Registry) SetGauge(name string, fn func() float64) {
	r.gaugeMu.Lock()
	r.gauges[name] = fn
	r.gaugeMu.Unlock()
}

// IncLoginFailure increments the login failure counter.
func (r *Registry) IncLoginFailure() { atomic.AddInt64(&r.loginFailures, 1) }

// AddUpload records an upload of n bytes.
func (r *Registry) AddUpload(bytes int64) {
	atomic.AddInt64(&r.uploads, 1)
	atomic.AddInt64(&r.uploadBytes, bytes)
}

func (r *Registry) recordHTTP(method string, code int, dur time.Duration) {
	key := method + "|" + fmt.Sprint(code)
	v, _ := r.httpRequests.LoadOrStore(key, new(int64))
	atomic.AddInt64(v.(*int64), 1)
	atomic.AddInt64(&r.httpDurationNs, dur.Nanoseconds())
	atomic.AddInt64(&r.httpCount, 1)
}

// statusRecorder captures the response status code.
type statusRecorder struct {
	http.ResponseWriter
	code int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.code = code
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if s.code == 0 {
		s.code = http.StatusOK
	}
	return s.ResponseWriter.Write(b)
}

// Flush implements http.Flusher for SSE/streaming handlers.
func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// HTTPMiddleware records request counts and latency.
func (r *Registry) HTTPMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, code: 0}
			next.ServeHTTP(rec, req)
			if rec.code == 0 {
				rec.code = http.StatusOK
			}
			r.recordHTTP(req.Method, rec.code, time.Since(start))
		})
	}
}

// Handler returns the Prometheus text exposition handler.
func (r *Registry) Handler() http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")

		fmt.Fprintln(w, "# HELP nexora_http_requests_total Total HTTP requests by method and status.")
		fmt.Fprintln(w, "# TYPE nexora_http_requests_total counter")
		type kv struct {
			k string
			v int64
		}
		var rows []kv
		r.httpRequests.Range(func(key, val any) bool {
			rows = append(rows, kv{key.(string), atomic.LoadInt64(val.(*int64))})
			return true
		})
		sort.Slice(rows, func(i, j int) bool { return rows[i].k < rows[j].k })
		for _, row := range rows {
			parts := splitKey(row.k)
			fmt.Fprintf(w, "nexora_http_requests_total{method=%q,code=%q} %d\n", parts[0], parts[1], row.v)
		}

		count := atomic.LoadInt64(&r.httpCount)
		avgMs := 0.0
		if count > 0 {
			avgMs = float64(atomic.LoadInt64(&r.httpDurationNs)) / float64(count) / 1e6
		}
		metricLine(w, "nexora_http_request_duration_ms_avg", "Average HTTP request latency (ms).", "gauge", avgMs)
		metricLine(w, "nexora_login_failures_total", "Total failed login attempts.", "counter", float64(atomic.LoadInt64(&r.loginFailures)))
		metricLine(w, "nexora_uploads_total", "Total uploaded files.", "counter", float64(atomic.LoadInt64(&r.uploads)))
		metricLine(w, "nexora_upload_bytes_total", "Total uploaded bytes.", "counter", float64(atomic.LoadInt64(&r.uploadBytes)))

		r.gaugeMu.Lock()
		names := make([]string, 0, len(r.gauges))
		for n := range r.gauges {
			names = append(names, n)
		}
		sort.Strings(names)
		for _, n := range names {
			fn := r.gauges[n]
			r.gaugeMu.Unlock()
			metricLine(w, n, "Nexora runtime gauge.", "gauge", fn())
			r.gaugeMu.Lock()
		}
		r.gaugeMu.Unlock()
	}
}

func metricLine(w http.ResponseWriter, name, help, typ string, val float64) {
	fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s %s\n%s %g\n", name, help, name, typ, name, val)
}

func splitKey(k string) [2]string {
	for i := 0; i < len(k); i++ {
		if k[i] == '|' {
			return [2]string{k[:i], k[i+1:]}
		}
	}
	return [2]string{k, ""}
}
