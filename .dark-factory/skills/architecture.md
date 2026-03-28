# Architecture

## Current System
- Single-package Node.js CLI in `src/index.ts` with two command paths:
  - `transform --title <number> --output <dir>`
  - `backfill --phase constitution --target <dir>`
- No database, HTTP API, queue, or background worker.
- The repo now has two major flows:
  1. OLRC USLM XML → IR → markdown (`transform`)
  2. Static Constitution dataset → planned historical events → rendered files + backdated git history (`backfill`)

## Codebase Map
- `src/index.ts` — top-level CLI dispatcher, arg parsing, usage/error text, process exit policy.
- `src/domain/` — transform-only IR and normalization helpers for USLM ingestion.
- `src/sources/olrc.ts` — remote ZIP acquisition/caching/hardening for `transform`.
- `src/transforms/` — USLM parsing, markdown rendering, and output writing for `transform`.
- `src/backfill/constitution/dataset.ts` — committed Constitution dataset (7 articles, 27 amendments) plus metadata/author mapping.
- `src/backfill/renderer.ts` — deterministic YAML frontmatter + markdown rendering for Constitution provisions.
- `src/backfill/messages.ts` — exact Constitution/amendment commit-message formatting.
- `src/backfill/planner.ts` — pure 28-event plan builder (`constitution` + `amendment-01..27`).
- `src/backfill/target-repo.ts` — target directory bootstrap, attached-HEAD check, clean-tree preflight, prefix-history detection, push-remote resolution.
- `src/backfill/git-adapter.ts` — git CLI wrapper, UTC commit env construction, and `git fast-import` historical commit creation.
- `src/backfill/orchestrator.ts` — end-to-end Constitution backfill execution + push classification.
- `tests/unit/` — argument, dataset, renderer, message, planner, and git-env unit coverage.
- `tests/integration/backfill-constitution.test.ts` — temp-repo end-to-end backfill coverage.
- `tests/adversary-round1-issue3.test.ts` — configured-remote explicit push regression.

## Backfill Data Model
- `ConstitutionDataset` in `src/backfill/constitution/dataset.ts`
  - `constitution.signed`, `ratified`, `ratifiedDetail`, `source`, `authorName`, `authorEmail`
  - `constitution.articles: ConstitutionProvisionRecord[]`
  - `amendments: ConstitutionProvisionRecord[]`
- `ConstitutionProvisionRecord`
  - `type: 'article' | 'amendment'`
  - `number: number`
  - `romanNumeral: string`
  - `heading: string`
  - `proposed: string`
  - `ratified: string`
  - `proposing_body: string`
  - `proposingBody: string`
  - `authorName: string`
  - `authorEmail: string`
  - `source: string`
  - `markdownBody: string`
- `HistoricalEvent` in `src/backfill/planner.ts`
  - `sequence`, `slug`, `ratified`, `ratifiedDate`, `authorName`, `authorEmail`, `commitMessage`, `writes`
- `BackfillSummary` in `src/backfill/orchestrator.ts`
  - `phase`, `target`, `eventsPlanned`, `eventsApplied`, `eventsSkipped`, `pushResult`

## Backfill Flow
1. `src/index.ts` parses `backfill --phase constitution --target <dir>`.
2. `runConstitutionBackfill(target)` loads static dataset and builds the 28-event plan.
3. `prepareTargetRepo()`:
   - creates/init's a missing target dir
   - `git init`s an existing empty non-git dir
   - rejects populated non-git dirs
   - rejects detached HEAD
   - rejects dirty working trees
   - allows only empty history or an exact contiguous prefix of the Constitution plan
   - resolves push remote via `branch.<name>.pushRemote` → `branch.<name>.remote` → `origin` → first remote
4. Orchestrator writes each missing event’s files to deterministic paths under `constitution/`.
5. `commitHistoricalEvent()` creates backdated commits via `git fast-import`, then hard-resets the working tree to `HEAD`.
6. If a push remote exists, orchestrator runs `git push --set-upstream <remote> <branch>`; otherwise it reports local-only success.

## Rendering / History Contracts
- First event writes all seven article files in a single commit dated `1788-06-21`.
- Events 2–28 each write exactly one amendment file.
- Markdown frontmatter keys are fixed to:
  - `type`
  - `number`
  - `heading`
  - `ratified`
  - `proposed`
  - `proposing_body`
  - `source`
- Article paths: `constitution/article-I.md` … `constitution/article-VII.md`
- Amendment paths: `constitution/amendment-01.md` … `constitution/amendment-27.md`
- Commit messages come only from `src/backfill/messages.ts`; matching-prefix detection compares author name/email, ratified date, and full normalized commit message.

## Security-Relevant Architecture Notes
- Target bootstrap is intentionally strict:
  - empty non-git directory → initialize in place
  - populated non-git directory → deterministic failure
- Existing git targets must be clean before any backfill writes.
- Resume semantics are intentionally narrow: only contiguous Constitution prefixes are allowed.
- Historical timestamps are fixed to exact UTC midnight values using `YYYY-MM-DDT00:00:00+0000`.
- Push failures do not rewrite history; local commits remain intact for rerun.

## Things Future Agents Should Notice
- `docs/architecture/3-architecture.md` proposes an `authors.ts` split, but the current implementation keeps author identity inside `src/backfill/constitution/dataset.ts`; do not assume a separate author module exists.
- `git-adapter.ts` exposes `buildGitCommitEnv()` for unit coverage, but actual commit creation uses `git fast-import` instead of `git commit`.
- Prefix validation keys off commit metadata, not file diffs.

## Phase 1 Scope (Current)
- What's implemented:
  - original Title 1 USLM transform flow
  - Constitution static dataset and renderer
  - 28-event historical planner
  - deterministic backdated git history creation
  - target-repo bootstrap/preflight/resume logic
  - push classification: `pushed` vs `skipped-local-only`
  - unit, integration, snapshot, and adversary coverage for issue #3
- What's intentionally deferred:
  - non-Constitution backfill phases (US Code titles, public laws)
  - rewriting/repairing non-prefix histories
  - force-push/rebase/history rewrite automation
  - network fetching of Constitution text at runtime
  - GitHub/PR automation for downstream `us-code`
- What's a test double vs production:
  - committed Constitution dataset is production application data, not a test double
  - temp git repos in tests are intentional doubles for downstream repositories
  - bare remotes in adversary tests are intentional doubles for configured push remotes
