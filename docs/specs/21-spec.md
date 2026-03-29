## [spec-writer] — Initial spec drafted
See `docs/specs/21-spec.md` for the canonical spec.

# Historical OLRC release-point fetch

## Summary
Extend the existing `fetch --source=olrc` flow so operators can discover, select, and download historical OLRC annual release points in addition to the current latest release point. The feature must preserve today’s latest-only behavior by default while adding a mechanically testable CLI contract for listing vintages, fetching one named vintage, and fetching all discovered vintages into per-vintage cache directories with manifest metadata suitable for historical backfill workflows.

## Context
- `src/commands/fetch.ts` currently supports `--status`, `--all`, `--source=<name>`, `--force`, and `--congress=<n>`, but has no OLRC-specific selectors for historical vintages.
- `src/sources/olrc.ts` already discovers releasepoint links from `https://uscode.house.gov/download/download.shtml`, selects one latest vintage with `fetchOlrcVintagePlan()`, downloads title ZIPs into `data/cache/olrc/vintages/{selected_vintage}/title-{NN}/`, and records per-title state plus one top-level `selected_vintage` in the manifest.
- Issue #8 already established OLRC cookie bootstrap behavior via the in-memory request context in `src/sources/olrc.ts`; historical fetch modes must use the same cookie-aware request path rather than introduce a second OLRC transport implementation.
- Historical backfill needs stable access to annual point-in-time OLRC corpora from roughly 2013 onward, with each corpus identified by the public-law vintage string used in the releasepoint URLs (for example `113-1`).
- Full historical acquisition is large (~650 ZIPs / 5–6 GB XML), so the spec must define resumable-safe artifact layout, deterministic listing output, and manifest semantics that let later stages identify which vintages were fetched successfully.

## Acceptance Criteria

### 1. Fetch CLI surface for historical OLRC selection
- [ ] `parseFetchArgs()` in `src/commands/fetch.ts` accepts these additional OLRC-only selectors: `--list-vintages`, `--vintage=<pl-number>`, and `--all-vintages`.
  <!-- Touches: src/commands/fetch.ts, tests/cli/fetch.test.ts -->
- [ ] `--list-vintages`, `--vintage=<pl-number>`, and `--all-vintages` are valid only when `--source=olrc` is also present; each invalid combination exits `2`, writes a single JSON usage error to stderr with `error.code="invalid_arguments"`, and writes no cache or manifest changes.
  <!-- Touches: src/commands/fetch.ts, tests/cli/fetch.test.ts -->
- [ ] `--list-vintages` cannot be combined with `--all`, `--status`, `--congress=<n>`, `--vintage=<pl-number>`, or `--all-vintages`; `--vintage=<pl-number>` cannot be combined with `--all-vintages`; `--all-vintages` cannot be combined with `--all`, `--status`, or `--congress=<n>`.
  <!-- Touches: src/commands/fetch.ts, tests/cli/fetch.test.ts -->
- [ ] Existing valid invocations remain valid and unchanged: `fetch --source=olrc` still means “fetch the single latest OLRC vintage,” and non-OLRC sources do not accept any of the new vintage selectors.
  <!-- Touches: src/commands/fetch.ts, tests/cli/fetch.test.ts -->

### 2. Vintage discovery and deterministic listing output
- [ ] A new or extended OLRC discovery path in `src/sources/olrc.ts` enumerates every vintage exposed by `https://uscode.house.gov/download/download.shtml` releasepoint links, deduplicates them by vintage string, and sorts them using the same descending vintage ordering used for latest-vintage selection.
  <!-- Touches: src/sources/olrc.ts, tests/unit/sources/olrc.test.ts -->
- [ ] `fetch --source=olrc --list-vintages` performs discovery only, writes no ZIP or extracted XML artifacts, writes no success manifest mutation, exits `0`, and prints one JSON object containing `source:"olrc"`, `ok:true`, `available_vintages:[...]`, and `latest_vintage:"<value>"`.
  <!-- Touches: src/commands/fetch.ts, src/sources/olrc.ts, tests/cli/fetch.test.ts, tests/unit/sources/olrc.test.ts -->
