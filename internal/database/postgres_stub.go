//go:build !postgres
// +build !postgres

// Package database provides a stub for PostgreSQL support when not built
// with the postgres build tag. This allows the main code to compile without
// the lib/pq dependency.
package database

import (
	"fmt"
)

// OpenPostgres returns an error when PostgreSQL support is not compiled in.
// To enable PostgreSQL, build with: go build -tags postgres ./cmd/nexora
func OpenPostgres(databaseURL string) (*DB, error) {
	return nil, fmt.Errorf("postgres support not compiled in (recompile with -tags postgres)")
}

// ToPostgres returns the SQL unchanged: in the non-postgres build the dialect
// wrapper is a no-op, so no conversion is required.
func ToPostgres(sql string) string {
	return sql
}
