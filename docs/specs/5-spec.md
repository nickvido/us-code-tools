# Data Acquisition — API Clients & Initial Source Download

## Summary
Add a new `fetch` CLI workflow that downloads, caches, and reports on source data needed for downstream US Code ingestion. The implementation must extend the current Node/TypeScript CLI in `src/index.ts`, preserve the existing OLRC title-download capability, and add typed source clients for OLRC, Congress.gov, GovInfo, VoteView, and the `unitedstates/congress-legislators` dataset. The feature is complete when the repository can fetch each source independently, persist raw artifacts under `data/cache/`, track state in `data/manifest.json`, and expose enough typed client behavior for later backfill and sync stages to consume without reimplementing HTTP, retry, caching, or rate-limit logic.

## Context
- The repository currently contains:
  - a CLI entry point at `src/index.ts`
  - an OLRC downloader at `src/sources/olrc.ts`
  - transform/backfill code from earlier issues
  - no shared cache/rate-limit/logging abstraction for all external data sources
  - no `fetch` command and no manifest-driven acquisition status reporting
- Downstream issues depend on stable, repeatable access to raw source data before they can implement title backfill, public law ingestion, member profiles, and vote history.
- This spec must match the existing repo structure rather than the aspirational `scripts/src/...` layout shown in `SPEC.md`; new work should land under the current top-level `src/`, `tests/`, and `docs/` directories unless later architecture changes explicitly move it.
- Congress.gov and GovInfo share the same `api.data.gov` credential and therefore must share a coordinated request budget.
- Cached data must be excluded from Git.

## Acceptance Criteria

### 1. CLI surface and argument validation
- [ ] `src/index.ts` accepts a new `fetch` command with these valid modes and exits `0` on success:
  - `npx us-code-tools fetch --all --congress=<integer>`
  - `npx us-code-tools fetch --all --congress=<integer> --force`
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
  - `npx us-code-tools fetch --status`
  <!-- Touches: src/index.ts, tests/unit/fetch-cli-args.test.ts, tests/integration/fetch-cli.test.ts -->
- [ ] `fetch` returns exit code `1` and prints a deterministic usage error when:
  - both `--all` and `--source` are present
  - `--status` is combined with `--all`, `--source`, `--congress`, or `--force`
  - `--all` is missing `--congress`
  - `--source=congress` is missing `--congress`
  - `--source` is not one of `olrc|congress|govinfo|voteview|legislators`
  - `--congress` is supplied for `--source=olrc`, `--source=voteview`, or `--source=legislators`
  - `--congress` is not an integer greater than or equal to `1`
  <!-- Touches: src/index.ts, tests/unit/fetch-cli-args.test.ts -->
- [ ] `fetch --status` prints a single JSON object to stdout whose top-level keys are `generated_at`, `manifest_path`, and `sources`; `sources` contains exactly the keys `olrc`, `congress`, `govinfo`, `voteview`, and `legislators`.
  <!-- Touches: src/index.ts, src/fetch/status.ts or equivalent new module, tests/integration/fetch-status.test.ts -->