- [ ] The `available_vintages` array contains each discovered vintage exactly once, in descending order, and includes only vintages that expose at least one numeric title ZIP matching the OLRC releasepoint URL pattern already recognized by `extractReleasepointLinks()`.
  <!-- Touches: src/sources/olrc.ts, tests/unit/sources/olrc.test.ts -->
- [ ] If OLRC listing discovery fails, `fetch --source=olrc --list-vintages` exits `1`, writes no success manifest mutation, and returns a JSON result with `source:"olrc"`, `ok:false`, and `error.code="upstream_request_failed"`.
  <!-- Touches: src/commands/fetch.ts, src/sources/olrc.ts, tests/cli/fetch.test.ts -->

### 3. Single-vintage historical fetch
- [ ] `fetch --source=olrc --vintage=<pl-number>` fetches exactly one named vintage and does not silently substitute the latest or any other vintage when the requested value is present in the discovered listing.
  <!-- Touches: src/commands/fetch.ts, src/sources/olrc.ts, tests/cli/fetch.test.ts, tests/unit/sources/olrc.test.ts -->
- [ ] When the requested vintage exists, OLRC downloads for that run are stored only under `data/cache/olrc/vintages/<pl-number>/title-{NN}/`, preserving the current per-title subdirectory layout inside the selected vintage directory.
  <!-- Touches: src/sources/olrc.ts, tests/unit/sources/olrc.test.ts, tests/repo/data-acquisition-layout.test.ts -->
- [ ] When the requested vintage does not exist in the discovered listing, the command exits `1`, downloads no title artifacts, and returns a JSON result with `error.code="unknown_vintage"` and the rejected `requested_vintage` value.
  <!-- Touches: src/commands/fetch.ts, src/sources/olrc.ts, tests/cli/fetch.test.ts -->
- [ ] Cookie bootstrap/session handling for a requested historical vintage uses the same in-memory OLRC request context as the latest-vintage fetch path; no cookie values are written to the manifest, cache metadata, or CLI output.
  <!-- Touches: src/sources/olrc.ts, tests/unit/sources/olrc.test.ts -->
- [ ] Title-level success/failure semantics for a requested historical vintage match the existing latest-vintage OLRC contract: successful numeric titles remain cached, Title 53 reserved-empty handling remains machine-readable, and a non-Title-53 unrecoverable title failure makes the source result `ok:false` without deleting already completed title artifacts.
  <!-- Touches: src/sources/olrc.ts, src/utils/manifest.ts, tests/unit/sources/olrc.test.ts -->

### 4. All-vintages historical fetch
- [ ] `fetch --source=olrc --all-vintages` discovers the full vintage list and attempts each vintage in descending order, emitting one aggregate JSON result for `source:"olrc"` that includes `requested_scope.vintages:"all"`, `available_vintages:[...]`, `completed_vintages:[...]`, and `failed_vintages:[...]`.
  <!-- Touches: src/commands/fetch.ts, src/sources/olrc.ts, tests/cli/fetch.test.ts, tests/unit/sources/olrc.test.ts -->
- [ ] `--all-vintages` is fail-open at the vintage level: if one vintage fails after some earlier vintages completed, the command still attempts later vintages, preserves already completed vintages’ artifacts and manifest entries, and exits `1` iff one or more vintages failed.
  <!-- Touches: src/sources/olrc.ts, src/utils/manifest.ts, tests/unit/sources/olrc.test.ts, tests/cli/fetch.test.ts -->
- [ ] A completed historical run never stores artifacts for different vintages in the same directory; every downloaded ZIP and extracted XML artifact remains rooted beneath exactly one `data/cache/olrc/vintages/<pl-number>/` directory.
  <!-- Touches: src/sources/olrc.ts, tests/unit/sources/olrc.test.ts, tests/repo/data-acquisition-layout.test.ts -->
- [ ] A later non-`--force` `--all-vintages` run may reuse already valid cached ZIPs/artifacts for previously fetched vintages using the same cache validation rules as the current OLRC fetch path; a `--force` run re-downloads the requested vintages.
  <!-- Touches: src/sources/olrc.ts, tests/unit/sources/olrc.test.ts -->

