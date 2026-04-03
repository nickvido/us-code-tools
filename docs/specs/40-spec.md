## [spec-writer] — Initial spec drafted
See `docs/specs/40-spec.md` for the canonical spec.

# GovInfo bulk repository fetch source

## Summary
Add a new `fetch --source=govinfo-bulk` CLI source that reads GovInfo Bulk Data Repository XML directory listings, downloads bulk artifacts without `API_DATA_GOV_KEY`, stores them under `data/cache/govinfo-bulk/`, and records resumable progress in `data/manifest.json`. The goal is to replace slow historical GovInfo API crawling with a bulk-file acquisition path suitable for initial backfill of bill status, bill text, bill summaries, and public/private law artifacts.

## Context
- The current CLI supports `olrc`, `congress`, `govinfo`, `voteview`, and `legislators` sources via `src/commands/fetch.ts` and `src/utils/manifest.ts`.
- `fetch --source=govinfo` currently uses the GovInfo API and requires `API_DATA_GOV_KEY`; it is rate-limited and only fetches PLAW package metadata/granules, not the bulk repository.
- The GovInfo Bulk Data Repository exposes XML directory listings at `https://www.govinfo.gov/bulkdata/` and nested collection paths. Current live listings show directory traversal and downloadable XML artifacts, not the existing API pagination model.
- `package.json` already includes `fast-xml-parser` and `yauzl`; the implementation may reuse existing dependencies but must not introduce a new credential requirement.
- This feature is an additive historical backfill path. Existing `fetch --source=govinfo` behavior remains the real-time/incremental API client.
- Non-negotiable constraints:
  - No API key or shared Congress/GovInfo rate-budget dependency for `govinfo-bulk`
  - Resume support must be manifest-backed and mechanically testable
  - Download scope must be filterable by collection and congress
  - The implementation must match the live GovInfo bulk directory structure rather than assuming undocumented ZIP-only responses

## Acceptance Criteria

### Functional
#### 1. CLI surface and argument validation
- [ ] `parseFetchArgs()` accepts `--source=govinfo-bulk` as a new source name and rejects unknown sources with the existing `invalid_arguments` error contract. <!-- Touches: src/commands/fetch.ts, src/utils/manifest.ts, tests/cli/fetch.test.ts -->
- [ ] `fetch --source=govinfo-bulk` runs a new bulk fetch implementation, and `fetch --status` includes a `govinfo-bulk` top-level source status entry alongside the existing sources. <!-- Touches: src/commands/fetch.ts, src/utils/manifest.ts, tests/cli/fetch.test.ts -->
- [ ] `--collection=<name>` is accepted only with `--source=govinfo-bulk`; accepted values are exactly `BILLSTATUS`, `BILLS`, `BILLSUM`, and `PLAW`, and any other value or repeated `--collection` flag returns `invalid_arguments`. <!-- Touches: src/commands/fetch.ts, tests/cli/fetch.test.ts -->
- [ ] `--congress=<integer>` remains accepted with `--source=govinfo-bulk`; when omitted, the fetch enumerates every available congress directory published under the selected collection(s), and when provided, the fetch processes only that congress. <!-- Touches: src/commands/fetch.ts, src/sources/govinfo-bulk.ts (new), tests/cli/fetch.test.ts -->

#### 2. Directory discovery and scope resolution
- [ ] The new bulk fetcher starts from `https://www.govinfo.gov/bulkdata/`, parses the XML directory listings, and discovers only the four in-scope collection directories (`BILLSTATUS`, `BILLS`, `BILLSUM`, `PLAW`) from listing data rather than hard-coded HTML scraping. <!-- Touches: src/sources/govinfo-bulk.ts (new), src/utils/govinfo-bulk-listing.ts (new), tests/unit/sources/govinfo-bulk.test.ts -->
- [ ] For each selected collection, the fetcher resolves the available congress directories from the live XML listing for that collection, applies the optional `--congress` filter, and records the exact discovered congress numbers processed in the result payload and manifest state. <!-- Touches: src/sources/govinfo-bulk.ts (new), src/utils/manifest.ts, tests/unit/sources/govinfo-bulk.test.ts -->
- [ ] For each selected congress, the fetcher recursively traverses folder entries until it reaches downloadable file entries, so collection-specific layouts such as `BILLSTATUS/{congress}/{bill-type}/...`, `BILLSUM/{congress}/{bill-type}/...`, and `PLAW/{congress}/public/...` are handled without collection-specific manual file lists. <!-- Touches: src/sources/govinfo-bulk.ts (new), src/utils/govinfo-bulk-listing.ts (new), tests/unit/sources/govinfo-bulk.test.ts -->

