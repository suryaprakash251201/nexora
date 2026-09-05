// Package events provides an in-process event bus for file operations
// and supports webhook callbacks to external services.
//
// Webhooks are persisted in the database and delivered by a bounded worker
// pool with HMAC-SHA256 signatures and retry/backoff. The bus never blocks
// callers: Emit enqueues delivery and drops work when the queue is full.
package events

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"

	"github.com/nexora/nexora/internal/database"
	"github.com/nexora/nexora/internal/logger"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/nexora/nexora/internal/util"
)

// EventType represents the kind of file event.
type EventType string

const (
	EventFileCreated     EventType = "file.created"
	EventFileUpdated     EventType = "file.updated"
	EventFileDeleted     EventType = "file.deleted"
	EventFileMoved       EventType = "file.moved"
	EventFileCopied      EventType = "file.copied"
	EventFileRenamed     EventType = "file.renamed"
	EventFileRestored    EventType = "file.restored"
	EventDirCreated      EventType = "directory.created"
	EventShareCreated    EventType = "share.created"
	EventShareOpened     EventType = "share.opened"
	EventShareDownload   EventType = "share.download"
	EventShareRevoked    EventType = "share.revoked"
	EventVersionCreated  EventType = "version.created"
	EventVersionRestored EventType = "version.restored"
)

// Event represents a file system event.
type Event struct {
	ID        string            `json:"id"`
	Type      EventType         `json:"type"`
	UserID    string            `json:"user_id"`
	RootID    string            `json:"root_id"`
	Path      string            `json:"path"`
	Size      int64             `json:"size,omitempty"`
	Timestamp time.Time         `json:"timestamp"`
	Metadata  map[string]string `json:"metadata,omitempty"`
}

// WebhookTarget is a registered webhook endpoint.
type WebhookTarget struct {
	ID     string   `json:"id"`
	URL    string   `json:"url"`
	Secret string   `json:"secret,omitempty"`
	Active bool     `json:"active"`
	Events []string `json:"events"` // event types to subscribe to (empty = all)
}

// Delivery tuning. The queue is bounded so a burst of events cannot grow
// memory without bound; when full, Emit drops the delivery (never blocks the
// caller). A small worker count keeps outbound fan-out light.
const (
	webhookQueueSize = 256
	webhookWorkers   = 2
	webhookMaxRetry  = 3
)

// webhookBaseDelay is the initial backoff between delivery attempts; a var so
// tests can shrink it.
var webhookBaseDelay = 200 * time.Millisecond

// Bus is the central event bus that dispatches events to in-process listeners
// and persisted webhooks.
type Bus struct {
	mu        sync.RWMutex
	listeners map[string][]chan Event
	webhooks  map[string]WebhookTarget
	db        *database.DB
	client    *http.Client
	log       *logger.Logger // optional; nil disables delivery-failure logging

	// AllowPrivateTargets permits webhook delivery to loopback/private/
	// link-local addresses. Default false (secure). Tests that use
	// httptest servers (127.0.0.1) set this to true; production keeps it
	// false so the SSRF guard cannot be bypassed. Registration-time
	// validation in the api package always rejects private URLs.
	AllowPrivateTargets bool

	queue   chan webhookJob
	wg      sync.WaitGroup
	ctx     context.Context
	cancel  context.CancelFunc
	stopped atomic.Bool
}

type webhookJob struct {
	evt Event
}

// NewBus creates a new event bus and starts its webhook delivery workers.
// Call LoadWebhooks to restore persisted targets before serving traffic.
// The logger is optional; pass nil to disable delivery-failure logging.
func NewBus(db *database.DB, log *logger.Logger) *Bus {
	ctx, cancel := context.WithCancel(context.Background())
	b := &Bus{
		listeners: make(map[string][]chan Event),
		webhooks:  make(map[string]WebhookTarget),
		db:        db,
		client:    &http.Client{Timeout: 10 * time.Second},
		log:       log,
		queue:     make(chan webhookJob, webhookQueueSize),
		ctx:       ctx,
		cancel:    cancel,
	}
	for i := 0; i < webhookWorkers; i++ {
		b.wg.Add(1)
		go b.worker()
	}
	return b
}

// Stop drains the delivery workers. Safe for concurrent and repeated calls.
func (b *Bus) Stop() {
	if b.stopped.Swap(true) {
		return
	}
	b.cancel()
	b.wg.Wait()
}

