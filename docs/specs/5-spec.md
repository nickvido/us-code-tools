# Data Acquisition — API Clients & Initial Source Download

## Summary
This umbrella spec defines the raw-data acquisition layer for `us-code-tools`: typed source clients, shared cache/rate-limit/retry/logging infrastructure, a manifest-backed `fetch` CLI, and the initial bulk-download contracts for OLRC, Congress.gov, GovInfo, VoteView, and `unitedstates/congress-legislators`. The goal is to make downstream title backfill, public-law history, bills-as-PRs, member profiles, and vote-history work consume stable cached artifacts instead of re-querying upstream sources ad hoc.

## Context
- The repository is `us-code-tools`, with runtime code under `src/` and tests under `tests/`; the older `scripts/src/*` layout in `SPEC.md` is aspirational and not authoritative for this issue.
- This issue is an **umbrella epic**. It is the canonical contract for a decomposed delivery, not a requirement to land all implementation slices in one PR.
- Raw acquisition must cover five upstream sources with different transport and file formats: XML/ZIP, JSON, CSV, and YAML.
- Congress.gov and GovInfo share the same `api.data.gov` credential and therefore share one coordinated request budget.
- Cached raw artifacts live under `data/cache/{source}/`; acquisition status lives in `data/manifest.json`; `data/` must remain Git-ignored.

## Delivery Model
This parent issue is implementation-complete only when the following child slices are complete and satisfy the acceptance criteria below:
1. Shared acquisition infrastructure (`src/utils/*` + manifest/status wiring)
2. OLRC bulk acquisition
3. Congress.gov acquisition
4. GovInfo acquisition
5. VoteView acquisition + indexing
6. UnitedStates legislators acquisition + cross-reference
7. CLI/status/concurrency/repo hygiene/tests

## CLI Contract

### Valid invocations
- `npx us-code-tools fetch --status`
- `npx us-code-tools fetch --source=olrc`
- `npx us-code-tools fetch --source=olrc --force`
- `npx us-code-tools fetch --source=congress --congress=<integer>`
- `npx us-code-tools fetch --source=congress --congress=<integer> --force`
- `npx us-code-tools fetch --source=govinfo`
- `npx us-code-tools fetch --source=govinfo --force`
- `npx us-code-tools fetch --source=govinfo --congress=<integer>`
- `npx us-code-tools fetch --source=govinfo --congress=<integer> --force`
- `npx us-code-tools fetch --source=voteview`
- `npx us-code-tools fetch --source=voteview --force`
- `npx us-code-tools fetch --source=legislators`
- `npx us-code-tools fetch --source=legislators --force`
- `npx us-code-tools fetch --all`
- `npx us-code-tools fetch --all --force`
- `npx us-code-tools fetch --all --congress=<integer>`
- `npx us-code-tools fetch --all --congress=<integer> --force`

### Invalid invocations
These exit `2`, write no cache or manifest changes, and print one JSON usage error object to stderr with `error.code="invalid_arguments"`.
- `npx us-code-tools fetch`
- `npx us-code-tools fetch --status --force`
- `npx us-code-tools fetch --source=congress`
- `npx us-code-tools fetch --source=congress --source=govinfo`
- `npx us-code-tools fetch --source=olrc --congress=<integer>`
- `npx us-code-tools fetch --source=voteview --congress=<integer>`
- `npx us-code-tools fetch --source=legislators --congress=<integer>`
- `npx us-code-tools fetch --all --source=<anything>`
- any invocation where `<integer>` is not base-10 digits representing a positive safe integer

## Acceptance Criteria

### 1) Shared infrastructure
- [ ] `src/index.ts` adds a `fetch` command that implements the valid/invalid CLI contract above.
  <!-- Touches: src/index.ts, tests/cli/fetch.test.ts -->
