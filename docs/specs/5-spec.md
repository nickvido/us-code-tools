# Data Acquisition — API Clients & Initial Source Download

## Summary
Build the first ingestion layer for `us-code-tools`: typed source clients, shared fetch utilities, a `fetch` CLI workflow, and on-disk cache/manifest storage that can acquire raw source data from OLRC, GovInfo, Congress.gov, VoteView, and `unitedstates/congress-legislators`. This feature exists so downstream transforms, historical backfill, and sync workflows can consume stable, cached raw inputs instead of talking to external sources directly.

## Context
- `README.md` and `SPEC.md` define `src/sources/` and `src/utils/` as the source-ingestion boundary, but the repository does not yet contain those modules.
- Issue #1 already established the XML→markdown transform as a downstream consumer of OLRC USLM XML; this issue supplies the raw OLRC corpus that transform reads.
- Congress.gov and GovInfo use the same `api.data.gov` key and therefore must share a coordinated rate budget rather than rate-limiting independently.
- Cached source artifacts must live under `data/` and must not be committed.
- The implementation must make degraded runs machine-detectable, especially when `fetch --all` cannot resolve the live current Congress and falls back to the versioned floor in `src/utils/fetch-config.ts`.
- The implementation must make OLRC corpus selection deterministic when the annual-title-files listing exposes multiple annual vintages or duplicate candidate links.

## Acceptance Criteria

### 1. Shared fetch infrastructure
- [ ] New module `src/utils/cache.ts` exposes typed read/write helpers for raw response caching under `data/cache/{source}/` with TTL support for API responses and non-expiring storage for downloaded artifacts marked as permanent. Tests must cover cache hit, cache miss, TTL expiry, and force-refresh bypass.  <!-- Touches: src/utils/cache.ts, tests/utils/cache.test.ts -->
- [ ] New module `src/utils/rate-limit.ts` exposes a typed rate limiter that supports a configurable token-bucket or sliding-window policy, can consume a shared budget object across multiple clients, and honors `Retry-After` headers by delaying the next permitted request until the advertised retry time. Tests must prove the limiter blocks the `(limit + 1)`th request inside the configured window and resumes after the wait interval.  <!-- Touches: src/utils/rate-limit.ts, tests/utils/rate-limit.test.ts -->
- [ ] New module `src/utils/logger.ts` emits structured network log events for request start, request success, request retry, request cache-hit, request cache-miss, and request failure. Each event must include at least `source`, `operation`, `url`, `status` when a response exists, and a request duration in milliseconds.  <!-- Touches: src/utils/logger.ts, tests/utils/logger.test.ts -->
- [ ] New module `src/sources/base-client.ts` centralizes native `fetch` execution, retry-with-backoff, cache lookup/write-through, and rate-limit coordination so the per-source clients do not duplicate those behaviors. Retries must be limited to transient failures (`429`, `502`, `503`, `504`, and network exceptions) and must not retry 4xx responses other than `429`.  <!-- Touches: src/sources/base-client.ts, tests/sources/base-client.test.ts -->

### 2. Manifest and status model
- [ ] New module `src/utils/manifest.ts` persists `data/manifest.json` as typed JSON containing, at minimum, one top-level entry per source (`olrc`, `congress`, `govinfo`, `voteview`, `legislators`) plus a `bulk_scope` object for `fetch --all` runs. Each source entry must record the last run timestamp, result status (`success`, `partial`, or `failed`), and downloaded artifact descriptors.  <!-- Touches: src/utils/manifest.ts, tests/utils/manifest.test.ts -->
- [ ] When `fetch --all` determines the Congress scope by calling the live “current Congress” lookup and that lookup succeeds, `data/manifest.json` and the JSON status output must record `bulk_scope.congress.resolution="live"` and the resolved congress number. When that lookup fails and the runtime falls back to the versioned floor value from new module `src/utils/fetch-config.ts`, the same outputs must record `bulk_scope.congress.resolution="fallback"`, the fallback congress number, and `bulk_scope.congress.operator_review_required=true`. Tests must simulate a forced lookup failure and assert the degraded markers are present.  <!-- Touches: src/utils/fetch-config.ts, src/utils/manifest.ts, src/cli/fetch.ts, tests/cli/fetch-all-fallback.test.ts -->
- [ ] `npx us-code-tools fetch --status` must print a machine-readable JSON document to stdout that includes the persisted manifest content plus a per-source summary of artifact counts and last successful download timestamps. If `data/manifest.json` does not yet exist, the command must exit `0` and emit an empty-state JSON object rather than throwing.  <!-- Touches: src/cli/fetch.ts, src/index.ts, tests/cli/fetch-status.test.ts -->

