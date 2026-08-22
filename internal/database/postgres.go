//go:build postgres
// +build postgres

// Package database provides PostgreSQL database adapter.
// Build with -tags postgres to enable PostgreSQL support:
//   go build -tags postgres ./cmd/nexora
//
// The PostgreSQL adapter converts SQLite-style queries on the fly to be
// PostgreSQL compatible. This allows a single codebase to support both
// SQLite (zero-dependency deployment) and PostgreSQL (multi-node deployment).
// The actual conversion logic lives in the migrations package (ToPostgres) and
// is applied transparently by the dialect-aware *DB wrapper returned from Open.
package database

import (
	"database/sql"
	"fmt"
	"time"

	_ "github.com/lib/pq"

	"github.com/nexora/nexora/migrations"
)

// OpenPostgres opens a PostgreSQL database connection.
func OpenPostgres(databaseURL string) (*DB, error) {
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open postgres database: %w", err)
	}

	// Configure connection pool for PostgreSQL
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxIdleTime(1 * time.Minute)
	db.SetConnMaxLifetime(5 * time.Minute)

	// Verify connectivity.
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping postgres database: %w", err)
	}

	// Run PostgreSQL migrations (converts SQLite DDL on the fly).
	if err := migrations.RunPostgres(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate postgres database: %w", err)
	}

	// Fail fast if the database is not writable (see probeWritable).
	if err := probeWritable(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("postgres database is not writable: %w", err)
	}

	return Wrap(db, "postgres"), nil
}

// ToPostgres converts SQLite-flavored SQL to PostgreSQL-compatible syntax.
// In the postgres build it delegates to the shared converter; the non-postgres
// stub build returns the SQL unchanged.
func ToPostgres(sql string) string {
	return migrations.ToPostgres(sql)
}