- [ ] New shared infrastructure modules provide typed interfaces with no `any` for: cache I/O, manifest I/O, structured logging, retry/backoff, rate limiting, and fetch configuration constants.
  <!-- Touches: src/utils/cache.ts, src/utils/manifest.ts, src/utils/logger.ts, src/utils/retry.ts, src/utils/rate-limit.ts, src/utils/fetch-config.ts, tests/utils/* -->
- [ ] `src/utils/fetch-config.ts` exports `getCurrentCongress(): Promise<number>`, which resolves the current congress from `GET https://api.congress.gov/v3/congress/current?api_key=${API_DATA_GOV_KEY}`, caches the resolved value for the lifetime of the process, and supports `CURRENT_CONGRESS_OVERRIDE` for tests; if the upstream call fails, it falls back to a logged hardcoded floor value and returns that fallback.
  <!-- Touches: src/utils/fetch-config.ts, tests/utils/fetch-config.test.ts -->
- [ ] Raw artifacts are written only under `data/cache/{source}/`; acquisition status is written only to `data/manifest.json`.
  <!-- Touches: src/utils/cache.ts, src/utils/manifest.ts, tests/utils/cache.test.ts -->
- [ ] Cache entries with a still-fresh TTL are reused without issuing a network request unless `--force` is set.
  <!-- Touches: src/utils/cache.ts, tests/utils/cache.test.ts -->
- [ ] Cache and manifest writes are atomic from the perspective of readers: after any completed or failed command, `data/manifest.json` is valid JSON and no manifest success entry points at a partially written artifact.
  <!-- Touches: src/utils/cache.ts, src/utils/manifest.ts, tests/integration/concurrency.test.ts -->
- [ ] If two fetch commands target the same source/cache path concurrently, the final state is one of two valid outcomes only: (a) one writer wins and all referenced artifacts are complete, or (b) one writer fails with a deterministic runtime/conflict error while previously finalized artifacts and the manifest remain uncorrupted.
  <!-- Touches: src/utils/cache.ts, src/utils/manifest.ts, tests/integration/concurrency.test.ts -->
- [ ] Structured logs for network operations include source name, URL, HTTP method, attempt number, cache status, and duration, and must not include API keys or Authorization headers.
  <!-- Touches: src/utils/logger.ts, tests/utils/logger.test.ts -->

### 2) Credential and shared-rate-limit contract
- [ ] Congress.gov and GovInfo runtime/auth tests use **only** `API_DATA_GOV_KEY` as the credential source; no alternate env var name or config-file fallback is part of this spec.
  <!-- Touches: src/sources/congress.ts, src/sources/govinfo.ts, tests/sources/auth.test.ts -->
- [ ] If `API_DATA_GOV_KEY` is missing or empty for a Congress.gov or GovInfo command, that source fails before any outbound HTTP request, exits `1` for source-only commands, reports `error.code="missing_api_data_gov_key"`, and writes no success manifest entry for that source.
  <!-- Touches: src/sources/congress.ts, src/sources/govinfo.ts, tests/sources/auth.test.ts -->
- [ ] If Congress.gov or GovInfo returns `401` or `403`, the source exits `1` for source-only commands, returns a JSON summary with `error.code="upstream_auth_rejected"`, preserves previously fresh cache entries, and writes no new success manifest entry for the rejected request set.
  <!-- Touches: src/sources/congress.ts, src/sources/govinfo.ts, tests/sources/auth.test.ts -->
- [ ] Congress.gov and GovInfo share one configurable limiter that can be set to a ceiling of `5000` requests per rolling hour and never schedules more requests inside a window than that configured ceiling permits.
  <!-- Touches: src/utils/rate-limit.ts, src/sources/congress.ts, src/sources/govinfo.ts, tests/utils/rate-limit.test.ts -->
- [ ] Interactive acquisition commands do **not** wait for the next hourly window when the shared budget is exhausted. They stop that source with `error.code="rate_limit_exhausted"`, include `rate_limit_exhausted: true` and `next_request_at` in the JSON summary, and may record only artifacts fully written before exhaustion.
  <!-- Touches: src/utils/rate-limit.ts, src/sources/congress.ts, src/sources/govinfo.ts, tests/sources/rate-limit.test.ts -->

### 3) OLRC bulk acquisition
- [ ] A new typed client module `src/sources/olrc.ts` downloads exactly 54 title ZIP artifacts corresponding to titles `1` through `54`, using the OLRC annual-title-files listing as the source of download URLs.
  <!-- Touches: src/sources/olrc.ts, tests/sources/olrc.test.ts -->
- [ ] `fetch --source=olrc` caches each downloaded ZIP and its extracted XML payloads under `data/cache/olrc/`, and the manifest records one entry per title with title number, ZIP path, extraction path, byte count, and fetch timestamp.
  <!-- Touches: src/sources/olrc.ts, src/utils/manifest.ts, tests/sources/olrc.test.ts -->
- [ ] If one or more titles fail after retries, the command exits `1`, reports failing title numbers in the JSON summary, and leaves successful title entries intact without manifest references to partial title artifacts.
  <!-- Touches: src/sources/olrc.ts, tests/sources/olrc.test.ts -->

### 4) Congress.gov acquisition
- [ ] A new typed client module `src/sources/congress.ts` implements methods for: paginated bill-list fetch (`GET /bill/{congress}`), bill detail (`GET /bill/{congress}/{type}/{number}`), bill actions, bill cosponsors, paginated member-list fetch (`GET /member`), member detail (`GET /member/{bioguideId}`), and paginated committee-list fetch (`GET /committee/{congress}`).
  <!-- Touches: src/sources/congress.ts, tests/sources/congress.test.ts -->
- [ ] Congress member acquisition is a separate **global member snapshot** within the Congress cache domain rather than a per-congress artifact set. The snapshot’s cache identity is independent of `<congress>`, and it is considered **fresh** only when every artifact referenced by the latest successful snapshot entry in the manifest (all member-list pages and all member-detail responses included in that snapshot) is still within the Congress API cache TTL; if any referenced artifact is missing, expired, or not part of a successful completed snapshot, the snapshot is stale.
  <!-- Touches: src/sources/congress.ts, src/utils/manifest.ts, tests/sources/congress-members.test.ts -->
- [ ] A non-`--force` Congress command reuses a fresh global member snapshot without reissuing `GET /member` or `GET /member/{bioguideId}` requests; a `--force` Congress command discards that freshness result and rebuilds the snapshot from the first member page.
  <!-- Touches: src/sources/congress.ts, src/utils/manifest.ts, tests/sources/congress-members.test.ts -->
- [ ] `fetch --source=congress --congress=<n>` performs the following acquisition set and caches every raw response under `data/cache/congress/`:
  1. every paginated `GET /bill/{n}` response until the API indicates there is no next page;
  2. for every bill enumerated from those list pages, its bill-detail, actions, and cosponsors responses;
  3. every paginated `GET /committee/{n}` response until there is no next page;
  4. the global Congress member snapshot **only if** no fresh global member snapshot already exists in cache or `--force` is set, where that snapshot consists of every paginated `GET /member` response until there is no next page and `GET /member/{bioguideId}` for every enumerated member whose `bioguideId` is non-empty.
  <!-- Touches: src/sources/congress.ts, tests/sources/congress.test.ts, tests/sources/congress-members.test.ts -->
- [ ] The manifest records, for each congress fetch, the requested congress number and counts for bill-list pages, bill-detail responses, bill-action responses, bill-cosponsor responses, committee pages, and failed bill detail fetches; the global member snapshot is recorded separately with member-page count, member-detail count, `snapshot_completed_at`, `cache_ttl_ms`, the list of artifact identities included in that snapshot, freshness metadata, and failed member-detail fetches.
  <!-- Touches: src/utils/manifest.ts, tests/sources/congress.test.ts, tests/sources/congress-members.test.ts -->
- [ ] If any required bill artifact for an enumerated bill or any required member-detail artifact within a global member snapshot fails after retries, the source exits `1`, the JSON summary names the failed entities, and the manifest may reference only fully written artifacts.
  <!-- Touches: src/sources/congress.ts, tests/sources/congress.test.ts, tests/sources/congress-members.test.ts -->
- [ ] `fetch --all` performs the global Congress member snapshot at most once per command invocation and reuses that snapshot across all congress numbers processed in the same run.
  <!-- Touches: src/index.ts, src/sources/congress.ts, tests/cli/fetch.test.ts -->
- [ ] **Bulk historical contract:** `fetch --all` without `--congress` must include Congress.gov acquisition for every congress integer in the inclusive range `93..getCurrentCongress()`, where `getCurrentCongress()` is the single runtime source of truth from `src/utils/fetch-config.ts`; tests may pin this via `CURRENT_CONGRESS_OVERRIDE`, and the resolved value is emitted in the JSON summary as `bulk_scope.congress.current`.
  <!-- Touches: src/index.ts, src/sources/congress.ts, src/utils/fetch-config.ts, tests/cli/fetch.test.ts -->
- [ ] Congress bulk-history progress is resumable. For `fetch --all` without `--congress`, the manifest records, per invocation scope, the next congress number still requiring work and any unfinished page cursor / entity queue for the in-progress congress. A later non-`--force` bulk run resumes from that recorded state instead of restarting at congress `93`.
  <!-- Touches: src/index.ts, src/sources/congress.ts, src/utils/manifest.ts, tests/sources/congress-resume.test.ts, tests/cli/fetch.test.ts -->
- [ ] For Congress bulk-history resume, a congress is marked complete only after its bill pages, bill detail/actions/cosponsors, committee pages, and any required global-member-snapshot work for that run are fully finalized. Completed congresses are not re-fetched on a later non-`--force` bulk run.
  <!-- Touches: src/sources/congress.ts, src/utils/manifest.ts, tests/sources/congress-resume.test.ts -->
- [ ] A `--force` bulk Congress run ignores any existing Congress bulk-history checkpoint for the matching scope, restarts from congress `93` (or the explicit `--congress=<n>` scope when provided), and atomically replaces that scope’s progress state with the new run’s result.
  <!-- Touches: src/index.ts, src/sources/congress.ts, src/utils/manifest.ts, tests/sources/congress-resume.test.ts -->
- [ ] `fetch --all --congress=<n>` narrows Congress.gov acquisition to exactly the same behavior as `fetch --source=congress --congress=<n>` and does not create or advance the multi-congress bulk-history checkpoint used by bare `fetch --all`.
  <!-- Touches: src/index.ts, tests/cli/fetch.test.ts -->

### 5) GovInfo acquisition
- [ ] A new typed client module `src/sources/govinfo.ts` implements methods for: paginated PLAW collection listing (`GET /collections/PLAW`), package summary (`GET /packages/{packageId}/summary`), and package granules (`GET /packages/{packageId}/granules`).
  <!-- Touches: src/sources/govinfo.ts, tests/sources/govinfo.test.ts -->
- [ ] `fetch --source=govinfo` uses this exact default query contract: collection `PLAW`, no congress filter, API-returned page order (the client issues the initial collection request with no sort override, then follows the exact `nextPage` URL/cursor returned by GovInfo without reordering). The acquisition loop interleaves listing and detail fetching: for each page of results, it first fetches the page, then fetches summary and granules for each retained package on that page before requesting the next listing page.
  <!-- Touches: src/sources/govinfo.ts, tests/sources/govinfo.test.ts -->
- [ ] GovInfo listing/finalization progress is checkpointed in the manifest with enough information for a later non-`--force` run to resume instead of restarting from page 1. The checkpoint must include: the next listing cursor/URL to request, the retained package IDs discovered but not yet finalized, the finalized package IDs already completed for that query scope, and the query scope (`unfiltered` or `congress=<n>`).
  <!-- Touches: src/sources/govinfo.ts, src/utils/manifest.ts, tests/sources/govinfo-resume.test.ts -->
- [ ] `fetch --source=govinfo --congress=<n>` uses the same PLAW walk but retains only packages whose `packageId` matches congress `<n>` by parsing the contiguous decimal digits immediately following the `PLAW-` prefix and stopping at the first non-digit character.
  <!-- Touches: src/sources/govinfo.ts, tests/sources/govinfo.test.ts -->
- [ ] The GovInfo manifest records `query_scope`, listing parameters, whether termination was `complete` or `rate_limit_exhausted`, listed package count, retained package count, summary count, granule count, and any malformed/unparseable `packageId` values skipped by the congress filter.
  <!-- Touches: src/utils/manifest.ts, tests/sources/govinfo.test.ts -->
- [ ] For both GovInfo modes there are exactly two valid terminal paths:
  1. **complete** — the listing reaches a page with no next page, all retained packages discovered for that query scope have finalized summary/granule artifacts, and any prior GovInfo resume checkpoint for the same query scope is cleared;
  2. **rate_limit_exhausted** — the shared Congress.gov/GovInfo budget depletes during either listing or retained-package finalization, the source exits `1`, reports `rate_limit_exhausted: true`, persists the resume checkpoint for the unfinished query scope, records any retained-but-unfinalized package IDs in that checkpoint, and the manifest references only artifacts fully written before exhaustion.
  <!-- Touches: src/sources/govinfo.ts, src/utils/manifest.ts, tests/sources/govinfo.test.ts, tests/sources/govinfo-resume.test.ts -->
- [ ] A subsequent non-`--force` GovInfo run with the same query scope resumes from the persisted checkpoint, does not re-fetch already finalized package summaries/granules, and advances to either a later checkpoint or a `complete` terminal state.
  <!-- Touches: src/sources/govinfo.ts, src/utils/manifest.ts, tests/sources/govinfo-resume.test.ts -->
- [ ] A `--force` GovInfo run discards any existing resume checkpoint for the matching query scope before starting, effectively restarting acquisition from page 1. Previously finalized artifacts are re-fetched and overwritten.
  <!-- Touches: src/sources/govinfo.ts, src/utils/manifest.ts, tests/sources/govinfo-resume.test.ts -->
- [ ] **Bulk historical contract:** `fetch --all` without `--congress` includes GovInfo acquisition in the same unfiltered PLAW mode as `fetch --source=govinfo`; `fetch --all --congress=<n>` includes GovInfo acquisition in the same congress-filtered mode as `fetch --source=govinfo --congress=<n>`.
  <!-- Touches: src/index.ts, src/sources/govinfo.ts, tests/cli/fetch.test.ts -->

### 6) VoteView acquisition and indexing
- [ ] A new typed client module `src/sources/voteview.ts` downloads exactly these three files and no others: `HSall_members.csv`, `HSall_votes.csv`, and `HSall_rollcalls.csv`.
  <!-- Touches: src/sources/voteview.ts, tests/sources/voteview.test.ts -->
- [ ] `fetch --source=voteview` caches those files under `data/cache/voteview/` and records file path, byte count, checksum, and fetch timestamp in the manifest.
  <!-- Touches: src/sources/voteview.ts, src/utils/manifest.ts, tests/sources/voteview.test.ts -->
- [ ] The VoteView client exposes typed lookup surfaces that support lookup by congress and by member identifier without requiring a full rescan of the raw CSV file set for each lookup.
  <!-- Touches: src/sources/voteview.ts, tests/sources/voteview-index.test.ts -->
- [ ] Compliance with the indexing requirement is mechanically proven by either: (a) persisted index artifacts whose paths/timestamps are recorded in the manifest, or (b) fixture-backed unit tests that show repeated congress/member lookups reuse pre-built in-memory indexes rather than re-parsing raw files.
  <!-- Touches: src/sources/voteview.ts, tests/sources/voteview-index.test.ts -->

### 7) UnitedStates legislators acquisition and cross-reference
- [ ] A new typed client module `src/sources/unitedstates.ts` downloads exactly these three files and no others: `legislators-current.yaml`, `legislators-historical.yaml`, and `committees-current.yaml`.
  <!-- Touches: src/sources/unitedstates.ts, tests/sources/unitedstates.test.ts -->
- [ ] `fetch --source=legislators` caches those files under `data/cache/legislators/` and records file path, byte count, checksum, and fetch timestamp in the manifest.
  <!-- Touches: src/sources/unitedstates.ts, src/utils/manifest.ts, tests/sources/unitedstates.test.ts -->
- [ ] The legislators client exposes typed parse results for current legislators, historical legislators, and current committees.
  <!-- Touches: src/sources/unitedstates.ts, tests/sources/unitedstates.test.ts -->
- [ ] When cached Congress member data exists, legislators acquisition performs a deterministic bioguide cross-reference against cached Congress member identifiers, writes `data/cache/legislators/bioguide-crosswalk.json`, and records `matched_bioguide_ids`, `unmatched_legislator_bioguide_ids`, and `unmatched_congress_bioguide_ids` counts in the manifest.
  <!-- Touches: src/sources/unitedstates.ts, src/utils/manifest.ts, tests/sources/unitedstates-crosswalk.test.ts -->
- [ ] When cached Congress member data does not exist, legislators acquisition still succeeds, writes no crosswalk file, and records `cross_reference_status: "skipped_missing_congress_cache"` in the manifest.
  <!-- Touches: src/sources/unitedstates.ts, tests/sources/unitedstates-crosswalk.test.ts -->

### 8) Aggregate `fetch --all`, status, and repo hygiene
- [ ] `fetch --all` is a valid command for the issue’s promised “download everything” behavior and returns one top-level JSON result object per source in deterministic source order: `olrc`, `congress`, `govinfo`, `voteview`, `legislators`.
  <!-- Touches: src/index.ts, tests/cli/fetch.test.ts -->
- [ ] `fetch --all` without `--congress` performs the bulk historical scope defined above: OLRC all titles, Congress.gov congress range `93..getCurrentCongress()`, GovInfo unfiltered PLAW walk, VoteView all three CSVs, and legislators all three YAML files.
  <!-- Touches: src/index.ts, tests/cli/fetch.test.ts -->
- [ ] `fetch --all --congress=<n>` narrows only the congress-scoped sources: Congress.gov to congress `<n>` and GovInfo to the congress-filtered PLAW mode for `<n>`; OLRC, VoteView, and legislators keep their normal full-source behavior.
  <!-- Touches: src/index.ts, tests/cli/fetch.test.ts -->
- [ ] In `fetch --all`, each source (`olrc`, `congress`, `govinfo`, `voteview`, `legislators`) is fail-open with respect to the remaining sources: if any one source returns a source-scoped failure result, the command still attempts every later source in deterministic order, emits one top-level JSON result object for every source whether successful or failed, and exits `1` iff one or more source results are failures.
  <!-- Touches: src/index.ts, tests/cli/fetch.test.ts -->
- [ ] Source-scoped `fetch --all` failures for OLRC, Congress.gov, GovInfo, VoteView, and legislators must preserve the same per-source artifact/manifest safety rules that apply to their standalone commands; later sources are not marked `skipped` solely because an earlier source failed.
  <!-- Touches: src/index.ts, src/utils/manifest.ts, tests/cli/fetch.test.ts -->
- [ ] `fetch --status` prints a single JSON object to stdout describing manifest state for all five sources, including last-success timestamps and the most recent recorded failure (if any) per source.
  <!-- Touches: src/index.ts, src/utils/manifest.ts, tests/cli/fetch-status.test.ts -->
- [ ] `.gitignore` excludes `data/` so fetched raw artifacts and manifest state are not committed.
  <!-- Touches: .gitignore, tests/repo/gitignore.test.ts -->
- [ ] Default `npm test` passes without live-network dependencies; live source tests are opt-in via an explicit env flag.
  <!-- Touches: package.json, vitest.config.ts, tests/**/* -->

