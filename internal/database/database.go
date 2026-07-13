// Package database wires up the SQLite connection, enables WAL mode, and runs
// embedded migrations. PostgreSQL is supported through a build-time swap of the
// driver, but SQLite is the default for a zero-dependency deployment.
package database

import (
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"

	"github.com/nexora/nexora/migrations"
)

// Open opens the SQLite database at dbPath, applies tuning pragmas and runs
// migrations. The caller is responsible for calling Close.
func Open(dbPath string) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)&_pragma=cache_size(-16000)", dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	db.SetMaxOpenConns(1) // SQLite single-writer; safe for our workload.
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
	return db, nil
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
