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
//
// The *sql.DB is held by value (not embedded) on purpose: an embedded
// *sql.DB would promote QueryContext/ExecContext/QueryRowContext with no
// rewrite, and a single call site that reaches through the embedded methods
// would silently break under -tags postgres (the driver returns
// "syntax error at or near ?"). All DB access must go through the methods
// defined here.
type DB struct {
	db      *sql.DB
	dialect string
}

// Wrap wraps a raw *sql.DB with dialect-aware query rewriting. dialect is
// "sqlite" (default) or "postgres".
func Wrap(db *sql.DB, dialect string) *DB {
	if dialect == "" {
		dialect = "sqlite"
	}
	return &DB{db: db, dialect: dialect}
}

// Raw returns the underlying *sql.DB. It is intentionally narrow and exists
// for the small set of call sites that need driver-specific features (e.g.
// pinging, pool stats, registering drivers) that are dialect-neutral. Prefer
// the typed methods on *DB for any actual query.
func (d *DB) Raw() *sql.DB { return d.db }

// Dialect reports the active SQL dialect.
func (d *DB) Dialect() string { return d.dialect }

// Stats mirrors *sql.DB.Stats via the underlying handle.
func (d *DB) Stats() sql.DBStats { return d.db.Stats() }

// Close delegates to the underlying handle.
func (d *DB) Close() error { return d.db.Close() }

func (d *DB) Exec(query string, args ...any) (sql.Result, error) {
	return d.db.Exec(ToPostgres(query), args...)
}

func (d *DB) Query(query string, args ...any) (*sql.Rows, error) {
	return d.db.Query(ToPostgres(query), args...)
}

func (d *DB) QueryRow(query string, args ...any) *sql.Row {
	return d.db.QueryRow(ToPostgres(query), args...)
}

func (d *DB) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return d.db.ExecContext(ctx, ToPostgres(query), args...)
}

func (d *DB) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return d.db.QueryContext(ctx, ToPostgres(query), args...)
}

func (d *DB) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return d.db.QueryRowContext(ctx, ToPostgres(query), args...)
}

// Begin starts a transaction that also rewrites queries for PostgreSQL.
func (d *DB) Begin() (*Tx, error) {
	tx, err := d.db.Begin()
	if err != nil {
		return nil, err
	}
	return &Tx{Tx: tx, dialect: d.dialect}, nil
}

// BeginTx starts a transaction with options that also rewrites queries.
func (d *DB) BeginTx(ctx context.Context, opts *sql.TxOptions) (*Tx, error) {
	tx, err := d.db.BeginTx(ctx, opts)
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

func (t *Tx) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return t.Tx.ExecContext(ctx, ToPostgres(query), args...)
}

func (t *Tx) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return t.Tx.QueryContext(ctx, ToPostgres(query), args...)
}

func (t *Tx) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return t.Tx.QueryRowContext(ctx, ToPostgres(query), args...)
}
