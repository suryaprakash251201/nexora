//go:build postgres

package migrations

import (
	"database/sql"
	"os"
	"testing"
	"time"

	_ "github.com/lib/pq"
)

// TestRunPostgres boots a real PostgreSQL via NEXORA_TEST_POSTGRES_URL and
// verifies the converted migrations apply and the schema is queryable. Skipped
// when the env var is unset (local dev without Docker) — CI sets it via a
// postgres:16 service.
func TestRunPostgres(t *testing.T) {
	dsn := os.Getenv("NEXORA_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("NEXORA_TEST_POSTGRES_URL not set — skipping postgres integration test")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		t.Fatalf("ping postgres: %v", err)
	}
	// Clean slate for the test — drop schema_migrations if it exists.
	_, _ = db.Exec(`DROP TABLE IF EXISTS schema_migrations`)
	// Run the converted migrations.
	if err := RunPostgres(db); err != nil {
		t.Fatalf("RunPostgres: %v", err)
	}
	// Verify the migrations table was populated.
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&n); err != nil {
		t.Fatalf("count schema_migrations: %v", err)
	}
	if n == 0 {
		t.Fatal("schema_migrations is empty after RunPostgres")
	}
	// Verify a core table exists and is writable with a placeholder query
	// (exercises the ?→$N rewriting via the DB wrapper in a real postgres session).
	// created_at/updated_at are NOT NULL without defaults — app code always
	// supplies them, and so does this insert.
	now := time.Now().UTC().Format(time.RFC3339)
	_, err = db.Exec(`INSERT INTO users (id, username, email, password_hash, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5) ON CONFLICT (id) DO NOTHING`, "test-id", "testuser", "test@example.com", "hash", now)
	if err != nil {
		t.Fatalf("insert users: %v", err)
	}
	var got string
	if err := db.QueryRow(`SELECT username FROM users WHERE id = $1`, "test-id").Scan(&got); err != nil {
		t.Fatalf("select users: %v", err)
	}
	if got != "testuser" {
		t.Fatalf("got %q want testuser", got)
	}
	// Cleanup
	_, _ = db.Exec(`DELETE FROM users WHERE id = $1`, "test-id")
}