## Out of Scope
- Transforming raw source data into markdown/content files
- Writing to the `us-code` repository or performing git/PR sync operations
- Scheduled sync orchestration beyond the `fetch` acquisition command
- Automatic secret retrieval from Bitwarden
- Any non-listed data source or any upstream endpoint not enumerated in this spec

## Dependencies
- Node.js 22+ native `fetch`
- Existing `src/index.ts` CLI entry point
- Existing OLRC/XML transformer work from earlier issues for downstream consumption only
- `API_DATA_GOV_KEY` for live Congress.gov and GovInfo tests
- A YAML parser dependency for the legislators source if not already present

## Acceptance Tests (human-readable)
1. In a clean checkout, run `npx us-code-tools fetch --status`. Verify stdout is one JSON object covering all five sources and that no cache files are created.
2. Run `npx us-code-tools fetch --status --force`. Verify exit code `2`, stderr JSON contains `error.code="invalid_arguments"`, and neither cache nor manifest changes.
3. Run `npx us-code-tools fetch --source=olrc` against fixtures that expose 54 title ZIP links. Verify 54 ZIPs plus extracted XML trees exist under `data/cache/olrc/` and the manifest has one success entry per title.
4. Run `npx us-code-tools fetch --source=congress --congress=119` with `API_DATA_GOV_KEY` unset. Verify exit code `1`, `error.code="missing_api_data_gov_key"`, zero outbound requests, and no Congress success manifest entry.
5. Run `npx us-code-tools fetch --source=congress --congress=119` with fixture responses spanning multiple bill pages, committee pages, member pages, and member details. Verify every listed bill also has cached detail/actions/cosponsors artifacts, a global Congress member snapshot is written once, and a second non-`--force` run for a different congress reuses that fresh member snapshot without issuing new `GET /member` or `GET /member/{bioguideId}` requests.
6. Seed a Congress bulk-history checkpoint showing congresses `93..117` complete and congress `118` mid-flight, then run bare `npx us-code-tools fetch --all` without `--force`. Verify it resumes at congress `118` from the recorded page/entity state instead of restarting at `93`, preserves already completed congresses, and advances the checkpoint or completes it.
7. Re-run the same bulk Congress scenario with `npx us-code-tools fetch --all --force`. Verify it ignores the saved Congress checkpoint, restarts the historical sweep from congress `93`, and replaces the prior checkpoint state with the new run’s progress.
8. Run `npx us-code-tools fetch --source=govinfo` with fixtures and a rate-limit budget large enough to complete. Verify the unfiltered PLAW listing reaches a page with no next page, all retained package summaries/granules are cached, the manifest records `termination="complete"`, and any prior resume checkpoint for the same query scope is absent.
9. Run `npx us-code-tools fetch --source=govinfo` with fixtures/budget that exhaust the shared limiter during retained-package finalization. Verify exit code `1`, summary contains `rate_limit_exhausted: true`, `next_request_at`, and the manifest references only artifacts fully written before exhaustion while persisting the next-listing checkpoint and unfinished retained package IDs.
10. Re-run the same `npx us-code-tools fetch --source=govinfo` command without `--force` against fixtures that allow completion. Verify it resumes from the saved checkpoint instead of requesting page 1 again, skips already finalized package summaries/granules, and clears the checkpoint on completion.
11. Run `npx us-code-tools fetch --source=govinfo --congress=118` with a mixed fixture listing containing `packageId` values for multiple congresses plus malformed values. Verify only package IDs whose digits immediately after `PLAW-` equal `118` are retained and malformed IDs are reported as skipped.
12. Run `npx us-code-tools fetch --source=voteview`. Verify exactly three CSV files are cached. Then run the VoteView index tests and verify repeated congress/member lookups do not require reparsing the raw CSV fixtures each time.
13. Run `npx us-code-tools fetch --source=legislators` without cached Congress member data. Verify the YAML files are cached and the manifest records `cross_reference_status: "skipped_missing_congress_cache"`.
14. Populate Congress member cache, then re-run `npx us-code-tools fetch --source=legislators`. Verify `data/cache/legislators/bioguide-crosswalk.json` is written and manifest crosswalk counts match fixture expectations.
15. Run `npx us-code-tools fetch --all` with `CURRENT_CONGRESS_OVERRIDE=119`. Verify source order is `olrc`, `congress`, `govinfo`, `voteview`, `legislators`; Congress.gov covers congresses `93..119`; the global Congress member snapshot runs at most once for the whole command; GovInfo runs in unfiltered mode; and the JSON summary publishes `bulk_scope.congress.start=93` and `bulk_scope.congress.current=119`.
16. Run `npx us-code-tools fetch --all --congress=118` with a fixture setup that forces OLRC failure while the other four sources can succeed. Verify the command still invokes `congress`, `govinfo`, `voteview`, and `legislators` in order; stdout includes five top-level source result objects; OLRC is reported as failed; later sources are not reported as skipped solely because OLRC failed; and the overall exit code is `1`.
17. Run `npx us-code-tools fetch --all --congress=118` with a fixture setup that forces a late-source failure (for example `legislators`) after earlier sources succeed. Verify the command still emits five source result objects, preserves the earlier successful artifacts/manifest entries, reports the late source as failed, and exits `1`.
18. Start two concurrent fetches targeting the same source/cache path using fixtures. Verify the final manifest remains valid JSON and references only complete artifacts; if one command loses, it fails with the deterministic conflict/runtime error rather than corrupting state.
19. Run `npm test` in default mode. Verify the suite passes without live-network access. Enable the live-test env flag and verify one real call per source is exercised, gated so CI can skip it.