### 5. Manifest model for multiple OLRC vintages
- [ ] `src/utils/manifest.ts` extends `OlrcManifestState` so the manifest can represent more than one fetched vintage at once, without losing the existing top-level `selected_vintage` field used by the latest-vintage path.
  <!-- Touches: src/utils/manifest.ts, tests/utils/manifest.test.ts -->
- [ ] The manifest records per-vintage metadata under a machine-readable OLRC structure that includes, at minimum, the vintage identifier, completion timestamp or last-attempt timestamp, per-title states for that vintage, and the final status for that vintage (`complete` or `failed`).
  <!-- Touches: src/utils/manifest.ts, tests/utils/manifest.test.ts, tests/unit/sources/olrc.test.ts -->
- [ ] After `fetch --source=olrc` with no historical selector, `manifest.sources.olrc.selected_vintage` still points to the latest fetched vintage exactly as it does today.
  <!-- Touches: src/sources/olrc.ts, src/utils/manifest.ts, tests/unit/sources/olrc.test.ts -->
- [ ] After `fetch --source=olrc --vintage=<pl-number>`, the manifest records that vintage under the new per-vintage structure and sets `selected_vintage` to `<pl-number>` for that invocation’s result state.
  <!-- Touches: src/sources/olrc.ts, src/utils/manifest.ts, tests/unit/sources/olrc.test.ts -->
- [ ] After `fetch --source=olrc --all-vintages`, the manifest retains all completed/failed vintage entries and sets `selected_vintage` to the newest successfully fetched vintage from that run, or leaves the prior successful value unchanged if no vintage completed successfully.
  <!-- Touches: src/sources/olrc.ts, src/utils/manifest.ts, tests/unit/sources/olrc.test.ts -->

