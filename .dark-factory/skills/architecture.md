# Architecture

## Current System
- Single-package Node.js CLI in `src/index.ts` with three command paths:
  - `transform --title <number> --output <dir>`
  - `backfill --phase constitution --target <dir>`
  - `fetch (--status | --all | --source=<name>) [--congress=<n>] [--force]`
- No database, HTTP API, queue, or background worker.
- The repo now has three major flows:
  1. OLRC USLM XML → IR → markdown (`transform`)
  2. Static Constitution dataset → planned historical events → rendered files + backdated git history (`backfill`)
  3. Raw-source acquisition + manifest-backed caching for OLRC, Congress.gov, GovInfo, VoteView, and UnitedStates (`fetch`)

## Codebase Map
- `src/index.ts` — top-level CLI dispatcher, arg parsing, usage/error text, process exit policy.
- `src/commands/fetch.ts` — `fetch` CLI arg validation, `--status`, single-source dispatch, deterministic `--all` order.
- `src/domain/` — transform-only IR and normalization helpers for USLM ingestion.
- `src/sources/olrc.ts` — OLRC listing scrape, latest-vintage selection, ZIP download/extraction, transform ZIP helpers.
- `src/sources/congress.ts` — Congress.gov bulk fetch orchestration, shared-rate-limit use, member snapshot reuse, congress checkpoint updates.
- `src/sources/congress-member-snapshot.ts` — freshness evaluation for the reusable Congress global-member snapshot.
- `src/sources/govinfo.ts` — GovInfo PLAW walk, checkpointed resume state, retained-package summary/granule finalization.
- `src/sources/voteview.ts` — static CSV download plus in-memory indexes for congress/member lookups.
- `src/sources/unitedstates.ts` — YAML download, lightweight parsing, Congress-snapshot-based bioguide crosswalk generation/skip handling.
- `src/utils/cache.ts` — raw response cache keying, TTL reads, atomic body/metadata writes.
- `src/utils/manifest.ts` — manifest schema normalization, empty-manifest defaults, atomic manifest writes.
- `src/utils/fetch-config.ts` — current Congress resolution (`override`/`live`/`fallback`) and fallback warning path.
- `src/utils/logger.ts` — structured network logging with `api_key` redaction.
- `src/utils/rate-limit.ts` — sliding-window limiter helpers used by Congress/GovInfo.
- `src/transforms/` — USLM parsing, markdown rendering, and output writing for `transform`.
- `src/backfill/constitution/dataset.ts` — committed Constitution dataset (7 articles, 27 amendments) plus metadata/author mapping.
- `src/backfill/renderer.ts` — deterministic YAML frontmatter + markdown rendering for Constitution provisions.
- `src/backfill/messages.ts` — exact Constitution/amendment commit-message formatting.
- `src/backfill/planner.ts` — pure 28-event plan builder (`constitution` + `amendment-01..27`).
- `src/backfill/target-repo.ts` — target directory bootstrap, attached-HEAD check, clean-tree preflight, prefix-history detection, push-remote resolution.
- `src/backfill/git-adapter.ts` — git CLI wrapper, UTC commit env construction, and `git fast-import` historical commit creation.
- `src/backfill/orchestrator.ts` — end-to-end Constitution backfill execution + push classification.
- `tests/cli/fetch.test.ts` — fetch CLI contract and `--all`/`--status` behavior.
- `tests/utils/` — fetch-config, manifest, rate-limit, and helper coverage.
- `tests/adversary-round1-issue5.test.ts` … `tests/adversary-round9-issue5.test.ts` — issue #5 regression chain, including stale crosswalk cleanup.

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

## Fetch Acquisition Model
- `fetch` persists only to `data/cache/{source}/` and `data/manifest.json`; no database layer exists.
- Cache split:
  - permanent file artifacts: OLRC ZIP/XML, VoteView CSVs, legislators YAML/crosswalk
  - TTL-governed raw API responses: Congress + GovInfo via `src/utils/cache.ts`
- Manifest state tracked in `src/utils/manifest.ts` includes:
  - per-source `last_success_at` / `last_failure`
  - Congress `bulk_scope`, `member_snapshot`, `congress_runs`, `bulk_history_checkpoint`
  - GovInfo `query_scopes` and `checkpoints`
  - legislators `cross_reference` state with explicit skip statuses
- Congress global-member snapshot is intentionally separate from per-congress bill/committee runs. `src/sources/unitedstates.ts` may use it only when the latest snapshot is both `status: 'complete'` and still fresh per `evaluateCongressMemberSnapshotFreshness()`.
- `fetch --all` runs sources serially in fixed order: `olrc`, `congress`, `govinfo`, `voteview`, `legislators`.
- Current-congress resolution in `src/utils/fetch-config.ts` is process-cached and can be `override`, `live`, or `fallback`; fallback marks the bulk scope as degraded/operator-review-required.

## Security-Relevant Architecture Notes
- Target bootstrap is intentionally strict:
  - empty non-git directory → initialize in place
  - populated non-git directory → deterministic failure
- Existing git targets must be clean before any backfill writes.
- Resume semantics are intentionally narrow: only contiguous Constitution prefixes are allowed.
- Historical timestamps are fixed to exact UTC midnight values using `YYYY-MM-DDT00:00:00+0000`.
- Push failures do not rewrite history; local commits remain intact for rerun.
- Fetch-path safety/hardening now also matters:
  - manifest and raw-response cache writes are temp-file + rename atomic writes
  - cache artifacts are written `0640`; manifest is written `0600`
  - structured logs redact `api_key` query params via `src/utils/logger.ts`
  - Congress/GovInfo stop immediately on limiter exhaustion and return `next_request_at` instead of sleeping until the next window
  - legislators skip states must not leave a stale `data/cache/legislators/bioguide-crosswalk.json` on disk

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
  - issue #5 acquisition layer:
    - `fetch` CLI in `src/commands/fetch.ts`
    - OLRC latest-vintage bulk acquisition under `data/cache/olrc/`
    - Congress.gov per-congress acquisition + reusable global member snapshot
    - GovInfo PLAW walk with checkpointed resume state
    - VoteView CSV download + in-memory lookup indexes
    - UnitedStates YAML download + optional bioguide crosswalk
    - manifest-backed source status and raw-response caching
  - unit, integration, snapshot, and adversary coverage for issues #3 and #5
- What's intentionally deferred:
  - non-Constitution backfill phases that consume fetched artifacts
  - rewriting/repairing non-prefix histories
  - force-push/rebase/history rewrite automation
  - network fetching of Constitution text at runtime
  - GitHub/PR automation for downstream `us-code`
  - a database-backed ingestion/indexing layer; issue #5 remains filesystem-first by design
- What's a test double vs production:
  - committed Constitution dataset is production application data, not a test double
  - temp git repos in tests are intentional doubles for downstream repositories
  - bare remotes in adversary tests are intentional doubles for configured push remotes
  - fixture payloads for OLRC/Congress/GovInfo/VoteView/legislators are intentional doubles for upstream sources; the manifest/cache/state-machine code paths are production paths
