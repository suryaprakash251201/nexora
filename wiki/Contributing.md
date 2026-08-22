# Contributing

Thanks for considering a contribution — bug reports, docs, and small focused PRs are all welcome.

## Ground Rules

- Be kind and concise in issues/PRs.
- Keep PRs small and scoped — one concern per PR.
- Add tests when fixing a bug or adding a backend behavior.
- Don't commit build artifacts (`nexora`/`nexora_test` binaries, `web/dist/`, `data/`, `node_modules/` — all gitignored).
- Migrations are forward-only — never edit an already-applied `.sql` file (see [Development](Development) + [AGENTS.md](../AGENTS.md)).
- Use `packages/core` (`@nexora/core`) for shared helpers.

## Workflow

1. **Fork & branch** from `main`.
2. **Code** — follow existing style; check `internal/api/server.go` for endpoint conventions and `web/src/index.css` for design tokens.
3. **Verify locally:**

   ```bash
   make lint                       # go mod tidy + go vet (+ golangci-lint if installed)
   make lint-full                  # also web + packages/core typechecks
   go test ./... -count=1
   cd web && npm run lint && npm run build
   go build -tags postgres -o /tmp/nexora-pg ./cmd/nexora   # when touching DB
   cd mobile && npx patch-package --error-on-fail          # when touching mobile deps
   ```

   CI runs exactly that (see `.github/workflows/ci.yml`). Mirror it before pushing.

4. **Commit** with a clear message (`feat: …`, `fix: …`, `docs: …`).
5. **Open a PR** against `main` — describe the change, link issues, note breaking changes or migrations.

## What to Work On

- The [code-review](../docs/code-review-2026-08.md) backlog (security + reliability priorities — marked with severity).
- UX polish in `web/` (ImageView pan, photos race, list virtualization — `web/src` TODOs).
- Docs and examples — especially self-host recipes and S3/MinIO examples.
- Mobile parity and patch maintenance (see `mobile/AGENTS.md`).

### Don't Yet Extend

- `internal/webdav` is **unwired dead code** (not mounted) — don't extend until the feature is re-decided (see [AGENTS.md](../AGENTS.md)).
- Postgres dialect converters should stay in `migrations/rewrite.go` + `internal/database.DB` — keep queries `?`-style.

## Reporting Issues

- **Bugs:** include `VERSION`, endpoint (`curl -f /healthz` output), `docker compose logs` excerpt, and minimal repro.
- **Feature requests:** describe the use case, not just the solution.
- **Security:** do **not** use public issues — see [SECURITY.md](../SECURITY.md) (GitHub Security Advisory, 48 h ack, coordinated disclosure).

## Versioning & Releases

- **Single source:** root `VERSION` (`1.8.0`) → `web/package.json`, `desktop/package.json`, `tauri.conf.json`, `Cargo.toml`, Docker `VERSION` arg. `mobile` is independent (`1.0.0`).
- **SemVer** per [Keep a Changelog](https://keepachangelog.com/). Update `CHANGELOG.md` for user-facing changes.
- **Docker:** `Dockerfile` builds `nexora:nexora` (runs as `100:101`, read-only rootfs). `web` stage uses `npm ci` for reproducibility.

## Code of Conduct

Be respectful. Harassment or spam will be moderated. The maintainer may close off-topic or low-effort reports.

## License

By contributing you agree your changes are under the [MIT License](../LICENSE).

---

*Need guidance? Open a draft PR with `WIP:` — early feedback is cheaper than a big reveal.*