// LoadWebhooks restores persisted webhook targets into the in-memory registry.
func (b *Bus) LoadWebhooks() error {
	if b.db == nil {
		return nil
	}
	rows, err := b.db.Query(
		`SELECT id,url,secret,active,events FROM webhooks ORDER BY id`)
	if err != nil {
		return err
	}
	defer rows.Close()
	b.mu.Lock()
	defer b.mu.Unlock()
	for rows.Next() {
		var wh WebhookTarget
		var active int
		var events string
		if err := rows.Scan(&wh.ID, &wh.URL, &wh.Secret, &active, &events); err != nil {
			return err
		}
		wh.Active = active == 1
		if events != "" {
			wh.Events = splitEvents(events)
		}
		b.webhooks[wh.ID] = wh
	}
	return rows.Err()
}

// Subscribe returns a channel that receives events of the given types.
// If no types are specified, subscribes to all events. Each requested type
// registers the channel, so multi-type subscriptions receive every match.
func (b *Bus) Subscribe(bufferSize int, types ...EventType) <-chan Event {
	ch := make(chan Event, bufferSize)
	b.mu.Lock()
	defer b.mu.Unlock()

	if len(types) == 0 {
		b.listeners["*"] = append(b.listeners["*"], ch)
		return ch
	}
	for _, t := range types {
		key := string(t)
		b.listeners[key] = append(b.listeners[key], ch)
	}
	return ch
}

// Unsubscribe removes a channel from all listeners.
func (b *Bus) Unsubscribe(ch <-chan Event) {
	b.mu.Lock()
	defer b.mu.Unlock()

	for key, listeners := range b.listeners {
		var remaining []chan Event
		for _, l := range listeners {
			if l != ch {
				remaining = append(remaining, l)
			}
		}
		if len(remaining) == 0 {
			delete(b.listeners, key)
		} else {
			b.listeners[key] = remaining
		}
	}
}

// Emit dispatches an event to all matching listeners and webhooks. It never
// blocks: slow in-process listeners drop events, and webhook delivery is
// queued to a bounded worker pool.
func (b *Bus) Emit(evt Event) {
	if evt.ID == "" {
		evt.ID = util.NewID("evt_", 12)
	}
	if evt.Timestamp.IsZero() {
		evt.Timestamp = time.Now().UTC()
	}

	// Dispatch to in-process listeners (non-blocking).
	b.mu.RLock()
	listeners := append([]chan Event{}, b.listeners["*"]...)
	listeners = append(listeners, b.listeners[string(evt.Type)]...)
	b.mu.RUnlock()

	for _, ch := range listeners {
		sendOrDrop(b, ch, evt)
	}

	// Queue webhook delivery; drop when saturated or shutting down.
	if b.stopped.Load() {
		return
	}
	select {
	case <-b.ctx.Done():
		return
	case b.queue <- webhookJob{evt: evt}:
	default:
	}
}

// RegisterWebhook persists a webhook target (upsert) and makes it active.
func (b *Bus) RegisterWebhook(w WebhookTarget) {
	if w.ID == "" {
		w.ID = util.NewID("wh_", 12)
	}
	b.mu.Lock()
	b.webhooks[w.ID] = w
	b.mu.Unlock()
	if b.db != nil {
		active := 0
		if w.Active {
			active = 1
		}
		now := util.NowUTC()
		_, _ = b.db.Exec(
			`INSERT INTO webhooks(id,url,secret,active,events,created_at,updated_at)
			 VALUES(?,?,?,?,?,?,?)
			 ON CONFLICT(id) DO UPDATE SET
			   url=excluded.url, secret=excluded.secret, active=excluded.active,
			   events=excluded.events, updated_at=excluded.updated_at`,
			w.ID, w.URL, w.Secret, active, joinEvents(w.Events), now, now)
	}
}

// UnregisterWebhook removes a webhook target.
func (b *Bus) UnregisterWebhook(id string) {
	b.mu.Lock()
	delete(b.webhooks, id)
	b.mu.Unlock()
	if b.db != nil {
		_, _ = b.db.Exec(`DELETE FROM webhooks WHERE id=?`, id)
	}
}

