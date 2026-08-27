package versions

import (
	"context"

	"github.com/nexora/nexora/internal/database"
	"github.com/nexora/nexora/internal/logger"
	"github.com/nexora/nexora/internal/storage"
)

// PurgeAllWithService walks every root and enforces the global
// retention policy. It is a no-op when neither MaxTotalAge nor
// MaxTotalBytes is set.
//
// Each root is purged independently because versions live inside the
// root's own provider. The total deleted count and bytes freed are
// aggregated across roots and returned for logging.
func PurgeAllWithService(ctx context.Context, db *database.DB, rs *storage.RootService, cfg Config, log *logger.Logger) (int, int64, error) {
	if db == nil || rs == nil {
		return 0, 0, nil
	}
	if cfg.MaxTotalAge <= 0 && cfg.MaxTotalBytes <= 0 {
		return 0, 0, nil
	}
	store := &Store{DB: db, Config: cfg}
	roots, err := rs.List()
	if err != nil {
		return 0, 0, err
	}
	var totalDeleted int
	var totalFreed int64
	for _, r := range roots {
		select {
		case <-ctx.Done():
			return totalDeleted, totalFreed, ctx.Err()
		default:
		}
		if r.ReadOnly {
			continue
		}
		prov := rs.ProviderFor(r)
		if prov == nil {
			continue
		}
		d, f, err := store.Purge(prov)
		totalDeleted += d
		totalFreed += f
		if err != nil && log != nil {
			log.Warn("version purge failed", "root_id", r.ID, "err", err.Error())
		}
	}
	if totalDeleted > 0 && log != nil {
		log.Info("purged expired versions",
			"count", totalDeleted,
			"bytes", totalFreed,
			"age_cap", cfg.MaxTotalAge.String(),
			"size_cap_bytes", cfg.MaxTotalBytes,
		)
	}
	return totalDeleted, totalFreed, nil
}
