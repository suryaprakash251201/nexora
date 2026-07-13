// Package migrations provides an embedded, ordered SQL migration runner.
package migrations

import (
	"database/sql"
	"embed"
	"fmt"
	"sort"
	"strings"

	"github.com/nexora/nexora/internal/util"
)

//go:embed *.sql
var fs embed.FS

// Migration is a single ordered SQL file.
type Migration struct {
	Name string
	SQL  string
}

// All returns all embedded migrations sorted by filename.
func All() ([]Migration, error) {
	entries, err := fs.ReadDir(".")
	if err != nil {
		return nil, err
	}
	var out []Migration
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		b, err := fs.ReadFile(e.Name())
		if err != nil {
			return nil, err
		}
		out = append(out, Migration{Name: e.Name(), SQL: string(b)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// Run applies all migrations inside a transaction, tracking applied state in
// the schema_migrations table so it is safe to call on every startup.
func Run(db *sql.DB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY,
		applied_at TEXT NOT NULL
	)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	applied := map[string]bool{}
	rows, err := db.Query(`SELECT version FROM schema_migrations`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			rows.Close()
			return err
		}
		applied[v] = true
	}
	rows.Close()

	all, err := All()
	if err != nil {
		return err
	}

	for _, m := range all {
		if applied[m.Name] {
			continue
		}
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(m.SQL); err != nil {
			tx.Rollback()
			return fmt.Errorf("apply %s: %w", m.Name, err)
		}
		if _, err := tx.Exec(`INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)`,
			m.Name, util.NowUTC()); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}