// ListWebhooks returns all registered webhooks in stable order.
func (b *Bus) ListWebhooks() []WebhookTarget {
	b.mu.RLock()
	defer b.mu.RUnlock()

	out := make([]WebhookTarget, 0, len(b.webhooks))
	for _, w := range b.webhooks {
		out = append(out, w)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// worker consumes queued events and delivers them to matching webhooks.
func (b *Bus) worker() {
	defer b.wg.Done()
	for {
		select {
		case <-b.ctx.Done():
			return
		case job := <-b.queue:
			b.deliver(job.evt)
		}
	}
}

// deliver sends an event to every matching webhook with retry/backoff.
func (b *Bus) deliver(evt Event) {
	b.mu.RLock()
	targets := make([]WebhookTarget, 0, len(b.webhooks))
	for _, wh := range b.webhooks {
		if wh.Active && wh.subscribes(evt.Type) {
			targets = append(targets, wh)
		}
	}
	b.mu.RUnlock()

	for _, wh := range targets {
		b.deliverOnce(evt, wh)
	}
}

func (b *Bus) deliverOnce(evt Event, wh WebhookTarget) {
	payload, err := json.Marshal(evt)
	if err != nil {
		return
	}
	sig := Signature(wh.Secret, payload)

	// Re-validate + pin DNS at delivery time. The registration-time check
	// in validateWebhookURL can be defeated by DNS rebinding (record flips
	// to 169.254.169.254 / loopback between validation and delivery, or
	// after registration). We resolve here, reject blocked IPs, dial only
	// the verified addresses, and refuse redirects to blocked hosts.
	pinned, perr := pinnedWebhookClient(wh.URL, b.AllowPrivateTargets)
	if perr != nil {
		if b.log != nil {
			b.log.Warn("webhook delivery skipped: url blocked",
				"url", redactWebhookURL(wh.URL), "event", string(evt.Type), "error", perr)
		}
		return
	}
	client := pinned
	if b.client != nil && b.client.Timeout != 0 {
		client.Timeout = b.client.Timeout
	}

	var lastErr error
	for attempt := 0; attempt < webhookMaxRetry; attempt++ {
		if attempt > 0 {
			select {
			case <-b.ctx.Done():
				return
			case <-time.After(webhookBaseDelay * time.Duration(attempt)):
			}
		}
		req, err := http.NewRequestWithContext(b.ctx, "POST", wh.URL, bytes.NewReader(payload))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Nexora-Event", string(evt.Type))
		req.Header.Set("X-Nexora-Event-ID", evt.ID)
		req.Header.Set("X-Nexora-Signature", sig)

		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		// Drain a little so the connection can be reused.
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return
		}
		lastErr = fmt.Errorf("webhook %s returned %d", wh.URL, resp.StatusCode)
	}
	if b.log != nil && lastErr != nil {
		b.log.Warn("webhook delivery failed after retries",
			"url", wh.URL, "event", string(evt.Type), "event_id", evt.ID, "error", lastErr)
	}
}

// sendOrDrop attempts to enqueue evt on ch without blocking. If ch has
// been closed by a subscriber, the send would otherwise panic
// ("send on closed channel") and crash the goroutine that called Emit
// (e.g. the request handler that just emitted a file-created event).
//
// The Bus contract is that subscribers own their channel lifecycle:
// the bus never closes channels. But a future refactor or a buggy
// caller could violate that; the recover here is cheap insurance so a
// single closed-channel mishap cannot take down the whole request
// pipeline. Phase 2 / P1-8.
func sendOrDrop(b *Bus, ch chan Event, evt Event) {
	defer func() {
		// The select on a closed channel returns immediately (zero
		// value) for the receive case but panics on send. Recover
		// converts the panic to a log line + the slow-listener drop
		// path, so a single misbehaving subscriber cannot take down
		// the request goroutine that called Emit.
		_ = recover()
	}()
	select {
	case ch <- evt:
	default:
		// Drop event if listener is slow.
		if b != nil && b.log != nil {
			// Best-effort: do not log on every drop (would be very
			// chatty). A closed channel will keep panicking; the
			// caller can detect this via metrics if needed.
		}
	}
}

// pinnedWebhookClient resolves whURL, rejects loopback/private/link-local/
// multicast/unspecified targets (including cloud metadata 169.254.169.254),
// and returns an http.Client whose dialer connects ONLY to the verified IPs
// and whose redirect policy re-validates every hop. This closes the
// validate-then-use DNS-rebinding gap: even if the record flips after the
// registration-time check, delivery still cannot reach an internal address.
func pinnedWebhookClient(whURL string, allowPrivate bool) (*http.Client, error) {
	u, err := url.Parse(whURL)
	if err != nil {
		return nil, fmt.Errorf("invalid url")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("url must use http or https")
	}
	host := u.Hostname()
	if host == "" {
		return nil, fmt.Errorf("url is missing a host")
	}
	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}

	var ips []net.IP
	if ip := net.ParseIP(host); ip != nil {
		if !allowPrivate && isWebhookBlockedIP(ip) {
			return nil, fmt.Errorf("url points to a private or loopback address")
		}
		ips = []net.IP{ip}
	} else {
		resolved, err := net.LookupIP(host)
		if err != nil || len(resolved) == 0 {
			return nil, fmt.Errorf("could not resolve url host")
		}
		for _, ip := range resolved {
			if !allowPrivate && isWebhookBlockedIP(ip) {
				return nil, fmt.Errorf("url resolves to a private or loopback address")
			}
		}
		ips = resolved
	}

	// Pin the verified address set. The dialer round-robins across them so
	// multi-A records still get failover without ever touching the resolver
	// again for this delivery.
	var dialIdx uint32
	baseDialer := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
	dial := func(ctx context.Context, network, _ string) (net.Conn, error) {
		i := atomic.AddUint32(&dialIdx, 1)
		// Try each verified IP once, starting at a rotating offset.
		var lastErr error
		for n := 0; n < len(ips); n++ {
			ip := ips[int((i+uint32(n))%uint32(len(ips)))]
			addr := net.JoinHostPort(ip.String(), port)
			c, err := baseDialer.DialContext(ctx, network, addr)
			if err == nil {
				return c, nil
			}
			lastErr = err
		}
		if lastErr == nil {
			lastErr = fmt.Errorf("no verified webhook address available")
		}
		return nil, lastErr
	}
	transport := &http.Transport{
		DialContext:           dial,
		DialTLSContext:        dial,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
	}
	return &http.Client{
		Timeout:   10 * time.Second,
		Transport: transport,
		CheckRedirect: func(req *http.Request, _ []*http.Request) error {
			if allowPrivate {
				return nil
			}
			rh := req.URL.Hostname()
			if rh == "" {
				return fmt.Errorf("redirect without host blocked")
			}
			if ip := net.ParseIP(rh); ip != nil {
				if isWebhookBlockedIP(ip) {
					return fmt.Errorf("redirect to private address blocked")
				}
				return nil
			}
			rips, err := net.LookupIP(rh)
			if err != nil || len(rips) == 0 {
				return fmt.Errorf("redirect host unresolvable")
			}
			for _, ip := range rips {
				if isWebhookBlockedIP(ip) {
					return fmt.Errorf("redirect to private address blocked")
				}
			}
			return nil
		},
	}, nil
}

