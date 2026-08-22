// Package database wires up the SQLite or PostgreSQL connection, and runs
// embedded migrations. PostgreSQL is enabled via NEXORA_DATABASE_TYPE=postgres.
package database

import (
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"

	"github.com/nexora/nexora/internal/util"
	"github.com/nexora/nexora/migrations"
)

// Open opens the database based on type. Supported: "sqlite" (default), "postgres".
func Open(dbType, dbPath, dbURL string) (*DB, error) {
	switch dbType {
	case "postgres":
		if dbURL == "" {
			return nil, fmt.Errorf("NEXORA_DATABASE_URL is required for postgres")
		}
		return OpenPostgres(dbURL)
	case "sqlite":
		return openSQLite(dbPath)
	default:
		return nil, fmt.Errorf("unsupported database type: %s (use 'sqlite' or 'postgres')", dbType)
	}
}

// openSQLite opens a SQLite database with performance tuning.
func openSQLite(dbPath string) (*DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)&_pragma=cache_size(-16000)", dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	// WAL allows concurrent readers alongside a single writer. A small pool
	// lets API requests (uploads, auth, listings) proceed while background
	// scanners write; writers serialize politely via the 30s busy_timeout
	// instead of every query queueing behind ONE shared connection.
	db.SetMaxOpenConns(8)
	db.SetConnMaxLifetime(0)

	// Verify connectivity.
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	if err := migrations.Run(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate database: %w", err)
	}

	// Fail fast if the DB file is not writable. A read-only file (e.g. wrong
	// ownership after a volume restore) would otherwise let the server start
	// and serve reads while silently failing every write — surfacing later as
	// confusing runtime errors like "could not record trash entry".
	if err := probeWritable(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("database file is not writable (check ownership/permissions on %s): %w", dbPath, err)
	}
	return Wrap(db, "sqlite"), nil
}

// probeWritable performs a tiny self-rolled write against the
// schema_migrations table to confirm the database file is actually writable.
// Uses $N placeholders which both SQLite and PostgreSQL accept.
func probeWritable(db *sql.DB) error {
	probe := "write-probe-" + util.RandToken(6)
	if _, err := db.Exec(`INSERT INTO schema_migrations(version, applied_at) VALUES($1, $2)`, probe, util.NowUTC()); err != nil {
		return err
	}
	_, err := db.Exec(`DELETE FROM schema_migrations WHERE version=$1`, probe)
	return err
}

// CurrentSchemaVersion returns the number of applied migrations.
func CurrentSchemaVersion(db *sql.DB) (int, error) {
	var n int
	row := db.QueryRow(`SELECT COUNT(*) FROM schema_migrations`)
	if err := row.Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
}

// now is a tiny convenience kept for callers that want a timestamp near DB ops.
func now() string { return time.Now().UTC().Format(time.RFC3339) }