#### 3. Download, cache layout, and resume
- [ ] Downloaded artifacts are written under `data/cache/govinfo-bulk/{collection}/{congress}/...` preserving the remainder of the GovInfo directory structure beneath the congress directory, and parent directories are created automatically. <!-- Touches: src/sources/govinfo-bulk.ts (new), tests/integration/govinfo-bulk.test.ts or equivalent -->
- [ ] Each downloaded file manifest entry stores, at minimum, its source URL, relative cache path, upstream byte size when available, fetched timestamp, and a completion marker that distinguishes fully downloaded files from interrupted downloads. A resumed run must skip files already marked complete when the cached byte count still matches the manifest entry. <!-- Touches: src/utils/manifest.ts, src/sources/govinfo-bulk.ts (new), tests/unit/sources/govinfo-bulk.test.ts -->
- [ ] If a run is interrupted after some files complete and others do not, the next non-`--force` run resumes from manifest state and downloads only the incomplete or missing files for the selected scope. `--force` ignores prior completion state for the selected scope and re-downloads those files. <!-- Touches: src/sources/govinfo-bulk.ts (new), src/utils/manifest.ts, tests/integration/govinfo-bulk.test.ts or equivalent -->
- [ ] The implementation must write files atomically (temporary path then rename, or equivalent) so a partial download never appears in the cache as a completed artifact. <!-- Touches: src/sources/govinfo-bulk.ts (new), tests/unit/sources/govinfo-bulk.test.ts -->

#### 4. Result contract, validation, and documentation
- [ ] A successful `fetch --source=govinfo-bulk` result is emitted as JSON with `source: "govinfo-bulk"`, `ok: true`, the requested selectors (`collection` or `collections`, `congress` or discovered congresses), and count fields for at least `directories_visited`, `files_discovered`, `files_downloaded`, and `files_skipped`. A failed run returns `ok: false` with the existing structured `error` shape. <!-- Touches: src/sources/govinfo-bulk.ts (new), src/commands/fetch.ts, tests/cli/fetch.test.ts -->
- [ ] No code path in `fetch --source=govinfo-bulk` may read or require `API_DATA_GOV_KEY`; invoking the command without that environment variable must still succeed when the upstream bulk repository is reachable. <!-- Touches: src/sources/govinfo-bulk.ts (new), tests/cli/fetch.test.ts -->
- [ ] After a successful BILLSTATUS download for a test fixture or live smoke-test scope, at least one cached XML file must parse successfully as XML using the project’s XML parser dependency, proving the downloaded artifact is structurally valid and not an HTML/error payload. <!-- Touches: src/sources/govinfo-bulk.ts (new), tests/integration/govinfo-bulk.test.ts or equivalent -->
- [ ] `docs/DATA-ACQUISITION-RUNBOOK.md` documents `fetch --source=govinfo-bulk`, its supported `--collection` / `--congress` filters, cache location, resume behavior, no-key requirement, and the recommended acquisition order that prioritizes `BILLSTATUS` before the API-based GovInfo crawl. <!-- Touches: docs/DATA-ACQUISITION-RUNBOOK.md -->

### Non-Functional
- [ ] Performance: the downloader must support bounded concurrency with a default of no more than 2 simultaneous file downloads per process, and this limit must be enforced by implementation logic rather than operator convention. <!-- Touches: src/sources/govinfo-bulk.ts (new), tests/unit/sources/govinfo-bulk.test.ts -->
- [ ] Reliability: XML directory listing parsing and file download validation must reject HTML/error payloads and record them as structured failures in manifest state instead of marking the artifact complete. <!-- Touches: src/utils/govinfo-bulk-listing.ts (new), src/sources/govinfo-bulk.ts (new), src/utils/manifest.ts -->
- [ ] Security: the feature must perform only anonymous HTTPS GET requests to `www.govinfo.gov` bulkdata endpoints and must not introduce new secrets, tokens, or shell-outs to external download tools. <!-- Touches: src/sources/govinfo-bulk.ts (new) -->

## Out of Scope
- Transforming GovInfo bulk XML into downstream normalized schemas or markdown output.
- Replacing the existing `fetch --source=govinfo` API client.
- Determining whether Congress.gov can be fully removed after BILLSTATUS ingestion.
- Downloading GovInfo bulk collections outside `BILLSTATUS`, `BILLS`, `BILLSUM`, and `PLAW`.
- Adding operator-configurable concurrency flags or remote checksum verification beyond what GovInfo listings already expose.

