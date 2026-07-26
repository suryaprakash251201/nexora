//go:build !postgres
// +build !postgres

// Package database provides a stub for PostgreSQL support when not built
// with the postgres build tag. This allows the main code to compile without
// the lib/pq dependency.
package database

import (
	"database/sql"
	"fmt"
)

// OpenPostgres returns an error when PostgreSQL support is not compiled in.
// To enable PostgreSQL, build with: go build -tags postgres ./cmd/nexora
func OpenPostgres(databaseURL string) (*sql.DB, error) {
	return nil, fmt.Errorf("postgres support not compiled in (recompile with -tags postgres)")
}

// ToPostgres returns the SQL unchanged (stub).
func ToPostgres(sql string) string {
	return sql
}

// DBAdapter wraps *sql.DB for dialect-aware queries (PostgreSQL stub).
type DBAdapter struct {
	DB      *sql.DB
	Dialect string
}

func (a *DBAdapter) Exec(query string, args ...any) (sql.Result, error) {
	return a.DB.Exec(query, args...)
}

func (a *DBAdapter) Query(query string, args ...any) (*sql.Rows, error) {
	return a.DB.Query(query, args...)
}

func (a *DBAdapter) QueryRow(query string, args ...any) *sql.Row {
	return a.DB.QueryRow(query, args...)
}

func Adapt(db *sql.DB, dialect string) *DBAdapter {
	if dialect == "" {
		dialect = "sqlite"
	}
	return &DBAdapter{DB: db, Dialect: dialect}
}
