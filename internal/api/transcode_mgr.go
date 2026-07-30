package api

import (
	"context"
	"os/exec"
	"sync"
	"time"
)

// transcodeSession tracks a running ffmpeg process for seeking.
// When the client seeks, the old process is killed and a new one
// starts from the requested offset.
type transcodeSession struct {
	cancel    context.CancelFunc
	cmd       *exec.Cmd
	createdAt time.Time
	rootID    string
	relPath   string
}

// transcodeManager holds all active transcode sessions keyed by
// a client-generated session ID (UUID). This ensures only one ffmpeg
// process runs per session — when the client seeks, the old process
// is killed before the new one starts.
type transcodeManager struct {
	mu       sync.Mutex
	sessions map[string]*transcodeSession
}

var tcm = &transcodeManager{
	sessions: make(map[string]*transcodeSession),
}

// killSession cancels and removes any existing session for the given ID.
// Called before creating a new ffmpeg process so the old one is terminated
// explicitly, preventing overlapping transcodes for the same session.
func (m *transcodeManager) killSession(sessionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if existing, ok := m.sessions[sessionID]; ok {
		existing.cancel()
		delete(m.sessions, sessionID)
	}
}

// startSession registers a new session (after killSession was called).
func (m *transcodeManager) startSession(sessionID, rootID, relPath string, cancel context.CancelFunc, cmd *exec.Cmd) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[sessionID] = &transcodeSession{
		cancel:    cancel,
		cmd:       cmd,
		createdAt: time.Now(),
		rootID:    rootID,
		relPath:   relPath,
	}
}

// stopSession removes and cancels a session (cleanup after ffmpeg exits).
func (m *transcodeManager) stopSession(sessionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if existing, ok := m.sessions[sessionID]; ok {
		existing.cancel()
		delete(m.sessions, sessionID)
	}
}

// cleanupStale removes sessions older than the given duration.
// Called periodically to prevent memory leaks if a client disconnects
// without properly closing the session.
func (m *transcodeManager) cleanupStale(maxAge time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	for id, sess := range m.sessions {
		if now.Sub(sess.createdAt) > maxAge {
			sess.cancel()
			delete(m.sessions, id)
		}
	}
}

// countActive returns the number of running transcode sessions.
func (m *transcodeManager) countActive() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.sessions)
}

var cleanupOnce sync.Once

// startCleanup launches a background goroutine that periodically evicts
// stale sessions (no activity for 30 minutes). This prevents memory leaks
// if a client disconnects without cleanly stopping the session.
func (m *transcodeManager) startCleanup() {
	cleanupOnce.Do(func() {
		go func() {
			ticker := time.NewTicker(5 * time.Minute)
			defer ticker.Stop()
			for range ticker.C {
				m.cleanupStale(30 * time.Minute)
			}
		}()
	})
}
