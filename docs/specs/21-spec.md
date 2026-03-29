# Historical OLRC release-point fetch

## Summary
Add historical OLRC release-point support to the existing `fetch --source=olrc` flow so operators can discover available annual vintages, fetch a specific vintage, or backfill all vintages from the OLRC releasepoints listing. The contract must preserve the current latest-only behavior for plain `--source=olrc` while making vintage selection, cache layout, and manifest updates mechanically testable.

## Context
- `src/commands/fetch.ts` currently supports generic selectors like `--status`, `--all`, `--source=<name>`, `--force`, and `--congress=<integer>`, but no OLRC-specific historical selectors.
- `src/sources/olrc.ts` already discovers OLRC releasepoint links, selects the newest vintage, downloads title ZIPs, and stores artifacts under `data/cache/olrc/vintages/{selected_vintage}/...`.
- `src/utils/manifest.ts` currently stores OLRC state as top-level `selected_vintage` plus per-title state in `sources.olrc.titles`.
- Historical backfill needs a stable contract for vintage discovery, parser validation, per-vintage cache isolation, and manifest state that can represent multiple vintages without breaking existing latest-mode consumers.
- Cookie-bootstrap behavior from issue #8 remains a non-negotiable constraint for every OLRC network path introduced by this feature.

## Acceptance Criteria

### 1. CLI selectors and validation
- [ ] `src/commands/fetch.ts` adds OLRC-only selectors `--list-vintages`, `--vintage=<pl-number>`, and `--all-vintages`. Passing any of these selectors without `--source=olrc` exits `2` and writes stderr JSON with `error.code="invalid_arguments"`.
- [ ] `--list-vintages` is mutually exclusive with `--vintage=<pl-number>`, `--all-vintages`, `--all`, `--status`, `--congress=<integer>`, and `--force`. Any invalid combination exits `2`, writes stderr JSON with `error.code="invalid_arguments"`, and creates or mutates no cache or manifest files.
- [ ] `--all-vintages` is mutually exclusive with `--vintage=<pl-number>`, `--all`, `--status`, and `--congress=<integer>`. Any invalid combination exits `2`, writes stderr JSON with `error.code="invalid_arguments"`, and creates or mutates no cache or manifest files.
- [ ] `--vintage=<pl-number>` must match `/^\d+-\d+$/`. Malformed values, including empty `--vintage=`, `--vintage=113`, `--vintage=113-`, and `--vintage=113--1`, are rejected before OLRC discovery begins, exit `2`, write stderr JSON with `error.code="invalid_arguments"`, and create or mutate no cache or manifest files.
- [ ] Repeating `--vintage=<pl-number>` more than once in the same invocation is invalid, even when every value is well-formed or identical. The command exits `2`, writes stderr JSON with `error.code="invalid_arguments"`, performs no OLRC discovery, and creates or mutates no cache or manifest files.

### 2. Vintage discovery and listing
- [ ] `fetch --source=olrc --list-vintages` performs exactly one OLRC releasepoint-listing discovery pass, derives a unique descending `available_vintages` array using the same vintage ordering logic as `src/sources/olrc.ts`, and prints JSON containing `source: "olrc"`, `ok: true`, `available_vintages`, and `latest_vintage`.
- [ ] `available_vintages[0]` equals `latest_vintage`, and every entry in `available_vintages` matches `/^\d+-\d+$/`.
- [ ] `fetch --source=olrc --list-vintages` downloads no title ZIPs, extracts no XML, and records no success/failure state in `data/manifest.json`.
- [ ] If OLRC listing discovery fails for `--list-vintages`, the command exits `1`, prints JSON with `source: "olrc"`, `ok: false`, and `error.code="upstream_request_failed"`, and still writes no cache or manifest state.

### 3. Single-vintage historical fetch
- [ ] `fetch --source=olrc --vintage=<pl-number>` first discovers available vintages from the OLRC releasepoint listing, then fetches exactly the requested vintage when that vintage is present.
- [ ] For a successful `--vintage=<pl-number>` run, every downloaded artifact for that invocation is stored under `data/cache/olrc/vintages/<pl-number>/...`, and the command writes no title ZIPs or extracted XML outside that requested vintage directory.
- [ ] If the requested vintage is absent from discovery results, `fetch --source=olrc --vintage=<pl-number>` exits `1`, prints JSON with `source: "olrc"`, `ok: false`, `selected_vintage: "<pl-number>"`, and `error.code="unknown_vintage"`, and writes no cache or manifest state for that vintage.
- [ ] A successful `--vintage=<pl-number>` run updates the manifest with machine-readable metadata for that vintage, including the selected vintage identifier and per-title download or reserved-empty state for that vintage.

### 4. Multi-vintage historical fetch
- [ ] `fetch --source=olrc --all-vintages` discovers the full available vintage list once, then attempts every discovered vintage in descending order.
- [ ] Under `--all-vintages`, a failure in one vintage does not skip discovery or fetch attempts for later vintages in the same run. Vintages completed before the failure remain on disk and remain represented in the manifest after the run.
- [ ] `fetch --source=olrc --all-vintages` exits `0` only when every discovered vintage succeeds; it exits `1` when one or more discovered vintages fail.
- [ ] The JSON result for `--all-vintages` includes per-vintage outcome records so tests can assert which vintages succeeded, failed, or were skipped by validation before download.

### 5. Manifest compatibility
- [ ] `src/utils/manifest.ts` is extended so `sources.olrc` can represent multiple vintages in machine-readable form, keyed by vintage identifier, while preserving the existing top-level `selected_vintage` field for compatibility with plain latest-mode OLRC fetches and existing consumers.
- [ ] After a successful plain `fetch --source=olrc`, `sources.olrc.selected_vintage` continues to equal the newest discovered vintage exactly as before this feature.
- [ ] Reading a manifest created before this feature does not throw or require manual migration; missing historical-vintage structures normalize to empty state during manifest load.