### 2. Shared acquisition infrastructure
- [ ] A shared source-client foundation exists under `src/` for HTTP fetches and disk-backed acquisition concerns, and exposes typed APIs without `any` in source files added for this issue.
  <!-- Touches: src/sources/base-client.ts or equivalent, src/utils/*.ts, tests/unit/sources/base-client.test.ts -->
- [ ] The shared HTTP layer retries transient failures for network errors and HTTP `429`, `502`, `503`, and `504`, with bounded exponential backoff and a maximum retry count configurable per source client.
  <!-- Touches: src/sources/base-client.ts or equivalent, tests/unit/sources/retry.test.ts -->
- [ ] When a response includes a valid `Retry-After` header, retry scheduling uses that delay instead of the computed exponential backoff delay.
  <!-- Touches: src/sources/base-client.ts or equivalent, tests/unit/sources/retry.test.ts -->
- [ ] Structured logs are emitted for every network request attempt and include, at minimum, `source`, `operation`, `url`, `attempt`, `status` (or transport error code), `cache_hit`, and `duration_ms`.
  <!-- Touches: src/utils/logger.ts or equivalent, all fetch clients, tests/unit/utils/logger.test.ts -->

### 3. Shared rate limiting and shared API-key budget
- [ ] Congress.gov and GovInfo requests are routed through a single shared rate-limiter instance/configuration so that test code can verify both clients decrement the same budget.
  <!-- Touches: src/utils/rate-limit.ts or equivalent, src/sources/congress.ts, src/sources/govinfo.ts, tests/unit/utils/rate-limit.test.ts -->
- [ ] The shared limiter can be configured to a ceiling of `5000` requests per hour and refuses to schedule more requests within the same window than the configured budget allows.
  <!-- Touches: src/utils/rate-limit.ts or equivalent, tests/unit/utils/rate-limit.test.ts -->
- [ ] Rate-limit state changes are observable in logs or returned diagnostics and include the source operation, remaining tokens/slots after reservation, and next-available time when a caller must wait.
  <!-- Touches: src/utils/rate-limit.ts or equivalent, src/utils/logger.ts, tests/unit/utils/rate-limit.test.ts -->

### 4. Cache and manifest behavior
- [ ] Raw artifacts are stored under `data/cache/{source}/` where `{source}` is exactly one of `olrc`, `congress`, `govinfo`, `voteview`, or `legislators`.
  <!-- Touches: src/utils/cache.ts or equivalent, all source clients, tests/unit/utils/cache.test.ts -->
- [ ] Cached API responses for Congress.gov and GovInfo persist both response body and metadata required to determine cache freshness, and support TTL-based reuse and `--force` bypass.
  <!-- Touches: src/utils/cache.ts or equivalent, src/sources/congress.ts, src/sources/govinfo.ts, tests/unit/utils/cache.test.ts -->
- [ ] Downloaded file artifacts for OLRC, VoteView, and legislators are treated as permanent cache entries until `--force` is supplied, at which point the artifact is re-downloaded and the manifest timestamps are updated.
  <!-- Touches: src/utils/cache.ts or equivalent, src/sources/olrc.ts, src/sources/voteview.ts, src/sources/unitedstates.ts, tests/unit/utils/cache.test.ts -->
- [ ] `data/manifest.json` is created on first successful `fetch` run and records, for each source, the last successful fetch timestamp, the fetch mode (`all` or source name), and source-specific artifact metadata sufficient for `fetch --status` to report what is cached.
  <!-- Touches: src/utils/manifest.ts or equivalent, src/index.ts, tests/unit/utils/manifest.test.ts, tests/integration/fetch-status.test.ts -->
- [ ] If a fetch run partially succeeds and then fails, `data/manifest.json` records only artifacts that were fully written and verified before the failure.
  <!-- Touches: src/utils/cache.ts or equivalent, src/utils/manifest.ts or equivalent, tests/unit/utils/manifest.test.ts -->
- [ ] When two `fetch` processes target the same source/cache path concurrently, the final on-disk state is limited to these observable outcomes: (a) one or both runs succeed and leave a parseable `data/manifest.json` plus fully written cache artifacts for every manifest entry they mark successful, or (b) one run fails with a deterministic write-conflict/runtime error while leaving any previously completed manifest entries and cache artifacts parseable and uncorrupted. Test coverage must exercise at least one concurrent-write scenario against the shared cache/manifest layer.
  <!-- Touches: src/utils/cache.ts or equivalent, src/utils/manifest.ts or equivalent, tests/integration/fetch-concurrency.test.ts or tests/unit/utils/concurrency.test.ts -->

### 5. OLRC source client
- [ ] `src/sources/olrc.ts` continues to support the existing title ZIP download path and additionally exposes a typed bulk-download API that can download all title numbers `1` through `54` and return per-title results.
  <!-- Touches: src/sources/olrc.ts, tests/unit/sources/olrc.test.ts, tests/integration/fetch-cli.test.ts -->
- [ ] OLRC bulk fetch stores each ZIP and its extracted XML files under `data/cache/olrc/title-XX/`, where `XX` is zero-padded to two digits, and records extraction success in the manifest.
  <!-- Touches: src/sources/olrc.ts, tests/unit/sources/olrc.test.ts -->
- [ ] During ZIP extraction, XML entry paths are validated to reject directory traversal, duplicate normalized destinations, non-regular entries, and oversized XML payloads; a failed title extraction does not mark that title successful in the manifest.
  <!-- Touches: src/sources/olrc.ts, tests/unit/sources/olrc.test.ts -->
- [ ] `fetch --source=olrc` attempts all 54 titles in one invocation and exits non-zero if one or more titles fail; the stdout JSON summary includes `requested_titles`, `succeeded_titles`, `failed_titles`, and a `results` array with one object per title.
  <!-- Touches: src/index.ts, src/sources/olrc.ts, tests/integration/fetch-cli.test.ts -->

- [ ] If `fetch --source=congress --congress=<n>` or `fetch --source=govinfo` / `fetch --source=govinfo --congress=<n>` is invoked without a configured `api.data.gov` key, the command exits `1`, prints a deterministic runtime error, performs no outbound HTTP request for that source, and does not write a success entry for that source into the manifest.
  <!-- Touches: src/index.ts, src/sources/congress.ts, src/sources/govinfo.ts, tests/unit/fetch-auth-config.test.ts, tests/integration/fetch-cli.test.ts -->
- [ ] If Congress.gov or GovInfo responds with authentication/authorization failure for the configured key (HTTP `401` or `403`), the individual source fetch exits `1`, reports a deterministic source failure code in its JSON summary, and leaves previously fresh cache entries intact.
  <!-- Touches: src/index.ts, src/sources/congress.ts, src/sources/govinfo.ts, tests/unit/sources/congress.test.ts, tests/unit/sources/govinfo.test.ts, tests/integration/fetch-cli.test.ts -->
- [ ] During `fetch --all --congress=<n>`, missing credentials or upstream `401`/`403` failures for Congress.gov or GovInfo are recorded as per-source failures in the final JSON summary while the remaining requested sources still run.
  <!-- Touches: src/index.ts, src/utils/manifest.ts or equivalent, tests/integration/fetch-cli.test.ts -->

### 6. Congress.gov source client
- [ ] A new typed client module `src/sources/congress.ts` implements methods for:
  - listing bills for a congress
  - fetching bill detail
  - fetching bill actions
  - fetching bill cosponsors
  - listing members
  - fetching member detail
  - listing committees for a congress
  <!-- Touches: src/sources/congress.ts, tests/unit/sources/congress.test.ts, tests/fixtures/congress/* -->
- [ ] The bill-list method exposes deterministic pagination inputs and outputs so tests can request the first page, a follow-up page, and termination when the API returns no further pages.
  <!-- Touches: src/sources/congress.ts, tests/unit/sources/congress.test.ts -->
- [ ] `fetch --source=congress --congress=<n>` writes raw responses under `data/cache/congress/` for:
  - every paginated bill-list response returned by `GET /bill/{n}` until the API indicates there is no next page
  - for every enumerated bill returned by those bill-list pages, one cached response each for `GET /bill/{n}/{type}/{number}`, `GET /bill/{n}/{type}/{number}/actions`, and `GET /bill/{n}/{type}/{number}/cosponsors`, unless a fresh cache entry already satisfies that exact request
  - every paginated committee-list response returned by `GET /committee/{n}` until the API indicates there is no next page
  - every paginated `GET /member` response required to enumerate the full member collection exposed by Congress.gov, continuing until the API indicates there is no next page; this member acquisition is global rather than congress-filtered because the endpoint itself is not scoped by congress
  - for every enumerated member record whose listing payload contains a non-empty `bioguideId`, one cached response for `GET /member/{bioguideId}`, unless a fresh cache entry already satisfies that exact request
  and the manifest records the requested congress number plus the page counts fetched for bills, bill details, bill actions, bill cosponsors, committees, member list pages, and member detail records.
  <!-- Touches: src/index.ts, src/sources/congress.ts, src/utils/manifest.ts, tests/integration/fetch-cli.test.ts -->
- [ ] If any enumerated Congress.gov bill fails to fetch one or more of its required detail/actions/cosponsors artifacts after the configured retries are exhausted, the congress source result exits non-zero, the JSON summary includes that bill identifier in a deterministic failure list, and the manifest records success only for the bill artifacts that were fully written.
  <!-- Touches: src/index.ts, src/sources/congress.ts, src/utils/manifest.ts, tests/unit/sources/congress.test.ts, tests/integration/fetch-cli.test.ts -->
- [ ] If any enumerated Congress.gov member with a non-empty `bioguideId` fails to fetch its required `GET /member/{bioguideId}` artifact after the configured retries are exhausted, the congress source result exits non-zero, the JSON summary includes that `bioguideId` in a deterministic failed-member list, and the manifest records success only for the member-detail artifacts that were fully written.
  <!-- Touches: src/index.ts, src/sources/congress.ts, src/utils/manifest.ts, tests/unit/sources/congress.test.ts, tests/integration/fetch-cli.test.ts -->
- [ ] Integration tests for Congress.gov are skipped unless the configured env var for live external tests is set; when enabled, at least one live request to Congress.gov bill listing succeeds with the configured API key.
  <!-- Touches: tests/integration/congress-live.test.ts or equivalent -->

### 7. GovInfo source client
- [ ] A new typed client module `src/sources/govinfo.ts` implements methods for:
  - listing the `PLAW` collection for a congress/date range query used by this repository
  - fetching package summary by `packageId`
  - fetching package granules by `packageId`
  <!-- Touches: src/sources/govinfo.ts, tests/unit/sources/govinfo.test.ts, tests/fixtures/govinfo/* -->
- [ ] `fetch --source=govinfo` enumerates public-law package IDs using this exact default acquisition query contract:
  - collection: `PLAW`
  - no congress filter is applied
  - the client pages through the collection in the upstream API's natural pagination order until there is no next page
  - every returned package ID from that full unfiltered listing is then fetched for summary and granules
  The command stores the raw collection/listing responses and package-level responses in `data/cache/govinfo/`, and the manifest records `query_scope: "all_plaw"`, the exact request parameters used for the listing calls, and the final package count.
  <!-- Touches: src/index.ts, src/sources/govinfo.ts, src/utils/manifest.ts, tests/integration/fetch-cli.test.ts -->
- [ ] `fetch --source=govinfo --congress=<n>` applies a congress filter to the same GovInfo acquisition flow: it pages through `PLAW` collection results until there is no next page, derives each package's congress from the collection item's `packageId` field by parsing the contiguous decimal digits immediately after the `PLAW-` prefix and before the first non-digit character, retains only packages whose parsed congress equals `<n>`, fetches summary and granules for each retained package, stores the filtered raw responses in `data/cache/govinfo/`, and records `query_scope: "congress"`, the requested congress number, the exact request parameters used for the listing calls, and the final package count in the manifest.
  <!-- Touches: src/index.ts, src/sources/govinfo.ts, src/utils/manifest.ts, tests/integration/fetch-cli.test.ts, tests/unit/sources/govinfo.test.ts -->
- [ ] GovInfo congress filtering includes fixture-driven test coverage for a mixed `PLAW` collection page where package IDs from multiple congresses are present; only items whose `packageId` parses to the requested congress are retained, and malformed or congress-unparseable `packageId` values are excluded from the retained package set and surfaced in diagnostics.
  <!-- Touches: src/sources/govinfo.ts, tests/unit/sources/govinfo.test.ts, tests/fixtures/govinfo/* -->
- [ ] If GovInfo returns package summaries but granules are absent or empty for a package, the package is still recorded as fetched with `granule_count: 0` rather than causing the entire congress fetch to fail.
  <!-- Touches: src/sources/govinfo.ts, tests/unit/sources/govinfo.test.ts -->
- [ ] Integration tests for GovInfo are skipped unless the configured live-test env var is set; when enabled, at least one live `PLAW` collection request succeeds with the configured API key.
  <!-- Touches: tests/integration/govinfo-live.test.ts or equivalent -->

### 8. VoteView source client
- [ ] A new typed client module `src/sources/voteview.ts` downloads exactly these three files: `HSall_members.csv`, `HSall_votes.csv`, and `HSall_rollcalls.csv`.
  <!-- Touches: src/sources/voteview.ts, tests/unit/sources/voteview.test.ts -->
- [ ] The client exposes parsing entry points that can read each CSV into typed records without loading duplicate file content into memory more than once per parse operation.
  <!-- Touches: src/sources/voteview.ts, tests/unit/sources/voteview.test.ts -->
- [ ] The client exposes a typed indexing surface that, after parsing the downloaded VoteView files, can answer at minimum these deterministic lookups without rescanning the raw CSV files:
  - list member records for a requested congress number
  - return the member record for a requested member identifier used by the dataset
  - list roll-call/vote records for a requested congress number
  - list roll-call/vote records for a requested member identifier
  The implementation may satisfy this via in-memory indexes, persisted index artifacts, or both, but the public contract must make the above lookups mechanically testable.
  <!-- Touches: src/sources/voteview.ts, tests/unit/sources/voteview.test.ts -->
- [ ] `fetch --source=voteview` stores the three CSV files under `data/cache/voteview/` and records byte size and checksum per file in the manifest.
  <!-- Touches: src/index.ts, src/sources/voteview.ts, src/utils/manifest.ts, tests/integration/fetch-cli.test.ts -->
- [ ] If the implementation persists VoteView index artifacts to disk, they are stored under `data/cache/voteview/` and the manifest records their paths and generation timestamp; if the implementation keeps indexes in memory only, the unit test suite must still verify the typed lookup contract above against fixture data.
  <!-- Touches: src/sources/voteview.ts, src/utils/manifest.ts, tests/unit/sources/voteview.test.ts -->
- [ ] A live integration test is skippable in CI and, when enabled, verifies that at least one VoteView CSV can be downloaded, its header row parsed into the expected typed field set, and at least one congress or member lookup can be served from the index surface.
  <!-- Touches: tests/integration/voteview-live.test.ts or equivalent -->

### 9. UnitedStates legislators source client
- [ ] A new typed client module `src/sources/unitedstates.ts` downloads exactly these files from the `unitedstates/congress-legislators` dataset: `legislators-current.yaml`, `legislators-historical.yaml`, and `committees-current.yaml`.
  <!-- Touches: src/sources/unitedstates.ts, tests/unit/sources/unitedstates.test.ts -->
- [ ] The client exposes typed parse results for current legislators, historical legislators, and current committees, and preserves Congress bioguide identifiers when present.
  <!-- Touches: src/sources/unitedstates.ts, tests/unit/sources/unitedstates.test.ts -->
- [ ] The client also exposes a typed bioguide cross-reference routine that compares parsed legislators records against Congress.gov member identifiers derived from cached `GET /member` list and/or `GET /member/{bioguideId}` detail artifacts, and returns a deterministic summary containing at minimum: `matched_bioguide_ids`, `unmatched_legislator_bioguide_ids`, and `unmatched_congress_bioguide_ids`.
  <!-- Touches: src/sources/unitedstates.ts, src/sources/congress.ts, tests/unit/sources/unitedstates.test.ts -->
- [ ] `fetch --source=legislators` stores the YAML source files under `data/cache/legislators/` and records per-file metadata in the manifest.
  <!-- Touches: src/index.ts, src/sources/unitedstates.ts, src/utils/manifest.ts, tests/integration/fetch-cli.test.ts -->
- [ ] When fresh Congress.gov member cache data is available from the same run or an existing cache, legislators acquisition writes a deterministic cross-reference artifact at `data/cache/legislators/bioguide-crosswalk.json` and records its path plus matched/unmatched counts in the manifest; when Congress member cache data is unavailable, the source summary and manifest record `cross_reference_status: "skipped_missing_congress_cache"` instead of failing the legislators fetch.
  <!-- Touches: src/index.ts, src/sources/unitedstates.ts, src/utils/manifest.ts, tests/integration/fetch-cli.test.ts -->
- [ ] A live integration test is skippable in CI and, when enabled, verifies that at least one legislators YAML file can be downloaded and parsed into one or more typed records; if Congress member cache fixtures or live data are available for the same run, the test also verifies that the bioguide cross-reference summary is generated.
  <!-- Touches: tests/integration/unitedstates-live.test.ts or equivalent -->

### 10. End-to-end orchestration, status, and repository hygiene
- [ ] `fetch --all --congress=<n>` invokes OLRC, Congress.gov, GovInfo, VoteView, and legislators acquisition in a deterministic order documented in code and returns a JSON summary that includes one top-level result object per source.
  <!-- Touches: src/index.ts, tests/integration/fetch-cli.test.ts -->
- [ ] In `fetch --all --congress=<n>`, the Congress.gov source uses the exact same acquisition scope as `fetch --source=congress --congress=<n>`, and the GovInfo source uses the exact same acquisition scope as `fetch --source=govinfo --congress=<n>`.
  <!-- Touches: src/index.ts, src/sources/congress.ts, src/sources/govinfo.ts, tests/integration/fetch-cli.test.ts -->
- [ ] If one source fails during `fetch --all --congress=<n>`, the command exits non-zero after attempting the remaining sources, and the JSON summary marks each source as `success` or `failure` independently.
  <!-- Touches: src/index.ts, src/utils/manifest.ts, tests/integration/fetch-cli.test.ts -->
- [ ] `.gitignore` excludes `data/` so cache artifacts and manifests created by this issue are not tracked by Git.
  <!-- Touches: .gitignore, tests/unit/repository-hygiene.test.ts -->
- [ ] `npm test` passes with the unit suite and any non-live integration tests enabled by default.
  <!-- Touches: tests/**/* -->