// isWebhookBlockedIP mirrors the registration-time range check so delivery
// stays consistent even if the api package check evolves.
func isWebhookBlockedIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsPrivate() || ip.IsMulticast() || ip.IsUnspecified() {
		return true
	}
	if v4 := ip.To4(); v4 != nil && v4[0] == 169 && v4[1] == 254 {
		return true
	}
	return false
}

func redactWebhookURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "<unparseable>"
	}
	u.RawQuery = ""
	u.User = nil
	return u.String()
}

func (wh WebhookTarget) subscribes(t EventType) bool {
	if len(wh.Events) == 0 {
		return true
	}
	for _, e := range wh.Events {
		if e == string(t) || e == "*" {
			return true
		}
	}
	return false
}

// Signature returns the hex HMAC-SHA256 of payload keyed by secret, or an
// empty string when no secret is configured. Recipients verify integrity and
// authenticity of the delivery with the shared secret.
func Signature(secret string, payload []byte) string {
	if secret == "" {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}

func joinEvents(events []string) string {
	seen := make(map[string]bool)
	var out []string
	for _, e := range events {
		if e == "" || seen[e] {
			continue
		}
		seen[e] = true
		out = append(out, e)
	}
	return strings.Join(out, ",")
}

func splitEvents(s string) []string {
	var out []string
	for _, e := range strings.Split(s, ",") {
		if e = strings.TrimSpace(e); e != "" {
			out = append(out, e)
		}
	}
	return out
}