### 3. OLRC source client
- [ ] New module `src/sources/olrc.ts` exposes typed operations to fetch the annual title listing page, select the single latest annual vintage present on that page, derive exactly 54 title ZIP download targets from that vintage, download each ZIP into `data/cache/olrc/`, and extract each archive into a deterministic subdirectory under the same source cache. The selected annual vintage must be recorded in both the manifest and the JSON result of the run.  <!-- Touches: src/sources/olrc.ts, tests/sources/olrc.test.ts, tests/fixtures/olrc/*.html -->
- [ ] OLRC vintage selection must be deterministic: given an HTML fixture containing multiple annual sets and duplicate candidate links, the client must always pick the latest published vintage and must use that same vintage for all 54 titles in a single run. Tests must fail if mixed-vintage ZIP URLs are accepted in one run.  <!-- Touches: src/sources/olrc.ts, tests/sources/olrc-vintage-selection.test.ts -->
- [ ] A successful OLRC run must mark a title complete only after both the ZIP file and at least one extracted XML file exist on disk. A partially downloaded ZIP, corrupt ZIP, or extraction failure must set the source result to `partial` or `failed`, record the failing title number in the manifest, and leave already completed titles intact.  <!-- Touches: src/sources/olrc.ts, src/utils/manifest.ts, tests/sources/olrc-failure-modes.test.ts -->

### 4. Congress.gov client
- [ ] New module `src/sources/congress.ts` exposes typed methods for `listBills(congress)`, `getBill(congress, type, number)`, `getBillActions(congress, type, number)`, `getBillCosponsors(congress, type, number)`, `listMembers(params)`, `getMember(bioguideId)`, and `listCommittees(congress)`. No exported API may use `any`; tests must compile under `tsc --noEmit`.  <!-- Touches: src/sources/congress.ts, tests/sources/congress.test.ts -->
- [ ] `listBills(congress)` must paginate until the upstream response indicates completion, persist each raw page response under `data/cache/congress/`, and return a stable aggregated sequence ordered exactly as received from the API pages. Tests must simulate at least three pages and verify no page is skipped or duplicated.  <!-- Touches: src/sources/congress.ts, tests/sources/congress-pagination.test.ts -->
- [ ] Congress.gov requests must consume the shared `api.data.gov` rate budget used by GovInfo rather than a separate limiter. Tests must prove that interleaved Congress.gov and GovInfo requests count against the same limiter instance.  <!-- Touches: src/sources/congress.ts, src/sources/govinfo.ts, src/utils/rate-limit.ts, tests/sources/shared-rate-budget.test.ts -->

### 5. GovInfo client
- [ ] New module `src/sources/govinfo.ts` exposes typed methods for enumerating the `PLAW` collection, retrieving package summaries, and retrieving package granules. The collection enumeration API must support page traversal or offset traversal until no further items remain.  <!-- Touches: src/sources/govinfo.ts, tests/sources/govinfo.test.ts -->
- [ ] `fetch --source=govinfo --congress=<N>` must be able to enumerate all public-law packages for the requested Congress, persist raw collection and package responses under `data/cache/govinfo/`, and record the discovered package ids in the manifest. Tests must use fixtures covering multi-page collection traversal plus at least one package summary and granules response.  <!-- Touches: src/sources/govinfo.ts, src/cli/fetch.ts, tests/cli/fetch-govinfo.test.ts -->
- [ ] GovInfo responses that return XML bodies instead of JSON must still be cached byte-for-byte and surfaced through typed parser helpers without losing the original raw payload.  <!-- Touches: src/sources/govinfo.ts, src/utils/cache.ts, tests/sources/govinfo-xml.test.ts -->

### 6. VoteView and unitedstates clients
- [ ] New module `src/sources/voteview.ts` downloads `HSall_members.csv`, `HSall_votes.csv`, and `HSall_rollcalls.csv` into `data/cache/voteview/` and exposes typed iterators or parser functions that can stream or incrementally parse each file without loading the entire corpus into memory at once. Tests must verify each file is discoverable by configured filename and that parser output yields typed row objects for sample fixtures.  <!-- Touches: src/sources/voteview.ts, tests/sources/voteview.test.ts -->
- [ ] New module `src/sources/unitedstates.ts` downloads or clones the `unitedstates/congress-legislators` source into `data/cache/legislators/` and exposes typed loaders for `legislators-current.yaml`, `legislators-historical.yaml`, and `committees-current.yaml`. Tests must verify each required file is cached and parsed into typed records keyed by available identifier fields, including Bioguide ID when present.  <!-- Touches: src/sources/unitedstates.ts, tests/sources/unitedstates.test.ts -->

### 7. CLI orchestration
- [ ] New CLI workflow `npx us-code-tools fetch` must support `--all`, `--status`, `--source=<olrc|congress|govinfo|voteview|legislators>`, `--congress=<number>`, and `--force`. Invalid combinations (including `--all` with `--source`, or `--status` with download flags) must exit non-zero with a deterministic usage error message.  <!-- Touches: src/cli/fetch.ts, src/index.ts, tests/cli/fetch-args.test.ts -->
- [ ] `fetch --all` must invoke all five source workflows in a deterministic order (`olrc`, `govinfo`, `congress`, `voteview`, `legislators`), persist per-source results into the manifest even if a later source fails, and exit non-zero if any source result is `failed`. Partial completion must remain observable through `data/manifest.json` and `fetch --status`.  <!-- Touches: src/cli/fetch.ts, src/utils/manifest.ts, tests/cli/fetch-all.test.ts -->
- [ ] ⚡ `fetch --all` is a cross-module wiring path that must reuse the same manifest writer, shared rate budget, and structured logger across every source run instead of constructing isolated per-source state. Tests must assert that one combined run produces a single manifest reflecting all source results and shared bulk scope metadata.  <!-- Touches: src/cli/fetch.ts, src/utils/manifest.ts, src/utils/rate-limit.ts, src/utils/logger.ts, tests/cli/fetch-all-shared-state.test.ts -->

### 8. Repository and test hardening
- [ ] `.gitignore` must continue to ignore `data/` so fetched artifacts are never staged by default. A repository test or verification step must fail if `data/` stops being ignored.  <!-- Touches: .gitignore, tests/repo/gitignore.test.ts or equivalent verification -->
- [ ] The automated test suite must include fixture-backed unit tests for all five source clients, shared cache/rate-limit/manifest utilities, and CLI argument handling. Integration tests that perform real network calls must be skipped unless an explicit env flag is set.  <!-- Touches: tests/**, package.json, vitest.config.ts -->

## Out of Scope
- Transforming OLRC XML or GovInfo/Congress data into markdown output.
- Creating git commits, branches, or pull requests in the downstream `us-code` repository.
- Ongoing schedulers, cron jobs, or sync orchestration beyond the on-demand `fetch` workflow.
- Historical backfill semantics beyond downloading and caching the raw source data required for later phases.
- Data normalization or entity-merging between Congress.gov, VoteView, and unitedstates beyond parsing and exposing typed raw-source records.

## Dependencies
- `SPEC.md` sections 4 and 5 for source priority, architecture, and CLI direction.
- Issue #1 output for downstream OLRC XML consumption.
- `api.data.gov` key for Congress.gov and GovInfo integration testing and live runs.
- New source modules under `src/sources/`, new utilities under `src/utils/`, and a new CLI entry path under `src/cli/`.

## Acceptance Tests (human-readable)
1. Run `npx us-code-tools fetch --status` in a clean checkout with no `data/manifest.json`. Verify exit code `0` and JSON output showing an empty state.
2. Run `npx us-code-tools fetch --source=olrc` against a fixture-backed test or live source. Verify `data/cache/olrc/` contains 54 ZIP files, extracted XML directories, and `data/manifest.json` records the selected OLRC vintage.
3. Run `npx us-code-tools fetch --source=congress --congress=119`. Verify raw page responses are cached under `data/cache/congress/`, the manifest records the requested Congress scope, and pagination completed without duplicate pages.
4. Run `npx us-code-tools fetch --source=govinfo --congress=119`. Verify `data/cache/govinfo/` contains collection pages plus package payloads and the manifest records enumerated `PLAW` package ids for Congress 119.
5. Run `npx us-code-tools fetch --source=voteview`. Verify the three required CSV files exist in `data/cache/voteview/` and parser tests can read sample rows from each file.
6. Run `npx us-code-tools fetch --source=legislators`. Verify the three required YAML files exist in `data/cache/legislators/` and parsed records expose available Bioguide IDs when present.
7. Run `npx us-code-tools fetch --all` with fixture or test doubles forcing the current-Congress lookup to fail. Verify the command still runs using the fallback congress value, exits according to downstream source results, and both stdout JSON and `data/manifest.json` include `bulk_scope.congress.resolution="fallback"` plus `operator_review_required=true`.
8. Run `npx us-code-tools fetch --all` with one source forced to fail after earlier sources succeed. Verify completed sources remain recorded in the manifest, the process exits non-zero, and `fetch --status` exposes the mixed success/failure state.
9. Run the automated tests with integration flag disabled. Verify fixture-backed unit/CLI tests run and live-network integration tests are skipped.

## Edge Case Catalog
- OLRC listing page includes multiple annual vintages, duplicate links for one title, missing titles in the newest vintage, or malformed links that do not encode a title number.
- OLRC ZIP download succeeds but extraction fails because the archive is truncated or corrupt.
- Congress.gov or GovInfo returns `429` with `Retry-After`; the client must wait, retry, and log the degraded event instead of hard-failing immediately.
- `fetch --all` cannot resolve the live current Congress; the system falls back to the versioned floor value and must surface the degraded state in manifest/status output so operators cannot mistake it for a full live run.
- One source in `fetch --all` fails after earlier sources succeeded; manifest durability must preserve completed source results.
- Cache directory exists but a cache file is unreadable, partially written, or expired.
- VoteView or YAML source files include BOM markers, mixed line endings, empty trailing rows, or invalid UTF-8 bytes.
- API pagination responses omit expected continuation fields, return duplicate items across pages, or return an empty page before completion.
- Concurrent invocations of `fetch --status` and a write-path fetch command occur while the manifest is being updated.
- Missing API key for Congress.gov/GovInfo live runs.
- Forced refresh of a permanent artifact source must replace the cached file atomically rather than leaving a partially written file on interruption.

## Verification Strategy
- **Pure core:** OLRC vintage selection, cache-key derivation, manifest merge/update logic, CLI argument validation, pagination continuation logic, and degraded bulk-scope classification should be implemented as pure functions with fixture-driven tests.
- **Properties:**
  - For any OLRC listing fixture, the chosen vintage is the single maximum published vintage present in the parsed candidate set.
  - For any one OLRC run, every accepted title URL shares the same chosen vintage.
  - For any shared rate budget with limit `L`, the `(L + 1)`th request inside the active window is delayed or rejected until capacity returns.
  - For any cached API object with TTL `T`, reads before `createdAt + T` return a cache hit and reads after that instant require refresh unless `permanent=true`.
  - For any degraded `fetch --all` congress-resolution fallback, the manifest and JSON status output both contain identical `bulk_scope.congress` metadata.
- **Purity boundary:** Network I/O, filesystem writes, archive extraction, and CLI stdout/stderr live at the effectful shell. Parsing, selection, validation, manifest-state transitions, and retry scheduling decisions should stay pure and be tested independently of I/O.

## Infrastructure Requirements
- **Database:** None.
- **API endpoints:** No application HTTP endpoints; this issue introduces a new local CLI command surface `fetch` within `us-code-tools`.
- **Infrastructure:** Local filesystem storage under `data/cache/` and `data/manifest.json`; no queues or external storage buckets.
- **Environment variables / secrets:** `api.data.gov` key for live Congress.gov and GovInfo access, exposed through the project’s env/config mechanism. Integration tests must be skippable when the key is absent.

## Complexity Estimate
XL

## Decomposition Plan
1. Shared fetch utilities (`cache`, `rate-limit`, `logger`, `manifest`, `fetch-config`, `base-client`).
2. Source clients (`olrc`, `govinfo`, `congress`, `voteview`, `unitedstates`).
3. CLI orchestration (`fetch`, `--status`, argument validation, shared-state wiring).
4. Hardening and verification (fixtures, degraded-mode tests, integration-test gating).

## Required Skills
typescript, node.js, vitest, filesystem I/O, HTTP client design, XML/CSV/YAML parsing
