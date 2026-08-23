// Package backup runs scheduled SQLite backups of the Nexora database.
//
// Backups use SQLite's VACUUM INTO, which produces a compact, consistent
// snapshot while the database stays online (WAL readers are unaffected).
// Old snapshots are pruned to NEXORA_BACKUP_KEEP files. PostgreSQL mode is
// not handled here — use pg_dump externally; the job logs once and exits.
package backup

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/nexora/nexora/internal/database"
	"github.com/nexora/nexora/internal/logger"
)

const filePrefix = "nexora-backup-"
const fileSuffix = ".db"

// BackupFileName returns the timestamped name for a snapshot taken at t.
func BackupFileName(t time.Time) string {
	return filePrefix + t.Format("20060102-150405") + fileSuffix
}

// Prune deletes the oldest backups beyond keep, newest kept first.
// Returns the number of removed files.
func Prune(dir string, keep int) (int, error) {
	if keep <= 0 {
		keep = 1
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, err
	}
	var backups []string
	for _, e := range entries {
		name := e.Name()
		if !e.IsDir() && strings.HasPrefix(name, filePrefix) && strings.HasSuffix(name, fileSuffix) {
			backups = append(backups, name)
		}
	}
	// Newest first: names sort lexicographically by timestamp.
	sort.Sort(sort.Reverse(sort.StringSlice(backups)))
	if len(backups) <= keep {
		return 0, nil
	}
	removed := 0
	for _, name := range backups[keep:] {
		if err := os.Remove(filepath.Join(dir, name)); err == nil {
			removed++
		}
	}
	return removed, nil
}

// RunOnce writes a single consistent snapshot into dir and prunes old ones.
func RunOnce(db *database.DB, dir string, keep int, log *logger.Logger) error {
	if db.Dialect() != "sqlite" {
		log.Info("backup job skipped: use pg_dump for postgres deployments")
		return nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create backup dir: %w", err)
	}
	dest := filepath.Join(dir, BackupFileName(time.Now()))
	if _, err := db.Exec("VACUUM INTO ?", dest); err != nil {
		return fmt.Errorf("vacuum into %s: %w", dest, err)
	}
	if n, err := Prune(dir, keep); err != nil {
		log.Warn("backup prune failed", "err", err.Error())
	} else if n > 0 {
		log.Debug("pruned old backups", "count", n)
	}
	log.Info("database backup written", "path", dest)
	return nil
}

// Start launches the daily backup loop: one snapshot per day at hour:00 local
// time. It blocks until ctx is cancelled; call it in its own goroutine.
func Start(ctx context.Context, db *database.DB, dir string, keep, hour int, log *logger.Logger) {
	if dir == "" {
		return // disabled
	}
	if hour < 0 || hour > 23 {
		hour = 3
	}
	for {
		now := time.Now()
		next := time.Date(now.Year(), now.Month(), now.Day(), hour, 0, 0, 0, now.Location())
		if !next.After(now) {
			next = next.Add(24 * time.Hour)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Until(next)):
			if err := RunOnce(db, dir, keep, log); err != nil {
				log.Warn("scheduled backup failed", "err", err.Error())
			}
		}
	}
}