## Edge Case Catalog
- Invalid CLI combinations, unknown sources, malformed congress values, empty strings, and numbers outside `Number.isSafeInteger`
- Missing/empty `API_DATA_GOV_KEY`, rejected credentials (`401`/`403`), and `Retry-After` handling
- Shared-rate-budget exhaustion during Congress.gov/GovInfo bulk runs, including checkpoint persistence and later resume
- Truncated/partial ZIP, XML, JSON, CSV, or YAML payloads; content-type mismatches; BOM markers; invalid UTF-8
- Upstream pagination anomalies: duplicate next-page URLs, empty middle pages, missing terminal marker, duplicated bill/member/package IDs, and resume cursors pointing at already-finalized GovInfo pages/packages
- Missing `bioguideId` values, malformed GovInfo `packageId` values, partial bill artifact sets, stale-vs-fresh Congress member snapshots, and empty granule collections
- Concurrent writers against the same cache path or manifest
- Interrupted writes, cache-directory creation failures, and manifest corruption recovery
- Large OLRC/VoteView artifacts, streaming/heap pressure, and checksum mismatches

## Verification Strategy
- **Pure core:** CLI argument validation, cache-key derivation, congress-range expansion for bulk mode, `getCurrentCongress()` resolution/fallback policy, GovInfo `packageId` congress parsing, GovInfo resume-state transitions, Congress bulk-progress state transitions, manifest merge/update logic, TTL freshness checks, global-member-snapshot freshness checks, retry scheduling decisions, and rate-budget arithmetic.
- **Properties:** deterministic cache paths from the same request identity; no network on fresh cache hit without `--force`; manifest success entries only reference complete artifacts; Congress/GovInfo limiter never schedules above configured capacity; GovInfo congress filtering is a pure function of `packageId`; non-`--force` GovInfo resume never restarts from page 1 when a valid checkpoint exists; non-`--force` Congress bulk resume never restarts from congress `93` when a valid checkpoint exists; repeated VoteView index lookups do not require reparsing the raw files; repeated Congress per-congress fetches reuse a fresh global member snapshot rather than duplicating global member downloads.
- **Purity boundary:** filesystem, environment variables, clocks, HTTP calls, ZIP extraction, and YAML/CSV/XML parsing adapters remain thin effectful shells around pure planning/state logic.

## Infrastructure Requirements
- **Database:** none
- **API endpoints:** no new internal HTTP endpoints
- **Infrastructure:** local filesystem storage under `data/cache/` plus `data/manifest.json`
- **Environment variables / secrets:** `API_DATA_GOV_KEY` for Congress.gov/GovInfo; `CURRENT_CONGRESS_OVERRIDE` for tests/dev override of `getCurrentCongress()`; one explicit live-test opt-in env flag for networked integration tests

## Complexity Estimate
XL — umbrella epic requiring decomposition into the child slices listed above.

## Required Skills
TypeScript, Node.js filesystem/streams, native `fetch`, rate limiting, retry/backoff, JSON/XML/YAML/CSV parsing, ZIP extraction, Vitest, fixture-driven integration testing.