## Non-Functional Requirements
- [ ] Performance: cache hits for Congress.gov and GovInfo return without performing a network request when the cached entry is still fresh and `--force` is not supplied.
- [ ] Performance: VoteView and OLRC downloads write file artifacts to disk using stream or chunked-buffer handling suitable for multi-hundred-megabyte inputs; tests must verify the implementation does not require stringifying the full file payload before writing it.
- [ ] Security: API keys are read from environment or local config already used by the repo and are never written to stdout, stderr, structured logs, cache files, or `data/manifest.json`.
- [ ] Reliability: cache writes and manifest writes are atomic from the perspective of readers, using temp-file-plus-rename or equivalent semantics.

## Out of Scope
- Transforming fetched source data into markdown or into the `us-code` content model
- Git commit synthesis, PR creation, or sync scheduling
- Historical backfill semantics beyond downloading and caching the raw source data
- Schema normalization across Congress.gov, VoteView, GovInfo, and UnitedStates beyond typed parse results needed for acquisition
- Automatic secret provisioning from Bitwarden

## Dependencies
- Existing CLI entry point in `src/index.ts`
- Existing OLRC ZIP handling in `src/sources/olrc.ts`
- Node.js native `fetch` and filesystem APIs
- `api.data.gov` key for Congress.gov and GovInfo live requests
- A YAML parser dependency if the repository does not already include one

