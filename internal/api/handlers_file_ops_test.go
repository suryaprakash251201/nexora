package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeJSONRejectsOversizedBody(t *testing.T) {
	// 2 MiB of valid JSON must fail: the 1 MiB cap truncates it and the
	// decoder returns an error instead of buffering it all in memory.
	big := `{"root":"r","path":"` + strings.Repeat("a", 2<<20) + `"}`
	r := httptest.NewRequest(http.MethodPost, "/api/v1/files/rename", strings.NewReader(big))
	var v struct {
		Root string `json:"root"`
		Path string `json:"path"`
	}
	if err := decodeJSON(r, &v); err == nil {
		t.Fatal("expected error for body over the 1 MiB cap")
	}
	// Small bodies still decode normally.
	r2 := httptest.NewRequest(http.MethodPost, "/api/v1/files/rename", strings.NewReader(`{"root":"r","path":"a/b"}`))
	var v2 struct {
		Root string `json:"root"`
		Path string `json:"path"`
	}
	if err := decodeJSON(r2, &v2); err != nil || v2.Path != "a/b" {
		t.Fatalf("small body must decode, got err=%v val=%+v", err, v2)
	}
}
