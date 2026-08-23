package storage

import (
	"context"
	"time"

	"github.com/nexora/nexora/internal/database"
	"github.com/nexora/nexora/internal/logger"
)

// PurgeExpiredTrash permanently removes trashed items older than ttl:
// deletes the physical file inside the root's .nexora-trash, then drops the
// row. Runs in bounded batches so a huge backlog can't stall the maintenance
// loop; call it periodically (it returns 0 immediately when ttl <= 0).
//
// Read-only roots are skipped — purging would violate their contract.
func PurgeExpiredTrash(ctx context.Context, db *database.DB, rs *RootService, ttl time.Duration, log *logger.Logger) int64 {
	if ttl <= 0 || db == nil || rs == nil {
		return 0
	}
	cutoff := time.Now().UTC().Add(-ttl).Format(time.RFC3339)

	rows, err := db.Query(
		`SELECT id, root_id, trash_path FROM trash WHERE deleted_at < ? ORDER BY deleted_at ASC LIMIT 500`,
		cutoff,
	)
	if err != nil {
		log.Warn("trash purge query failed", "err", err.Error())
		return 0
	}
	type item struct{ id, rootID, path string }
	var batch []item
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.id, &it.rootID, &it.path); err == nil {
			batch = append(batch, it)
		}
	}
	_ = rows.Close()

	purged := 0
	for _, it := range batch {
		select {
		case <-ctx.Done():
			return int64(purged)
		default:
		}
		root, ok, err := rs.Get(it.rootID)
		if err != nil || !ok {
			continue // root vanished; leave row for a later pass/manual cleanup
		}
		if root.ReadOnly {
			continue
		}
		prov := rs.ProviderFor(root)
		if prov == nil {
			continue
		}
		delErr := prov.Delete(it.path)
		if delErr == nil {
			_, _ = db.Exec(`DELETE FROM trash WHERE id = ?`, it.id)
			purged++
			continue
		}
		if delErr == ErrNotFound {
			// File already gone — drop the stale row.
			_, _ = db.Exec(`DELETE FROM trash WHERE id = ?`, it.id)
			purged++
		} else if log != nil {
			log.Warn("trash purge delete failed", "path", it.path, "err", delErr.Error())
		}
	}
	if purged > 0 && log != nil {
		log.Info("purged expired trash", "count", purged, "ttl", ttl.String())
	}
	return int64(purged)
}
