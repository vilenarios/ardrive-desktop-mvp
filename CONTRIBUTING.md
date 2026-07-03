# Contributing Standards

These are the working standards for ArDrive Desktop — for humans and agents alike. The full development loop (roles, verification gates, safety rails) is defined in [docs/product/PROCESS.md](docs/product/PROCESS.md); this file is the quick contract.

## Branches

- `main` — always green (typecheck, lint, `vitest --run`, build). Never commit work-in-progress directly.
- `fix/<ITEM-ID>-slug` — one branch per backlog item (e.g. `fix/SYNC-1-reupload-edits`). Branch from current main.
- `wip/*` — parked/incomplete work. Never merged without going through the backlog + QA gate.

## Commits

- Conventional commits with the backlog item ID: `fix(sync): re-upload edited files [SYNC-1]`.
- Types: `feat`, `fix`, `chore`, `docs`, `build`, `test`, `refactor`.
- Update the backlog item's status **in the same branch** as the fix (see [BACKLOG.md](docs/product/BACKLOG.md)).
- Never commit secrets, key material, wallet files, or real profile data. `package-lock.json` IS committed (required for CI).

## Merging (decision D-009)

- A branch merges to main only after a **QA-gate PASS** verdict (see PROCESS.md) — full gates: typecheck, lint, complete test suite, build, plus the item's acceptance criteria.
- The PM (coordinator session) may merge QA-passed item branches and push.
- **Releases, tags, and version bumps remain Phil's** (`release:*` scripts, workflow `release` dispatches).

## Quality gates (every PR — matches .github/PULL_REQUEST_TEMPLATE.md)

1. `npm run typecheck` — zero errors
2. `npm run lint` — zero new errors
3. `npx vitest --run` — fully green (no skipped-without-reason, no placeholder assertions)
4. `npm run build` — succeeds
5. Behavioral change ⇒ behavioral test; user-visible change ⇒ exercised, not just compiled

## Hard rules

- **Money**: nothing in development or CI spends real funds. Upload tests use <100KB free-tier fixtures only (see BACKLOG INFRA-9).
- **IPC**: all handlers return `{success, data?, error?}` (decision D-005) and validate inputs via InputValidator.
- **Decisions**: don't relitigate [DECISIONS.md](docs/product/DECISIONS.md) in PRs — supersede with a new entry instead.
- **Docs**: `docs/archive/` is historical; never implement from it.

## CI

`.github/workflows/mvp-workflow.yml` — manual dispatch only (`build_type: test|release`, `platforms: windows|mac|both`) to conserve Actions minutes. Tag pushes (`v*.*.*`) trigger release builds.