## Acceptance Tests (human-readable)
1. Run `npx us-code-tools fetch --status` in a clean checkout. Verify it exits `0`, prints JSON, and shows all five sources with empty or not-yet-fetched status.
2. Run `npx us-code-tools fetch --source=olrc`. Verify the command attempts titles 1 through 54, writes `data/cache/olrc/title-01/` through `title-54/`, and records title-level outcomes in `data/manifest.json`.
3. Run `npx us-code-tools fetch --source=congress --congress=119` with a valid API key. Verify raw bill-list and committee-list pages for congress `119` are cached under `data/cache/congress/`, verify that every enumerated bill also has cached detail/actions/cosponsors responses, verify member pages continue until the Congress.gov `GET /member` listing has no next page, verify that every enumerated member with a non-empty `bioguideId` also has a cached `GET /member/{bioguideId}` response, and verify the manifest records congress `119` plus fetched page counts for bills, bill details, bill actions, bill cosponsors, committees, member list pages, and member detail records.
4. Run `npx us-code-tools fetch --all` without `--congress`. Verify the command exits `1` with the documented usage error for a missing all-sources congress scope.
5. Run `npx us-code-tools fetch --source=govinfo` with a valid API key. Verify it walks the unfiltered `PLAW` collection until there is no next page, fetches summary and granules for each returned package, caches those responses under `data/cache/govinfo/`, and records `query_scope: "all_plaw"`, request parameters, and package count in the manifest.
6. Run `npx us-code-tools fetch --source=govinfo --congress=119` with a valid API key. Verify it walks the same `PLAW` listing flow, parses congress membership from each collection item's `packageId` by reading the decimal digits immediately after `PLAW-`, retains only packages whose parsed congress is `119`, uses the same cache root, and records `query_scope: "congress"`, congress `119`, request parameters, and package count in the manifest.
7. Run the GovInfo congress-filter unit/integration test fixture with a mixed `PLAW` collection page containing package IDs for multiple congresses plus at least one malformed `packageId`. Verify only the requested congress's package IDs are retained and malformed/unparseable IDs are excluded and surfaced in diagnostics.
8. Run `npx us-code-tools fetch --source=voteview`. Verify exactly the three required CSV files exist under `data/cache/voteview/`, their metadata appears in the manifest, and the VoteView client can satisfy at least one congress lookup and one member lookup from its typed index surface without rescanning the raw CSV fixtures.
9. Run `npx us-code-tools fetch --source=legislators`. Verify exactly the three required YAML files exist under `data/cache/legislators/` and the manifest includes them. Then run the legislators bioguide cross-reference against cached Congress member data; verify it produces a deterministic summary with matched and unmatched ID lists and, when Congress cache data is available, writes `data/cache/legislators/bioguide-crosswalk.json`.
10. Re-run one of the API-backed fetches without `--force`. Verify logs/status indicate a cache hit and no network request is made for fresh cached entries.
11. Re-run the same command with `--force`. Verify the artifact timestamps in `data/manifest.json` change.
12. Run `npx us-code-tools fetch --status --force`. Verify the command exits `1` with the documented usage error for an invalid flag combination.
13. Run `npx us-code-tools fetch --source=congress --congress=119` with the API key unset. Verify the command exits `1`, emits the documented missing-credential error, performs no outbound request, and does not write a success manifest entry for Congress.gov.
14. Run `npx us-code-tools fetch --all --congress=119` with the API key unset. Verify OLRC, VoteView, and legislators still run, while Congress.gov and GovInfo are reported as source-specific failures in the final JSON summary.
15. Run the concurrent-write cache/manifest test (or equivalent integration test) with two fetch operations targeting the same source/cache root. Verify the resulting `data/manifest.json` is valid JSON, every manifest success entry points only to fully written artifacts, and any losing writer fails deterministically rather than leaving corrupted cache state.
16. Run `npm test`. Verify all default tests pass and live tests remain skipped unless their env flag is provided.