## Dependencies
- GovInfo Bulk Data Repository XML listings under `https://www.govinfo.gov/bulkdata/`
- Existing fetch CLI entry point in `src/commands/fetch.ts`
- Existing manifest persistence in `src/utils/manifest.ts`
- Existing cache/data directory conventions under `data/cache/`
- `fast-xml-parser` for listing and XML validation parsing

## Acceptance Tests (human-readable)
1. Run `node dist/index.js fetch --source=govinfo-bulk --collection=BILLSTATUS --congress=119` with `API_DATA_GOV_KEY` unset. Verify exit code `0`, `source` is `govinfo-bulk`, and cached files appear under `data/cache/govinfo-bulk/BILLSTATUS/119/`.
2. Inspect `data/manifest.json` after the run and verify it contains a `govinfo-bulk` source entry with collection/congress progress and at least one completed file record.
3. Re-run the same command without `--force` and verify the result reports skipped/resumed behavior rather than re-downloading already completed files.
4. Delete or mark one cached file incomplete in a test fixture, re-run the same command, and verify only that missing/incomplete artifact is downloaded again.
5. Run `node dist/index.js fetch --source=govinfo-bulk --collection=NOPE` and verify exit code `2` with an `invalid_arguments` error.
6. Run `node dist/index.js fetch --status` and verify the JSON now includes `govinfo-bulk` alongside `olrc`, `congress`, `govinfo`, `voteview`, and `legislators`.
7. Parse one downloaded BILLSTATUS XML artifact with the project XML parser and verify the parse succeeds.
8. Read the runbook and verify it documents the bulk source, no-key requirement, cache path, filters, and resume semantics.

## Edge Case Catalog
- Invalid CLI selectors: unknown `--collection`, repeated `--collection`, `--collection` used without `--source=govinfo-bulk`, non-numeric `--congress`, or `--all` combined with `--source=govinfo-bulk` must follow the existing validation/error contract.
- Partial directory hierarchies: a collection or congress listing may contain folder entries but no files yet; the run must record zero downloaded files for that subtree without crashing.
- Mixed collection shapes: `BILLSTATUS`/`BILLSUM` include bill-type subdirectories, while `PLAW` may add `public`/`private` branches; traversal must derive structure from listing metadata rather than fixed path templates.
- Malformed input from upstream: invalid XML listings, missing `<files>` arrays, missing file names, empty links, HTML payloads, truncated bodies, BOM markers, or invalid UTF-8 must produce structured failures and no completed manifest entry for the affected artifact.
- Boundary scopes: first available congress, latest available congress, a congress filter that is not present upstream, and a collection with zero matching congresses must all produce deterministic results.
- Concurrency/race conditions: two local processes started against the same data directory may contend for the same temporary file or manifest path; implementation must avoid marking duplicate or partial completions as successful.
- Network failures: timeout, TLS failure, connection reset, or mid-download abort must leave the target artifact resumable and must not corrupt existing completed files.
- Recovery: after an upstream or local network failure, a later rerun with the same selectors must continue from manifest state without requiring manual cache cleanup.
- Large trees: listing traversal for many thousands of files must remain iterative/stream-safe enough to avoid holding the entire remote repository tree in memory before downloading begins.
- Unicode/encoding: file names or listing labels containing non-ASCII text must round-trip through manifest serialization and local path handling without breaking JSON output.
- Auth edge case: presence of an invalid `API_DATA_GOV_KEY` in the environment must not affect `govinfo-bulk` because the source is anonymous.

## Verification Strategy
- **Pure core:** keep XML-listing parsing, collection/congress selector filtering, path derivation, resume eligibility checks, and result/manifest state reduction in pure functions.
- **Properties:** (1) every completed manifest file entry maps to exactly one cached file path; (2) non-`--force` reruns never re-download entries whose cache path and byte count still match a completed manifest entry; (3) selected scope is a subset of discovered scope; (4) only the four allowed collections are accepted; (5) no completed artifact is backed by an HTML payload.
- **Purity boundary:** all network I/O, filesystem writes, and manifest persistence stay in the effectful shell; unit tests cover listing parsing and resume decisions, while integration tests cover manifest updates and on-disk artifacts.

## Infrastructure Requirements
- **Database:** None.
- **API endpoints:** None added; this feature uses GovInfo bulkdata HTTPS directory listings and file URLs, not the authenticated GovInfo API.
- **Infrastructure:** Local filesystem storage under `data/cache/govinfo-bulk/`; no queues, buckets, or background services required.
- **Environment variables / secrets:** No new environment variables or secrets. `API_DATA_GOV_KEY` is explicitly not required for this source.

## Complexity Estimate
L

## Required Skills
typescript, vitest, filesystem I/O, XML parsing, resumable downloader design
