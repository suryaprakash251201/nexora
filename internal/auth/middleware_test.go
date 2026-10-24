package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAcceptsQueryToken(t *testing.T) {
	cases := []struct {
		name   string
		method string
		path   string
		want   bool
	}{
		{"raw media GET", "GET", "/api/v1/files/raw", true},
		{"thumbnail GET", "GET", "/api/v1/files/thumbnail", true},
		{"transcode GET", "GET", "/api/v1/files/transcode", true},
		{"hls playlist GET", "GET", "/api/v1/files/hls/playlist.m3u8", true},
		{"hls segment GET", "GET", "/api/v1/files/hls/segment.ts", true},
		{"version download GET", "GET", "/api/v1/files/versions/abc/download", true},
		{"lyrics GET", "GET", "/api/v1/audio/lyrics", true},
		{"job events GET", "GET", "/api/v1/jobs/job-1/events", true},
		{"raw media HEAD", "HEAD", "/api/v1/files/raw", true},
		{"auth session GET rejected", "GET", "/api/v1/auth/session", false},
		{"file list GET rejected", "GET", "/api/v1/files/list", false},
		{"stats GET rejected", "GET", "/api/v1/stats", false},
		{"raw media POST rejected", "POST", "/api/v1/files/raw", false},
		{"root path rejected", "GET", "/", false},
		{"prefix-suffix attack rejected", "GET", "/api/v1/files/rawish", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(tc.method, tc.path+"?token=abc", nil)
			// normalize: httptest sets URL.Path from the target
			if got := acceptsQueryToken(r); got != tc.want {
				t.Fatalf("acceptsQueryToken(%s %s) = %v, want %v", tc.method, tc.path, got, tc.want)
			}
		})
	}

	// No token in query -> never accepted, even on media paths.
	r := httptest.NewRequest(http.MethodGet, "/api/v1/files/raw", nil)
	if acceptsQueryToken(r) {
		t.Fatal("acceptsQueryToken without ?token= must be false")
	}
}