## Edge Case Catalog
- Invalid CLI combinations: duplicate flags, unknown flags, unknown source names, missing `--congress`, non-integer congress numbers, `--congress=0`.
- Malformed external payloads: truncated ZIPs, HTML returned instead of ZIP/JSON/CSV/YAML, malformed JSON, malformed YAML, invalid UTF-8, BOM-prefixed CSV/YAML, empty files, duplicate CSV headers.
- Partial data: Congress.gov bill detail exists but actions or cosponsors endpoint returns empty; GovInfo package exists but granules endpoint returns no entries; legislators file exists but some records omit bioguide IDs; Congress member list entries exist without `bioguideId`; VoteView rows exist for a congress/member combination whose paired records are missing from another CSV.
- Delimiter edge cases: CSV rows with embedded commas, quoted newlines, trailing separators, empty fields between delimiters.
- Encoding issues: XML/CSV/YAML with BOM markers, mixed newline styles, unicode names, emoji or non-ASCII committee/member names, invalid UTF-8 bytes in downloaded files.
- Subsystem failure: cache directory cannot be created, manifest file is corrupt JSON, filesystem rename fails, DNS failure, TLS failure, network timeout, 429 throttling, 5xx upstream failures.
- Partial failure during `fetch --all --congress=<n>`: one source fails after others succeeded; later sources must still run and the final summary must distinguish per-source success/failure.
- Recovery: if a prior failed run left temp files behind, the next run can complete successfully and only finalized artifacts are reflected in the manifest.
- Concurrency: two fetch commands targeting the same source/cache path run simultaneously; readers must see either the pre-existing valid state or a fully finalized replacement, never a torn artifact or malformed manifest.
- Time: TTL expiry boundary conditions around exact expiry timestamps and clock skew between manifest timestamps and system time.
- Auth/config: missing API key, empty API key, wrong API key, expired/revoked key, or API key configured for only one of the shared-budget sources.
- Size boundaries: multi-hundred-megabyte VoteView files, oversized ZIP entries, and large paginated bill/member result sets.