### 6. Unchanged latest-mode behavior
- [ ] Plain `fetch --source=olrc` continues to fetch only the newest discovered vintage, using the same success and failure semantics already implemented in `src/sources/olrc.ts`.
- [ ] Plain `fetch --source=olrc` does not implicitly list or backfill older vintages, and its JSON output remains compatible with the current `OlrcFetchResult` fields plus any additive backward-compatible fields introduced by this feature.

### Non-Functional
- [ ] Performance: `--list-vintages` performs no title ZIP downloads and no XML extraction work.
- [ ] Security: OLRC bootstrap cookies remain in-memory only and are never serialized into manifest JSON, cache metadata, or CLI JSON output for latest, single-vintage, listing, or all-vintages modes.

## Out of Scope
- Generating historical commits in the downstream `us-code` repository
- Cache-pruning or deletion policies for historical OLRC vintages
- Appendix-title support beyond current OLRC behavior
- Changes to non-OLRC fetch sources

## Dependencies
- `https://uscode.house.gov/download/releasepoints/` and the currently used OLRC listing pages in `src/sources/olrc.ts`
- Existing OLRC cookie-bootstrap implementation from issue #8
- Existing fetch command, OLRC source module, and manifest module

## Acceptance Tests (human-readable)
1. Run `npx us-code-tools fetch --source=olrc --list-vintages` against a fixture listing containing at least three vintages. Verify exit `0`, stdout JSON contains descending unique `available_vintages`, `latest_vintage`, no title ZIP downloads occur, and `data/manifest.json` is absent or unchanged.
2. Run `npx us-code-tools fetch --source=olrc --list-vintages --force`. Verify exit `2`, stderr JSON contains `error.code="invalid_arguments"`, and no cache or manifest file is created.
3. Run `npx us-code-tools fetch --source=olrc --vintage=113-1` against fixtures that include that vintage. Verify exit `0`, all downloaded files land under `data/cache/olrc/vintages/113-1/`, and manifest state records that vintage.
4. Run `npx us-code-tools fetch --source=olrc --vintage=999-999` against fixtures where that vintage is absent. Verify exit `1`, stdout JSON contains `error.code="unknown_vintage"`, and no `data/cache/olrc/vintages/999-999/` directory or manifest entry is created.
5. Run `npx us-code-tools fetch --source=olrc --vintage=113 --force` and `npx us-code-tools fetch --source=olrc --vintage=113--1`. Verify each exits `2` before OLRC discovery, writes stderr JSON with `error.code="invalid_arguments"`, and leaves cache and manifest unchanged.
6. Run `npx us-code-tools fetch --source=olrc --vintage=113-1 --vintage=113-1`. Verify exit `2`, stderr JSON contains `error.code="invalid_arguments"`, OLRC discovery is not invoked, and cache/manifest remain unchanged.
7. Run `npx us-code-tools fetch --source=olrc --all-vintages` against fixtures where one middle vintage fails during download. Verify later vintages still run, successful vintages remain on disk and in the manifest, stdout JSON contains per-vintage outcomes, and the process exits `1`.
8. Run plain `npx us-code-tools fetch --source=olrc` against the same fixture listing. Verify only the newest vintage is fetched and `sources.olrc.selected_vintage` equals that newest vintage.

## Edge Case Catalog
- **Argument validation:** missing `--source=olrc`; repeated `--vintage`; empty `--vintage=`; malformed delimiters like `113`, `113-`, and `113--1`; and invalid combinations with `--all`, `--all-vintages`, `--status`, `--congress`, or `--force`.
- **Discovery anomalies:** duplicate listing links, mixed current/legacy listing URLs, sparse vintages, malformed releasepoint links, and vintages with missing title ZIP links.
- **Encoding issues:** BOM markers, invalid UTF-8, or HTML payload changes in the OLRC listing page.
- **Partial failure:** one or more vintages fail during `--all-vintages` after earlier vintages already succeeded.
- **Fallback behavior:** cookie bootstrap succeeds but a later ZIP request fails, or the preferred listing fails and OLRC fallback listing behavior is engaged.
- **Recovery:** a later retry after a failed `--all-vintages` run should preserve already completed vintages and resume using the persisted cache/manifest state defined by implementation.
- **Manifest compatibility:** manifests written before the historical-vintages schema exists, plus manifests that contain only latest-mode OLRC state.
- **Concurrency:** concurrent OLRC runs targeting the same vintage directory or the same manifest file.

## Verification Strategy
- **Pure core:** selector validation, repeated-flag detection, vintage-format validation, vintage extraction from listing links, dedupe/sort ordering, requested-vintage lookup, and `--all-vintages` aggregate exit-code reduction.
- **Properties:** discovered vintage lists are unique and descending; every fetched artifact path belongs to exactly one `data/cache/olrc/vintages/<pl-number>/` subtree; malformed or repeated `--vintage` input fails before discovery; plain latest-mode still selects the newest vintage; cookies never persist.
- **Purity boundary:** OLRC HTTP requests, cookie bootstrap, ZIP download, XML extraction, filesystem writes, and manifest persistence.

## Infrastructure Requirements
- **Database:** None.
- **API endpoints:** None.
- **Infrastructure:** Existing local filesystem cache and manifest; additional per-vintage OLRC storage under `data/cache/olrc/vintages/`.
- **Environment variables / secrets:** No new environment variables or secrets.

## Complexity Estimate
L

## Required Skills
- TypeScript
- Node.js CLI design
- Filesystem/cache layout
- HTTP/cookie handling
- Manifest schema design
- Vitest
