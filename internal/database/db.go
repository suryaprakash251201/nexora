package database

import (
	"context"
	"database/sql"
)

// DB is a *sql.DB augmented with dialect-aware SQL rewriting so the same
// SQLite-style queries (? placeholders, datetime('now'), strftime) run
// unchanged on PostgreSQL. Open returns a *DB and it is threaded through the
// whole app (Server.DB, every store), so handlers never need to know which
// engine is active. On the non-postgres build ToPostgres is a no-op, so there
// is zero overhead for the default SQLite deployment.
type DB struct {
	*sql.DB
	dialect string
}

// Wrap wraps a raw *sql.DB with dialect-aware query rewriting. dialect is
// "sqlite" (default) or "postgres".
func Wrap(db *sql.DB, dialect string) *DB {
	if dialect == "" {
		dialect = "sqlite"
	}
	return &DB{DB: db, dialect: dialect}
}

// Dialect reports the active SQL dialect.
func (d *DB) Dialect() string { return d.dialect }

func (d *DB) Exec(query string, args ...any) (sql.Result, error) {
	return d.DB.Exec(ToPostgres(query), args...)
}

func (d *DB) Query(query string, args ...any) (*sql.Rows, error) {
	return d.DB.Query(ToPostgres(query), args...)
}

func (d *DB) QueryRow(query string, args ...any) *sql.Row {
	return d.DB.QueryRow(ToPostgres(query), args...)
}

// Begin starts a transaction that also rewrites queries for PostgreSQL.
func (d *DB) Begin() (*Tx, error) {
	tx, err := d.DB.Begin()
	if err != nil {
		return nil, err
	}
	return &Tx{Tx: tx, dialect: d.dialect}, nil
}

// BeginTx starts a transaction with options that also rewrites queries.
func (d *DB) BeginTx(ctx context.Context, opts *sql.TxOptions) (*Tx, error) {
	tx, err := d.DB.BeginTx(ctx, opts)
	if err != nil {
		return nil, err
	}
	return &Tx{Tx: tx, dialect: d.dialect}, nil
}

// Tx is a *sql.Tx that rewrites queries for PostgreSQL, mirroring DB.
type Tx struct {
	*sql.Tx
	dialect string
}

// Dialect reports the active SQL dialect.
func (t *Tx) Dialect() string { return t.dialect }

func (t *Tx) Exec(query string, args ...any) (sql.Result, error) {
	return t.Tx.Exec(ToPostgres(query), args...)
}

func (t *Tx) Query(query string, args ...any) (*sql.Rows, error) {
	return t.Tx.Query(ToPostgres(query), args...)
}

func (t *Tx) QueryRow(query string, args ...any) *sql.Row {
	return t.Tx.QueryRow(ToPostgres(query), args...)
}