## Verification Strategy
- **Pure core:** keep argument parsing, cache-key construction, manifest merge logic, pagination state transitions, response freshness decisions, checksum calculation, and rate-budget arithmetic in pure functions.
- **Properties:**
  - cache keys are deterministic for the same source + request inputs
  - fresh cache entries never trigger a network call unless `force=true`
  - manifest updates are monotonic for successful artifacts and never invent entries for failed writes
  - OLRC title results are always keyed to title numbers `1..54`
  - GovInfo congress filtering is deterministic for the same `packageId` inputs: parsing the digits immediately after `PLAW-` always yields the same retain/exclude decision for a requested congress
  - VoteView index lookups are deterministic for the same downloaded CSV inputs and requested congress/member keys
  - legislators bioguide cross-reference produces the same matched/unmatched sets for the same Congress cache inputs and YAML inputs
  - Congress/GovInfo shared limiter never grants more reservations than its configured hourly ceiling
- **Purity boundary:** all filesystem writes, clock reads, environment-variable reads, and HTTP requests live in thin effectful adapters invoked by orchestration code; unit tests cover pure logic and integration tests cover the adapters.

## Infrastructure Requirements
- **Database:** none
- **API endpoints:** no new internal HTTP endpoints; external endpoints are Congress.gov and GovInfo API calls plus static downloads from OLRC, VoteView, and GitHub/raw content for legislators
- **Infrastructure:** local disk storage under `data/cache/` and `data/manifest.json`
- **Environment variables / secrets:**
  - one env var for the `api.data.gov` key used by Congress.gov and GovInfo
  - one env var gate for optional live integration tests
  - optional per-source TTL/rate-limit config vars only if implementation chooses config over constants

## Complexity Estimate
XL

## Decomposition Notes
This issue touches CLI parsing, shared acquisition infrastructure, five source clients, manifest/reporting, and test coverage across multiple external formats. It should be decomposed at least into:
1. shared fetch/cache/rate-limit/logging infrastructure
2. OLRC bulk acquisition
3. Congress.gov + GovInfo clients and shared API-key budget wiring
4. VoteView + legislators static-source acquisition
5. CLI/status integration and repository hygiene/tests

## Required Skills
- TypeScript
- Node.js filesystem and streams
- HTTP client design
- API pagination and rate limiting
- ZIP/CSV/YAML parsing
- Vitest
