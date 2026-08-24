package migrations

import (
	"regexp"
	"strconv"
	"strings"
)

// ToPostgres converts SQLite-flavored SQL to PostgreSQL-compatible syntax. It
// is the single source of truth for dialect conversion and is used both by the
// migration runner (RunPostgres) and, via the database package, by the runtime
// query wrapper. For callers that don't actually target Postgres (the stub
// build), a no-op variant is provided in the database package.
func ToPostgres(sql string) string {
	sql = stripPragmas(sql)
	// datetime('now') / datetime('now','localtime') → NOW()
	sql = strings.ReplaceAll(sql, "datetime('now','localtime')", "NOW()")
	sql = strings.ReplaceAll(sql, "datetime('now')", "NOW()")
	// strftime(...) → TO_CHAR(...) with the format code mapped to Postgres.
	sql = replaceStrftime(sql)
	// INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
	sql = replaceInsertOrIgnore(sql)
	// INSERT OR REPLACE → INSERT ... ON CONFLICT (pk) DO UPDATE
	sql = replaceInsertOrReplace(sql)
	// ? placeholders → $N (PostgreSQL positional style)
	sql = rewritePlaceholders(sql)
	return sql
}

// strftimeRe matches strftime('FMT', expr) so the format code can be mapped to
// the equivalent PostgreSQL TO_CHAR format.
var strftimeRe = regexp.MustCompile(`(?i)strftime\('([^']*)'\s*,\s*([^)]+)\)`)

// pgStrftimeFormat maps SQLite strftime format codes to PostgreSQL TO_CHAR
// format tokens. Any character without a mapping (e.g. a literal "T" or "Z")
// is passed through unchanged, which matches TO_CHAR's "output literally"
// behavior — so 'YYYY-MM-DDTHH24:MI:SS.USZ' reproduces the SQLite layout.
var pgStrftimeFormat = strings.NewReplacer(
	"%Y", "YYYY", "%m", "MM", "%d", "DD", "%H", "HH24", "%M", "MI",
	"%S", "SS", "%f", "US", "%w", "D", "%j", "DDD",
)

func replaceStrftime(q string) string {
	return strftimeRe.ReplaceAllStringFunc(q, func(m string) string {
		sub := strftimeRe.FindStringSubmatch(m)
		if sub == nil {
			return m
		}
		return "TO_CHAR(" + sub[2] + ", '" + pgStrftimeFormat.Replace(sub[1]) + "')"
	})
}

// stripPragmas removes SQLite PRAGMA statements, which are invalid in
// PostgreSQL and only appear in DDL.
func stripPragmas(q string) string {
	re := regexp.MustCompile(`(?i)\bPRAGMA\b[^;]*;?`)
	return re.ReplaceAllString(q, "")
}

// rewritePlaceholders rewrites positional "?" placeholders to PostgreSQL's
// "$N" form while leaving "?" inside single-quoted string literals untouched.
func rewritePlaceholders(q string) string {
	var b strings.Builder
	n := 0
	inStr := false
	for i := 0; i < len(q); i++ {
		c := q[i]
		if inStr {
			b.WriteByte(c)
			if c == '\'' {
				if i+1 < len(q) && q[i+1] == '\'' {
					b.WriteByte('\'')
					i++
				} else {
					inStr = false
				}
			}
			continue
		}
		switch c {
		case '\'':
			inStr = true
			b.WriteByte(c)
		case '?':
			n++
			b.WriteByte('$')
			b.WriteString(strconv.Itoa(n))
		default:
			b.WriteByte(c)
		}
	}
	return b.String()
}

// insertConflictTargets maps tables that use INSERT OR REPLACE to their primary
// key column list, used to build the equivalent ON CONFLICT clause.
var insertConflictTargets = map[string]string{
	"search_index":           "id",
	"playlist_collaborators": "playlist_id, user_id",
}

var insertOrIgnoreRe = regexp.MustCompile(`(?is)^INSERT\s+OR\s+IGNORE\s+INTO\s+(\w+)\s*(\([^)]*\))?\s*VALUES(.*)$`)

// replaceInsertOrIgnore converts "INSERT OR IGNORE INTO t (...) VALUES (...)"
// into "INSERT INTO t (...) VALUES (...) ON CONFLICT DO NOTHING", which is the
// exact Postgres equivalent (skip conflicting rows instead of erroring).
// Unlike INSERT OR REPLACE this never needs a conflict-target column list, so
// any table is supported. Conversion is applied per statement so migration
// files containing several statements are handled correctly.
func replaceInsertOrIgnore(q string) string {
	statements := splitStatements(q)
	changed := false
	for i, stmt := range statements {
		sub := insertOrIgnoreRe.FindStringSubmatch(strings.TrimSpace(stmt))
		if sub == nil {
			continue
		}
		cols := strings.TrimSpace(sub[2])
		out := "INSERT INTO " + sub[1]
		if cols != "" {
			out += " " + cols
		}
		statements[i] = out + " VALUES" + sub[3] + " ON CONFLICT DO NOTHING"
		changed = true
	}
	if !changed {
		return q
	}
	return strings.Join(statements, ";\n")
}

// splitStatements splits SQL into statements on top-level semicolons,
// ignoring semicolons inside single-quoted string literals.
func splitStatements(q string) []string {
	var out []string
	var b strings.Builder
	inStr := false
	for i := 0; i < len(q); i++ {
		c := q[i]
		if inStr {
			b.WriteByte(c)
			if c == '\'' {
				if i+1 < len(q) && q[i+1] == '\'' {
					b.WriteByte('\'')
					i++
				} else {
					inStr = false
				}
			}
			continue
		}
		switch c {
		case '\'':
			inStr = true
			b.WriteByte(c)
		case ';':
			out = append(out, b.String())
			b.Reset()
		default:
			b.WriteByte(c)
		}
	}
	out = append(out, b.String())
	return out
}

var insertOrReplaceRe = regexp.MustCompile(`(?is)INSERT OR REPLACE INTO (\w+)\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)`)

// replaceInsertOrReplace converts "INSERT OR REPLACE INTO t (cols) VALUES (...)"
// into "INSERT INTO t (cols) VALUES (...) ON CONFLICT (pk) DO UPDATE SET ...".
// Unknown tables fall back to a plain INSERT so the failure is explicit rather
// than silent.
func replaceInsertOrReplace(q string) string {
	return insertOrReplaceRe.ReplaceAllStringFunc(q, func(m string) string {
		sub := insertOrReplaceRe.FindStringSubmatch(m)
		if sub == nil {
			return m
		}
		tbl := strings.ToLower(sub[1])
		cols := splitCols(sub[2])
		target, ok := insertConflictTargets[tbl]
		if !ok {
			return "INSERT INTO " + sub[1] + " (" + sub[2] + ") VALUES (" + sub[3] + ")"
		}
		pkSet := map[string]bool{}
		for _, c := range splitCols(target) {
			pkSet[strings.ToLower(strings.TrimSpace(c))] = true
		}
		var updates []string
		for _, c := range cols {
			cc := strings.TrimSpace(c)
			if cc == "" || pkSet[strings.ToLower(cc)] {
				continue
			}
			updates = append(updates, cc+" = EXCLUDED."+cc)
		}
		return "INSERT INTO " + sub[1] + " (" + sub[2] + ") VALUES (" + sub[3] + ") ON CONFLICT (" + target + ") DO UPDATE SET " + strings.Join(updates, ", ")
	})
}

func splitCols(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		out = append(out, strings.TrimSpace(p))
	}
	return out
}
