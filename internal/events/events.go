// Package events provides an in-process event bus for file operations
// and supports webhook callbacks to external services.
package events

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// EventType represents the kind of file event.
type EventType string

const (
	EventFileCreated   EventType = "file.created"
	EventFileUpdated   EventType = "file.updated"
	EventFileDeleted   EventType = "file.deleted"
	EventFileMoved     EventType = "file.moved"
	EventFileCopied    EventType = "file.copied"
	EventFileRenamed   EventType = "file.renamed"
	EventDirCreated    EventType = "directory.created"
	EventShareCreated  EventType = "share.created"
	EventShareRevoked  EventType = "share.revoked"
	EventVersionCreated EventType = "version.created"
	EventVersionRestored EventType = "version.restored"
)

// Event represents a file system event.
type Event struct {
	ID        string    `json:"id"`
	Type      EventType `json:"type"`
	UserID    string    `json:"user_id"`
	RootID    string    `json:"root_id"`
	Path      string    `json:"path"`
	Size      int64     `json:"size,omitempty"`
	Timestamp time.Time `json:"timestamp"`
	Metadata  map[string]string `json:"metadata,omitempty"`
}

// WebhookTarget is a registered webhook endpoint.
type WebhookTarget struct {
	ID     string `json:"id"`
	URL    string `json:"url"`
	Secret string `json:"secret,omitempty"`
	Active bool   `json:"active"`
	Events []string `json:"events"` // event types to subscribe to (empty = all)
}

// Bus is the central event bus that dispatches events to listeners.
type Bus struct {
	mu       sync.RWMutex
	listeners map[string][]chan Event
	webhooks  map[string]WebhookTarget
	db       *sql.DB
	client   *http.Client
}

// NewBus creates a new event bus.
func NewBus(db *sql.DB) *Bus {
	return &Bus{
		listeners: make(map[string][]chan Event),
		webhooks:  make(map[string]WebhookTarget),
		db:        db,
		client:    &http.Client{Timeout: 10 * time.Second},
	}
}

// Subscribe returns a channel that receives events of the given types.
// If no types are specified, subscribes to all events.
func (b *Bus) Subscribe(bufferSize int, types ...EventType) <-chan Event {
	ch := make(chan Event, bufferSize)
	b.mu.Lock()
	defer b.mu.Unlock()

	key := "*"
	if len(types) > 0 {
		key = string(types[0])
	}
	b.listeners[key] = append(b.listeners[key], ch)
	return ch
}

// Unsubscribe removes a channel from listeners.
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

// Emit dispatches an event to all matching listeners and webhooks.
func (b *Bus) Emit(evt Event) {
	if evt.ID == "" {
		evt.ID = fmt.Sprintf("evt_%d", time.Now().UnixNano())
	}
	if evt.Timestamp.IsZero() {
		evt.Timestamp = time.Now().UTC()
	}

	// Dispatch to in-process listeners
	b.mu.RLock()
	listeners := append([]chan Event{}, b.listeners["*"]...)
	listeners = append(listeners, b.listeners[string(evt.Type)]...)
	b.mu.RUnlock()

	for _, ch := range listeners {
		select {
		case ch <- evt:
		default:
			// Drop event if listener is slow
		}
	}

	// Dispatch to webhooks (async)
	go b.dispatchWebhooks(evt)
}

// RegisterWebhook adds a webhook target.
func (b *Bus) RegisterWebhook(w WebhookTarget) {
	b.mu.Lock()
	b.webhooks[w.ID] = w
	b.mu.Unlock()
}

// UnregisterWebhook removes a webhook target.
func (b *Bus) UnregisterWebhook(id string) {
	b.mu.Lock()
	delete(b.webhooks, id)
	b.mu.Unlock()
}

// ListWebhooks returns all registered webhooks.
func (b *Bus) ListWebhooks() []WebhookTarget {
	b.mu.RLock()
	defer b.mu.RUnlock()

	var out []WebhookTarget
	for _, w := range b.webhooks {
		out = append(out, w)
	}
	return out
}

// dispatchWebhooks sends events to matching webhook targets.
func (b *Bus) dispatchWebhooks(evt Event) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	for _, wh := range b.webhooks {
		if !wh.Active {
			continue
		}

		// Check if webhook subscribes to this event type
		if len(wh.Events) > 0 {
			found := false
			for _, e := range wh.Events {
				if e == string(evt.Type) || e == "*" {
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}

		// Send webhook
		go func(target WebhookTarget) {
			payload, err := json.Marshal(evt)
			if err != nil {
				return
			}

			req, err := http.NewRequest("POST", target.URL, bytes.NewReader(payload))
			if err != nil {
				return
			}

			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Nexora-Event", string(evt.Type))
			req.Header.Set("X-Nexora-Event-ID", evt.ID)

			if target.Secret != "" {
				req.Header.Set("X-Nexora-Signature", computeHMAC(target.Secret, payload))
			}

			resp, err := b.client.Do(req)
			if err != nil {
				return
			}
			resp.Body.Close()
		}(wh)
	}
}

func computeHMAC(secret string, payload []byte) string {
	// Simplified HMAC - production would use crypto/hmac
	h := md5Hash(payload)
	return fmt.Sprintf("%x", h)
}

func md5Hash(data []byte) []byte {
	// Simple hash placeholder
	result := make([]byte, 16)
	for i, b := range data {
		result[i%16] ^= b
	}
	return result
}
