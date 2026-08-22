package events

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nexora/nexora/internal/database"
)

func newTestBus(t *testing.T) *Bus {
	t.Helper()
	db, err := database.Open("sqlite", t.TempDir()+"/events.db", "")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	b := NewBus(db, nil)
	t.Cleanup(b.Stop)
	return b
}

func TestSubscribeRoutesToEveryRequestedType(t *testing.T) {
	b := newTestBus(t)
	ch := b.Subscribe(4, EventFileCreated, EventFileMoved)

	b.Emit(Event{Type: EventFileCreated, Path: "a"})
	b.Emit(Event{Type: EventFileMoved, Path: "b"})
	b.Emit(Event{Type: EventFileDeleted, Path: "c"}) // not subscribed

	select {
	case e := <-ch:
		if e.Type != EventFileCreated {
			t.Fatalf("first event type = %q, want %q", e.Type, EventFileCreated)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for first event")
	}
	select {
	case e := <-ch:
		if e.Type != EventFileMoved {
			t.Fatalf("second event type = %q, want %q", e.Type, EventFileMoved)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for second event")
	}
	select {
	case e := <-ch:
		t.Fatalf("unexpected event for unsubscribed type: %q", e.Type)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestSubscribeAllAndUnsubscribe(t *testing.T) {
	b := newTestBus(t)
	ch := b.Subscribe(4) // all events

	b.Emit(Event{Type: EventFileDeleted, Path: "x"})
	select {
	case e := <-ch:
		if e.Type != EventFileDeleted {
			t.Fatalf("got %q", e.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out")
	}

	b.Unsubscribe(ch)
	b.Emit(Event{Type: EventFileDeleted, Path: "y"})
	select {
	case e := <-ch:
		t.Fatalf("received event after unsubscribe: %q", e.Type)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestSignatureIsRealHMACSHA256(t *testing.T) {
	payload := []byte(`{"type":"file.created"}`)
	secret := "s3cr3t"

	got := Signature(secret, payload)

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	want := hex.EncodeToString(mac.Sum(nil))
	if got != want {
		t.Fatalf("signature mismatch:\n got %s\nwant %s", got, want)
	}

	// Empty secret -> empty signature (no auth promised).
	if Signature("", payload) != "" {
		t.Fatal("empty secret must yield empty signature")
	}

	// Different secret must not produce the same signature.
	if Signature("other", payload) == got {
		t.Fatal("signature must depend on the secret")
	}
}

func TestWebhookPersistenceRoundtrip(t *testing.T) {
	dbPath := t.TempDir() + "/events.db"
	db, err := database.Open("sqlite", dbPath, "")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	b := NewBus(db, nil)
	defer b.Stop()

	b.RegisterWebhook(WebhookTarget{
		ID:     "wh_1",
		URL:    "https://example.com/hook",
		Secret: "abc",
		Active: true,
		Events: []string{"file.created", "file.deleted"},
	})
	db.Close()

	// Simulate a restart: reopen the DB and load persisted targets.
	db2, err := database.Open("sqlite", dbPath, "")
	if err != nil {
		t.Fatalf("reopen db: %v", err)
	}
	defer db2.Close()
	b2 := NewBus(db2, nil)
	defer b2.Stop()
	if err := b2.LoadWebhooks(); err != nil {
		t.Fatalf("load webhooks: %v", err)
	}

	listed := b2.ListWebhooks()
	if len(listed) != 1 {
		t.Fatalf("expected 1 webhook after reload, got %d", len(listed))
	}
	got := listed[0]
	if got.ID != "wh_1" || got.URL != "https://example.com/hook" || !got.Active {
		t.Fatalf("reloaded webhook mismatch: %+v", got)
	}
	if len(got.Events) != 2 {
		t.Fatalf("reloaded event subscriptions mismatch: %v", got.Events)
	}

	// Unregister must delete from the DB too.
	b2.UnregisterWebhook("wh_1")
	if got := b2.ListWebhooks(); len(got) != 0 {
		t.Fatalf("expected empty list after unregister, got %+v", got)
	}
}

func TestWebhookDeliveryWithSignature(t *testing.T) {
	b := newTestBus(t)
	secret := "hook-secret"

	var mu sync.Mutex
	received := map[string]string{} // header -> value
	var body []byte
	done := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, 8192)
		n, _ := r.Body.Read(buf)
		mu.Lock()
		received["event"] = r.Header.Get("X-Nexora-Event")
		received["signature"] = r.Header.Get("X-Nexora-Signature")
		body = append([]byte(nil), buf[:n]...)
		mu.Unlock()
		close(done)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	b.RegisterWebhook(WebhookTarget{
		ID:     "wh_deliver",
		URL:    srv.URL,
		Secret: secret,
		Active: true,
		Events: []string{"file.created"},
	})

	payload := Event{Type: EventFileCreated, RootID: "r", Path: "p.txt", Size: 42}
	b.Emit(payload)

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("webhook was not delivered")
	}

	mu.Lock()
	defer mu.Unlock()
	if received["event"] != "file.created" {
		t.Fatalf("X-Nexora-Event = %q", received["event"])
	}
	if received["signature"] == "" {
		t.Fatal("missing X-Nexora-Signature header")
	}
	// The signature must be a valid HMAC of the exact delivered body.
	if !validSignature(secret, body, received["signature"]) {
		t.Fatal("delivered signature is not a valid HMAC of the delivered body")
	}
}

func TestWebhookRetriesOn5xx(t *testing.T) {
	b := newTestBus(t)
	var attempts int
	var mu sync.Mutex
	done := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		attempts++
		n := attempts
		mu.Unlock()
		if n < 3 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		close(done)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	b.RegisterWebhook(WebhookTarget{ID: "wh_retry", URL: srv.URL, Active: true})
	// Speed up backoff for the test.
	oldDelay := webhookBaseDelay
	webhookBaseDelay = 5 * time.Millisecond
	defer func() { webhookBaseDelay = oldDelay }()

	b.Emit(Event{Type: EventFileCreated})

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("webhook did not succeed after retries")
	}
	mu.Lock()
	defer mu.Unlock()
	if attempts < 3 {
		t.Fatalf("expected retries, got %d attempts", attempts)
	}
}

func TestWebhookSkipsInactiveAndNonMatching(t *testing.T) {
	b := newTestBus(t)
	var mu sync.Mutex
	hit := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		hit = true
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	b.RegisterWebhook(WebhookTarget{ID: "wh_inactive", URL: srv.URL, Active: false})
	b.RegisterWebhook(WebhookTarget{ID: "wh_other", URL: srv.URL, Active: true, Events: []string{"file.deleted"}})

	b.Emit(Event{Type: EventFileCreated})
	time.Sleep(100 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	if hit {
		t.Fatal("webhook delivered to inactive or non-matching target")
	}
}

func validSignature(secret string, payload []byte, sig string) bool {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	want := hex.EncodeToString(mac.Sum(nil))
	return strings.EqualFold(sig, want)
}
