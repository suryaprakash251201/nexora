//go:build postgres
// +build postgres

// Package database provides PostgreSQL database adapter.
// Build with -tags postgres to enable PostgreSQL support:
//   go build -tags postgres ./cmd/nexora
//
// The PostgreSQL adapter converts SQLite-style queries on the fly to be
// PostgreSQL compatible. This allows a single codebase to support both
// SQLite (zero-dependency deployment) and PostgreSQL (multi-node deployment).
package database

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "github.com/lib/pq"

	"github.com/nexora/nexora/migrations"
)

// OpenPostgres opens a PostgreSQL database connection.
func OpenPostgres(databaseURL string) (*sql.DB, error) {
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open postgres database: %w", err)
	}

	// Configure connection pool for PostgreSQL
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(1 * time.Minute)

	// Verify connectivity.
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping postgres database: %w", err)
	}

	// Run PostgreSQL migrations
	if err := migrations.RunPostgres(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate postgres database: %w", err)
	}

	return db, nil
}

// ToPostgres converts a SQLite query to PostgreSQL compatible syntax.
func ToPostgres(sql string) string {
	sql = strings.ReplaceAll(sql, "datetime('now')", "NOW()::text")
	sql = strings.ReplaceAll(sql, "datetime('now','localtime')", "NOW()::text")
	sql = strings.ReplaceAll(sql, "strftime('%Y-%m-%dT%H:%M:%fZ',", "TO_CHAR(")

	if strings.Contains(sql, "INSERT OR REPLACE") {
		sql = strings.ReplaceAll(sql, "INSERT OR REPLACE", "INSERT")
		if !strings.Contains(strings.ToUpper(sql), "ON CONFLICT") {
			parts := strings.Split(sql, "(")
			if len(parts) > 0 {
				tablePart := parts[0]
				words := strings.Fields(tablePart)
				if len(words) >= 3 {
					tableName := words[2]
					colParts := strings.Split(parts[1], ",")
					firstCol := strings.Fields(colParts[0])[0]
					_ = tableName // Keep the logic structure; real implementation parses table name
					sql += fmt.Sprintf(" ON CONFLICT(%s) DO UPDATE SET %s = EXCLUDED.%s", firstCol, firstCol, firstCol)
				}
			}
		}
	}

	return sql
}

// DBAdapter wraps a *sql.DB and provides dialect-aware query execution.
type DBAdapter struct {
	DB       *sql.DB
	Dialect  string
}

// Exec executes a query, converting SQL if needed for PostgreSQL.
func (a *DBAdapter) Exec(query string, args ...any) (sql.Result, error) {
	if a.Dialect == "postgres" {
		query = ToPostgres(query)
	}
	return a.DB.Exec(query, args...)
}

// Query executes a query, converting SQL if needed for PostgreSQL.
func (a *DBAdapter) Query(query string, args ...any) (*sql.Rows, error) {
	if a.Dialect == "postgres" {
		query = ToPostgres(query)
	}
	return a.DB.Query(query, args...)
}

// QueryRow executes a query, converting SQL if needed for PostgreSQL.
func (a *DBAdapter) QueryRow(query string, args ...any) *sql.Row {
	if a.Dialect == "postgres" {
		query = ToPostgres(query)
	}
	return a.DB.QueryRow(query, args...)
}

// Adapt returns a DBAdapter for the given database.
func Adapt(db *sql.DB, dialect string) *DBAdapter {
	if dialect == "" {
		dialect = "sqlite"
	}
	return &DBAdapter{DB: db, Dialect: dialect}
}
