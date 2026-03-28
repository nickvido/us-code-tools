# Issue #5 Spec — Data Acquisition — API Clients & Initial Source Download

## Summary
This issue is an **umbrella epic** for the raw-data acquisition layer used by downstream title backfill, public-law ingestion, bill tracking, member profiles, and vote-record features. It defines the canonical acquisition contract for five upstream sources — OLRC, Congress.gov, GovInfo, VoteView, and `unitedstates/congress-legislators` — plus the shared cache, manifest, retry, rate-limit, logging, and CLI behavior required to fetch and inspect those artifacts.

This parent issue is intentionally **not implementation-ready as one atomic change**. Delivery must be decomposed into the child slices listed in [Delivery Model](#delivery-model). The purpose of this spec is to give those child slices a single mechanically testable contract.

## Context
- The repository already defines the project at a high level in `README.md` and `SPEC.md`, including a `src/`, `tests/`, and CLI-oriented Node/TypeScript layout.
- The repository does **not** yet define a canonical raw acquisition contract for:
  - shared on-disk cache semantics
  - shared manifest semantics
  - shared Congress.gov/GovInfo rate-budget behavior
  - deterministic CLI status/error reporting for source fetches
- Congress.gov and GovInfo both consume the same `api.data.gov` credential and therefore must share one coordinated request budget.
- This issue is the foundation layer only. Markdown transformation, Git history synthesis, PR automation, and long-running scheduled orchestration remain out of scope here.

## Delivery Model
This ticket is an **umbrella epic**. Review and implementation must be decomposed into the following child slices:

1. **Shared acquisition infrastructure**
   - cache
   - manifest
   - retry/backoff
   - structured logging
   - shared rate limiter
2. **OLRC acquisition**
3. **Congress.gov acquisition**
4. **GovInfo acquisition**
5. **VoteView acquisition + lookup indexing**
6. **UnitedStates legislators acquisition + bioguide cross-reference**
7. **CLI/status/concurrency/repo hygiene**

A child slice may only claim completion against the subset of acceptance criteria it explicitly implements.

## CLI Contract
`src/index.ts` must define a new `fetch` command with these valid invocations:

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
- `npx us-code-tools fetch --all --congress=<integer>`
- `npx us-code-tools fetch --all --congress=<integer> --force`

The following are invalid invocations and must exit with a deterministic usage error and no network activity:

- `npx us-code-tools fetch --all`
- `npx us-code-tools fetch --status --force`
- `npx us-code-tools fetch --source=congress`
- any invocation with both `--status` and `--source`
- any invocation with malformed `--congress` values (empty, non-integer, negative, zero)
- any invocation with `--source` outside `olrc|congress|govinfo|voteview|legislators`

## Credential Contract
The only required credential source defined by this spec for Congress.gov and GovInfo is the environment variable:

- `API_DATA_GOV_KEY`

Rules:
- `API_DATA_GOV_KEY` is the authoritative credential source for runtime and tests.
- If `API_DATA_GOV_KEY` is unset or the empty string after trimming, Congress.gov and GovInfo fetches are treated as missing-credential failures.
- This spec does **not** require support for alternate env var names, `.env` parsing rules, Bitwarden retrieval, or config-file fallbacks.
- Logs, stdout/stderr summaries, cache entries, and `data/manifest.json` must never contain the raw credential value.

## Storage Layout
All raw acquisition artifacts live under `data/`:

```text
data/
├── cache/
│   ├── olrc/
│   ├── congress/
│   ├── govinfo/
│   ├── voteview/
│   └── legislators/
└── manifest.json
```

`data/` must be ignored by Git.

## Acceptance Criteria

### 1. Shared acquisition infrastructure
- [ ] A shared typed acquisition layer exists under the repository `src/` tree and covers retry with backoff, cache reads/writes, manifest reads/writes, structured logging, and source result summaries.
  <!-- Touches: src/, tests/ -->
- [ ] All HTTP is performed through native `fetch` on Node 22+ and all exported public types in the acquisition layer are fully typed with no `any` in source-client interfaces.
  <!-- Touches: src/sources/, src/utils/ or equivalent -->
- [ ] Cache writes and manifest writes are atomic: a reader observing the filesystem after any completed write sees either the previous valid file or the new valid file, never a truncated artifact or malformed JSON.
  <!-- Touches: cache + manifest modules, tests -->
- [ ] If two fetch processes target the same source/cache path concurrently, the final filesystem state must satisfy all of the following:
  - `data/manifest.json` remains valid JSON
  - manifest success entries reference only fully written artifacts
  - a losing writer may fail, but only with a deterministic conflict/runtime error
  - no pre-existing finalized artifact is corrupted
  <!-- Touches: shared acquisition infrastructure, tests -->
- [ ] Shared structured logs are emitted for each network attempt, cache hit/miss, retry decision, and terminal source result, and no log line contains the raw `API_DATA_GOV_KEY` value.
  <!-- Touches: logging -->

### 2. Shared Congress.gov / GovInfo rate-limit behavior
- [ ] Congress.gov and GovInfo use one shared logical rate budget configurable to a ceiling of `5000` requests per rolling hour.
  <!-- Touches: shared rate limiter -->
- [ ] The shared limiter respects upstream `Retry-After` headers when present and does not schedule a new request for the affected source before the advertised retry time.
  <!-- Touches: rate limiter, HTTP wrapper -->
- [ ] Interactive fetch commands do **not** wait for the next hourly window when the shared budget is exhausted. Instead, the affected source stops with a deterministic `rate_limit_exhausted` terminal result.
  <!-- Touches: CLI + summary behavior -->
- [ ] When a source stops because the shared budget is exhausted, its JSON result object includes:
  - `status: "failed"`
  - `failure_code: "rate_limit_exhausted"`
  - `rate_limit_exhausted: true`
  - `next_rate_limit_window_at` as an ISO-8601 timestamp
  <!-- Touches: summary types -->
- [ ] When shared-budget exhaustion occurs during `fetch --all --congress=<n>`, remaining non-exhausted sources still run to completion; the overall command exits non-zero; and the final JSON summary reports exhausted sources independently from successful sources.
  <!-- Touches: CLI orchestrator -->
- [ ] After shared-budget exhaustion, the manifest may record only artifacts that were fully written before the exhaustion point.
  <!-- Touches: manifest semantics -->

### 3. OLRC acquisition
- [ ] `fetch --source=olrc` downloads all 54 USC title ZIP artifacts exposed by the current OLRC annual title files page, stores them under `data/cache/olrc/`, and extracts their XML contents into source-specific cache paths.
  <!-- Touches: src/sources/olrc.ts -->
- [ ] OLRC acquisition derives title ZIP URLs from the upstream HTML page at runtime or from a fixture with the same structure in tests; if the page omits one or more titles, the source result is failed and the summary identifies the missing title numbers.
  <!-- Touches: olrc parser/tests -->
- [ ] The OLRC manifest entry records, at minimum, the count of ZIPs downloaded, the count of titles successfully extracted, and per-title artifact paths/timestamps for fully written results.
  <!-- Touches: manifest -->

### 4. Congress.gov acquisition
- [ ] `src/sources/congress.ts` exports typed methods for:
  - `GET /bill/{congress}`
  - `GET /bill/{congress}/{type}/{number}`
  - `GET /bill/{congress}/{type}/{number}/actions`
  - `GET /bill/{congress}/{type}/{number}/cosponsors`
  - `GET /member`
  - `GET /member/{bioguideId}`
  - `GET /committee/{congress}`
  <!-- Touches: src/sources/congress.ts -->
- [ ] `fetch --source=congress --congress=<n>` fails before making any outbound HTTP request if `API_DATA_GOV_KEY` is missing or empty, exits non-zero, emits a deterministic missing-credential error/result, and writes no success manifest entry for Congress.gov.
  <!-- Touches: CLI + auth gate -->
- [ ] If Congress.gov returns `401` or `403`, the source exits non-zero with a deterministic auth failure code in its JSON result, previously fresh cache entries remain intact, and no partial success entry is written for the failed request set.
  <!-- Touches: HTTP wrapper + manifest semantics -->
- [ ] `fetch --source=congress --congress=<n>` caches every paginated `GET /bill/{n}` response until the API indicates there is no next page.
  <!-- Touches: congress client -->
- [ ] For every bill enumerated from `GET /bill/{n}`, the same fetch run must also cache that bill’s detail, actions, and cosponsors responses. If any one of those required bill artifacts cannot be obtained after retries, the source result is failed, the JSON summary includes a deterministic failed-bill list, and the manifest records only fully written bill artifacts.
  <!-- Touches: congress orchestration -->
- [ ] `fetch --source=congress --congress=<n>` caches every paginated `GET /committee/{n}` response until there is no next page.
  <!-- Touches: congress client -->
- [ ] `fetch --source=congress --congress=<n>` caches every paginated `GET /member` response until there is no next page, because the upstream member list endpoint is not congress-scoped.
  <!-- Touches: congress client -->
- [ ] For every enumerated member with a non-empty `bioguideId`, the same fetch run must cache `GET /member/{bioguideId}`. If any required member-detail artifact fails after retries, the source exits non-zero and the JSON summary reports the failed bioguide IDs.
  <!-- Touches: congress orchestration -->
- [ ] The Congress manifest entry records, at minimum, page counts for bills, committees, and members; counts of bill detail/actions/cosponsors artifacts; counts of member-detail artifacts; and paths/timestamps for fully written cache objects.
  <!-- Touches: manifest -->

### 5. GovInfo acquisition
- [ ] `src/sources/govinfo.ts` exports typed methods for:
  - `GET /collections/PLAW`
  - `GET /packages/{packageId}/summary`
  - `GET /packages/{packageId}/granules`
  <!-- Touches: src/sources/govinfo.ts -->
- [ ] `fetch --source=govinfo` fails before making any outbound HTTP request if `API_DATA_GOV_KEY` is missing or empty, exits non-zero, emits a deterministic missing-credential error/result, and writes no success manifest entry for GovInfo.
  <!-- Touches: CLI + auth gate -->
- [ ] If GovInfo returns `401` or `403`, the source exits non-zero with a deterministic auth failure code in its JSON result, previously fresh cache entries remain intact, and no partial success entry is written for the failed request set.
  <!-- Touches: HTTP wrapper + manifest semantics -->
- [ ] `fetch --source=govinfo` uses this exact default acquisition contract:
  - collection: `PLAW`
  - no congress filter
  - walk the upstream collection in natural pagination order until either:
    1. there is no next page, or
    2. the shared Congress.gov/GovInfo rate budget is exhausted
  - for each returned package ID observed before termination, fetch summary and granules unless a fresh cache entry already satisfies the request and `--force` is not set
  <!-- Touches: govinfo orchestration -->
- [ ] `fetch --source=govinfo --congress=<n>` uses the same collection walk as the default mode, but retains only collection items whose `packageId` matches congress `<n>` by this exact rule:
  - parse the contiguous decimal digits immediately following the `PLAW-` prefix
  - stop parsing at the first non-digit character
  - retain the package iff the parsed integer equals `<n>`
  - items with missing, malformed, or unparseable `packageId` values are excluded and counted separately as skipped-unparseable entries
  <!-- Touches: govinfo filter logic -->
- [ ] GovInfo full-collection and congress-filtered runs each have exactly two valid terminal success/failure paths:
  1. **Complete path:** the collection walk reaches a page with no next page, all required summary/granules fetches for retained package IDs finish successfully, and the source result is `status: "success"` with `rate_limit_exhausted: false`
  2. **Exhausted path:** the run stops when the shared rate budget is depleted before the collection walk is complete, and the source result is `status: "failed"` with `failure_code: "rate_limit_exhausted"`, `rate_limit_exhausted: true`, and `next_rate_limit_window_at`
  QA fixtures/config must be able to drive both paths deterministically.
  <!-- Touches: govinfo summary/tests -->
- [ ] The GovInfo manifest entry records, at minimum:
  - `query_scope` (`"all_plaw"` or `"congress_filtered"`)
  - exact listing parameters used
  - page count reached
  - retained package count
  - skipped-unparseable package count
  - counts of summary/granules artifacts fully written before termination
  <!-- Touches: manifest -->

### 6. VoteView acquisition + lookup indexing
- [ ] `src/sources/voteview.ts` downloads exactly these three files into `data/cache/voteview/`:
  - `HSall_members.csv`
  - `HSall_votes.csv`
  - `HSall_rollcalls.csv`
  <!-- Touches: src/sources/voteview.ts -->
- [ ] The VoteView client exposes typed parse results for each CSV and a typed lookup surface that supports lookups by congress and by member without rescanning the raw CSV files for every lookup.
  <!-- Touches: voteview client/tests -->
- [ ] If persisted index artifacts are written, their paths and timestamps are recorded in the manifest; otherwise unit tests must prove the in-memory indexed lookup behavior from fixtures.
  <!-- Touches: manifest/tests -->

### 7. UnitedStates legislators acquisition + cross-reference
- [ ] `src/sources/unitedstates.ts` acquires exactly these upstream files into `data/cache/legislators/`:
  - `legislators-current.yaml`
  - `legislators-historical.yaml`
  - `committees-current.yaml`
  <!-- Touches: src/sources/unitedstates.ts -->
- [ ] The legislators client exposes typed parse results for current legislators, historical legislators, and current committees.
  <!-- Touches: legislators parser -->
- [ ] When cached Congress member identifiers are available locally, legislators acquisition performs a typed bioguide cross-reference against the cached Congress member set and writes `data/cache/legislators/bioguide-crosswalk.json`.
  <!-- Touches: legislators cross-reference -->
- [ ] The legislators source JSON result and manifest record the deterministic cross-reference fields:
  - `matched_bioguide_ids`
  - `unmatched_legislator_bioguide_ids`
  - `unmatched_congress_bioguide_ids`
  - `cross_reference_status`
  <!-- Touches: result types + manifest -->
- [ ] If Congress member cache is unavailable, legislators acquisition still succeeds for its own source artifacts but sets `cross_reference_status: "skipped_missing_congress_cache"` and does not emit a false success claim for a missing crosswalk.
  <!-- Touches: cross-reference gating -->

### 8. Cache semantics, force refresh, and status output
- [ ] Fresh cache hits for JSON/XML/YAML/text artifacts do not perform a network request unless `--force` is supplied.
  <!-- Touches: cache layer -->
- [ ] Downloaded permanent artifacts (ZIP/CSV/YAML source files) remain reusable until `--force` is supplied; TTL applies only to cacheable API responses whose freshness policy is defined in code.
  <!-- Touches: cache policy -->
- [ ] `fetch --status` prints exactly one JSON object to stdout describing the current manifest state for all five sources and exits `0` when the manifest is readable.
  <!-- Touches: CLI -->
- [ ] If the manifest does not exist, `fetch --status` still exits `0` and returns a JSON object that reports each source as not-yet-fetched.
  <!-- Touches: CLI -->
- [ ] If the manifest exists but is malformed, `fetch --status` exits non-zero with a deterministic manifest-read error and does not overwrite the malformed file.
  <!-- Touches: CLI + manifest read -->
- [ ] `fetch --all --congress=<n>` invokes sources in a deterministic order documented in code, reuses the exact scoped behavior of `--source=congress --congress=<n>` and `--source=govinfo --congress=<n>`, and returns one top-level JSON result object per source.
  <!-- Touches: CLI orchestrator -->

### 9. Tests and repo hygiene
- [ ] Unit tests cover shared cache behavior (hit/miss/TTL/force-refresh), shared rate-limit arithmetic, GovInfo congress filtering, concurrent manifest/cache writer outcomes, and typed parsing for each source.
  <!-- Touches: tests/ -->
- [ ] Fixture-backed tests exist for:
  - mixed-congress GovInfo listings
  - malformed GovInfo `packageId` values
  - missing/empty `API_DATA_GOV_KEY`
  - `401`/`403` auth rejection for Congress.gov and GovInfo
  - concurrent writer conflict handling
  - VoteView congress/member lookup behavior
  - legislators bioguide cross-reference summaries
  <!-- Touches: tests/fixtures -->
- [ ] Integration tests may perform at least one live call per source only when an explicit live-test env flag is enabled; default `npm test` must pass without real-network dependency.
  <!-- Touches: test config -->
- [ ] `.gitignore` excludes `data/` so cached artifacts and manifest state are not committed.
  <!-- Touches: .gitignore -->

## Out of Scope
- Transforming acquired source material into markdown or frontmatter
- Applying public laws to a local US Code tree
- Writing to the `us-code` repository or creating commits/PRs
- Scheduled/resumable orchestration beyond one interactive fetch invocation
- Automatic retrieval of `API_DATA_GOV_KEY` from Bitwarden or any secret manager
- Historical policy decisions about how many Congresses to backfill after raw acquisition exists

## Dependencies
- Node.js 22+ runtime with native `fetch`
- Existing repository TypeScript/Vitest toolchain
- `API_DATA_GOV_KEY` for Congress.gov and GovInfo runtime/integration tests
- ZIP/XML/CSV/YAML parsing dependencies as required by the child slices

## Acceptance Tests (human-readable)
1. Run `npx us-code-tools fetch --status` in a clean checkout with no `data/manifest.json`. Verify exit `0` and a single JSON object reporting all five sources as not yet fetched.
2. Run `npx us-code-tools fetch --status --force`. Verify non-zero exit, deterministic usage error, and no network activity.
3. Unset `API_DATA_GOV_KEY`. Run `npx us-code-tools fetch --source=congress --congress=119` and `npx us-code-tools fetch --source=govinfo`. Verify each exits non-zero before any outbound HTTP request, returns a deterministic missing-credential result, and writes no success manifest entry for the affected source.
4. Set a valid `API_DATA_GOV_KEY`. Run `npx us-code-tools fetch --source=olrc`. Verify 54 title ZIPs are cached and extracted, and the manifest records only fully written title artifacts.
5. Run `npx us-code-tools fetch --source=congress --congress=119`. Verify the cache contains bill-list pages, bill detail/actions/cosponsors for each enumerated bill, committee-list pages, member-list pages, and member-detail responses for enumerated bioguide IDs. Verify the manifest reports the expected counts.
6. Run `npx us-code-tools fetch --source=govinfo --congress=119` against fixtures containing mixed `packageId` values such as `PLAW-119publ5`, `PLAW-118publ240`, and malformed values. Verify only the entries whose parsed digits after `PLAW-` equal `119` are retained, malformed package IDs are counted as skipped-unparseable, and the manifest records the exact filtered query scope.
7. Run `npx us-code-tools fetch --source=govinfo` with a test configuration whose shared Congress/GovInfo rate budget is high enough to complete the fixture-defined collection walk. Verify the source result is success with `rate_limit_exhausted: false` and all retained package summaries/granules are cached.
8. Run `npx us-code-tools fetch --source=govinfo` with a test configuration whose shared Congress/GovInfo rate budget is intentionally too small for the same fixture-defined collection walk. Verify the source stops early with `failure_code: "rate_limit_exhausted"`, `rate_limit_exhausted: true`, and `next_rate_limit_window_at`, and that the manifest references only artifacts fully written before exhaustion.
9. Run `npx us-code-tools fetch --source=voteview`. Verify exactly the three required CSVs are cached and the typed lookup layer supports queries by congress and member without rescanning raw CSVs per lookup.
10. Run `npx us-code-tools fetch --source=legislators` with Congress member cache available. Verify the three YAML files are cached, `bioguide-crosswalk.json` is written, and the summary includes matched/unmatched ID counts.
11. Run `npx us-code-tools fetch --all --congress=119` with a test budget that forces Congress.gov or GovInfo exhaustion mid-run. Verify the unaffected sources still finish, the overall command exits non-zero, and the final JSON summary contains one top-level result per source with exhausted sources marked independently.
12. Launch two concurrent fetches for the same source/cache target in a fixture-backed test. Verify the final manifest remains valid JSON, no finalized artifact is corrupted, and any losing writer fails only with the deterministic conflict/runtime error.
13. Run `npm test`. Verify default tests pass without live network access.

## Edge Case Catalog
- Invalid CLI flag combinations and malformed congress arguments
- Missing, empty, revoked, or rejected `API_DATA_GOV_KEY`
- Truncated ZIP/CSV/YAML/JSON payloads
- Mixed encodings, BOM markers, and invalid UTF-8 sequences in downloaded text payloads
- Missing `next` pagination links, duplicated pages, or empty final pages
- GovInfo collection items with missing or malformed `packageId`
- Congress members missing `bioguideId`
- Partial upstream data (missing actions, empty cosponsors, empty granules, sparse member metadata)
- Network failure during artifact download after a temp file is created but before an atomic rename
- Cache file present but manifest missing, or manifest present but cache file missing
- Two concurrent writers targeting the same artifact or manifest
- Shared rate-budget exhaustion during Congress.gov or GovInfo acquisition
- Recovery behavior after a prior failed or exhausted run: later successful runs must reuse still-valid completed artifacts and fill only the remaining gaps when allowed by CLI flags/code paths

## Verification Strategy
- **Pure core:**
  - CLI argument validation
  - cache-key construction
  - manifest merge/update logic
  - TTL/freshness decisions
  - GovInfo congress filter (`packageId` parser)
  - shared rate-budget arithmetic
  - VoteView lookup indexing logic
  - legislators bioguide cross-reference set math
- **Properties:**
  - fresh cache hit implies zero outbound network call unless `--force`
  - no manifest success entry may reference a partially written artifact
  - a successful GovInfo run is either a full completion path or not successful at all
  - a rate-limit-exhausted GovInfo/Congress run never claims completion of unstarted artifacts
  - Congress.gov/GovInfo combined scheduling never exceeds configured hourly capacity
  - concurrent writers cannot leave malformed manifest JSON
  - VoteView congress/member lookups do not require raw-file rescans per lookup
- **Purity boundary:**
  - HTTP, filesystem, environment access, clock access, and process exit behavior stay in thin adapters
  - parsing, filtering, indexing, budgeting, and manifest state transitions remain unit-testable pure logic

## Infrastructure Requirements
- **Database:** none
- **API endpoints:** no new internal HTTP endpoints
- **Infrastructure:** local filesystem storage under `data/cache/` and `data/manifest.json`
- **Environment variables / secrets:** `API_DATA_GOV_KEY`; optional separate env flag for enabling live integration tests

## Complexity Estimate
XL — umbrella epic only; child slices required.

## Required Skills
TypeScript, Node.js streams/filesystem, HTTP client design, rate limiting, ZIP/XML/CSV/YAML parsing, fixture-driven testing with Vitest, concurrency-safe file I/O.