### 6. Regression coverage and execution constraints
- [ ] The default `npm test` suite includes fixture-backed or mocked coverage for: vintage discovery ordering, `--list-vintages` CLI output, invalid argument combinations, requested-vintage success, requested-vintage unknown-value failure, `--all-vintages` fail-open behavior, and manifest normalization for the new OLRC per-vintage state, with no live outbound dependency on `uscode.house.gov`.
  <!-- Touches: tests/cli/fetch.test.ts, tests/unit/sources/olrc.test.ts, tests/utils/manifest.test.ts, tests/fixtures/** -->

### Non-Functional
- [ ] Performance: `fetch --source=olrc --list-vintages` completes using a single OLRC listing discovery pass and performs no title ZIP downloads.
- [ ] Security: OLRC bootstrap cookies remain in-memory only for the active fetch operation and are not serialized into `data/manifest.json`, any cache-side manifest, or stdout/stderr JSON output.

## Out of Scope
- Transforming or diffing multiple vintages into git commits in the downstream `us-code` repository
- Appendix-title support (`5a`, `11a`, `18a`, `28a`, `50a`)
- Compression, pruning, or garbage-collection policies for the multi-gigabyte historical cache
- Adding new non-OLRC source selectors or changing Congress/GovInfo/VoteView/legislators fetch semantics
- Inventing a hardcoded vintage list when the OLRC listing is reachable; fixture-only hardcoded lists for tests are fine

## Dependencies
- `https://uscode.house.gov/`
- `https://uscode.house.gov/download/download.shtml`
- Existing OLRC cookie bootstrap/fetch implementation from issue #8
- Existing `src/commands/fetch.ts`, `src/sources/olrc.ts`, and `src/utils/manifest.ts` modules
- Vitest fixture/mocking support for offline CLI and source tests

## Acceptance Tests (human-readable)
1. Run `npx us-code-tools fetch --source=olrc --list-vintages` against a fixture listing containing multiple releasepoint vintages. Verify stdout JSON includes one descending `available_vintages` array, one `latest_vintage` value, no ZIP downloads, and no manifest write.
2. Run `npx us-code-tools fetch --source=olrc --list-vintages --force`. Verify exit code `2`, stderr JSON contains `error.code="invalid_arguments"`, and no cache or manifest is created.
3. Run `npx us-code-tools fetch --source=olrc --vintage=113-1` against fixtures for that vintage. Verify all title artifacts are written only under `data/cache/olrc/vintages/113-1/`, the JSON result reports `selected_vintage:"113-1"`, and the manifest stores a per-vintage entry for `113-1`.
4. Run `npx us-code-tools fetch --source=olrc --vintage=999-999` against a listing that does not expose that value. Verify exit code `1`, no title downloads occur, and stdout JSON reports `error.code="unknown_vintage"` and `requested_vintage:"999-999"`.
5. Run `npx us-code-tools fetch --source=olrc --all-vintages` against fixtures where the first vintage succeeds, the second fails on one non-Title-53 title, and a later third vintage succeeds. Verify artifacts exist for the successful vintages, the failed vintage is listed in `failed_vintages`, later vintages were still attempted, and the command exits `1`.
6. Re-run the same `--all-vintages` scenario without `--force` using already valid cached artifacts for one vintage. Verify the client reuses that cached vintage’s ZIPs and does not issue redundant network requests for those titles.
7. Run plain `npx us-code-tools fetch --source=olrc` after historical vintages already exist. Verify the command still behaves as latest-only, updates `selected_vintage` to the newest listing value, and does not require `--vintage` or `--all-vintages`.
8. Read `data/manifest.json` after fetching one named historical vintage and verify OLRC metadata includes both `selected_vintage` and a machine-readable per-vintage record containing per-title states for that vintage.

## Edge Case Catalog
- **Argument validation:** missing `--source=olrc`, duplicate `--vintage`, empty `--vintage=`, malformed `--vintage=113`, malformed `--vintage=113-`, extra delimiters like `113--1`, and combinations with `--all`, `--status`, or `--congress`.
- **Discovery parsing:** duplicate links for the same title/vintage, relative and absolute hrefs, appendix-title ZIPs adjacent to numeric titles, malformed releasepoint hrefs, sparse vintages that expose only some numeric titles, and listing pages containing both current and historical vintages.
- **Vintage semantics:** requested vintage present but missing one or more numeric titles, requested vintage present with Title 53 reserved-empty response, and newest discovered vintage failing while an older requested vintage succeeds.
- **Failure and recovery:** one vintage fails after some titles completed, later vintages still proceed under `--all-vintages`, rerun after partial prior historical fetch, and `--force` overriding previously valid cache entries.
- **Payload issues:** HTML returned with `200 OK`, unreadable ZIP, zero-byte ZIP, no XML entries, truncated ZIP, and invalid UTF-8/BOM edge cases inside extracted XML.
- **Manifest safety:** old manifest files lacking the new per-vintage field, partial failure while updating one historical vintage, and preserving prior successful OLRC metadata when a later historical run fails.
- **Security/privacy:** multiple `Set-Cookie` headers, bootstrap response with no cookie, cookie refresh after retry, and ensuring no cookie material appears in logs or persisted JSON.

## Verification Strategy
- **Pure core:** vintage-link extraction, vintage deduplication/sorting, selector validation, requested-vintage lookup, and aggregate result reduction for `--all-vintages` should be pure helpers with fixture-driven tests.
- **Properties:**
  - Each persisted artifact path belongs to exactly one vintage directory.
  - `available_vintages` contains unique values sorted descending.
  - `selected_vintage` for plain `fetch --source=olrc` equals the newest discoverable vintage.
  - Cookie values never appear in manifest JSON, log output, or CLI JSON output.
- **Purity boundary:** HTTP requests, cookie bootstrap, ZIP downloads, filesystem writes, and manifest persistence are the effectful shell; discovery parsing and result classification should remain unit-testable without I/O.

## Infrastructure Requirements
- **Database:** None.
- **API endpoints:** None.
- **Infrastructure:** Existing local filesystem cache and manifest only; no new services, queues, or buckets.
- **Environment variables / secrets:** No new environment variables or secrets. Existing OLRC cookie bootstrap remains dynamic and in-memory.

## Complexity Estimate
L

Reason: the change spans CLI parsing, OLRC source orchestration, cache layout guarantees, manifest schema evolution, and offline regression coverage for multi-vintage flows.

## Required Skills
- TypeScript
- Node.js CLI design
- HTTP/cookie handling
- ZIP/cache management
- Manifest schema design
- Vitest