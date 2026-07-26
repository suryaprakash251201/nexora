// Package database wires up the SQLite or PostgreSQL connection, and runs
// embedded migrations. PostgreSQL is enabled via NEXORA_DATABASE_TYPE=postgres.
package database

import (
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"

	"github.com/nexora/nexora/migrations"
)

// Open opens the database based on type. Supported: "sqlite" (default), "postgres".
func Open(dbType, dbPath, dbURL string) (*sql.DB, error) {
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
func openSQLite(dbPath string) (*sql.DB, error) {
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
