# OLRC Releasepoint Fetch + uscDoc Parser Compatibility

## Summary
Update the existing OLRC ingestion path so `fetch --source=olrc` works against the current `uscode.house.gov` releasepoint site and `transform --title <n>` can parse both legacy `<uslm>` XML and current `<uscDoc><main><title>...</title></main></uscDoc>` XML. The implementation must establish and reuse the OLRC session cookie required for downloads, scrape the current `download.shtml` releasepoint listing, tolerate the reserved-empty Title 53 response, and parse current releasepoint XML without regressing existing legacy fixtures.

## Context
- The current OLRC client in `src/sources/olrc.ts` still scrapes `https://uscode.house.gov/download/annualtitlefiles.shtml`, which no longer exposes the current title ZIP listing.
- The current download flow uses raw `fetch()` calls via `fetchWithRetry()` and does not persist the OLRC session cookie required by `uscode.house.gov`; direct ZIP requests can return HTTP 404 without a prior cookie-establishing visit.
- The current XML parser in `src/transforms/uslm-to-ir.ts` expects `document.uslm.title`, but the current OLRC releasepoint files use `uscDoc` as the document root and nest the title under `uscDoc.main.title`.
- `src/index.ts` currently restricts `transform --title` to integer titles `1..54`; appendix titles are not part of this issue unless a follow-up issue expands the CLI contract.
- `src/sources/olrc.ts` currently enforces `MAX_XML_ENTRY_BYTES = 64 * 1024 * 1024`; current Title 42 releasepoint XML can exceed that limit once uncompressed.
- The repository already includes OLRC source tests, transformer tests, and adversary tests; this issue must extend those suites rather than rely on live-network-only verification.

## Acceptance Criteria

### 1. OLRC listing discovery and session-cookie download flow
- [ ] `fetchOlrcVintagePlan()` in `src/sources/olrc.ts` requests `https://uscode.house.gov/download/download.shtml` instead of `annualtitlefiles.shtml`, extracts releasepoint links matching `releasepoints/us/pl/{congress}/{law}/xml_usc{title}@{congress}-{law}.zip`, and selects the numerically newest available vintage by the existing `compareVintageDescending()` ordering.
  <!-- Touches: src/sources/olrc.ts, tests/**/*olrc*.test.ts -->
- [ ] `fetchWithRetry()` performs a cookie-bootstrap request to `https://uscode.house.gov/`, captures the `Set-Cookie` header value(s) needed for the session, and sends a `Cookie` header on every subsequent OLRC listing or ZIP request made during the same fetch operation.
  <!-- Touches: src/sources/olrc.ts, tests/**/*olrc*.test.ts -->
- [ ] When the bootstrap request succeeds and a subsequent title ZIP request returns HTTP 200 with a readable ZIP, `fetchOlrcSource({ force: false })` downloads every available numeric title ZIP in the selected vintage without requiring external curl scripts, writes the fetched artifacts into the existing OLRC cache structure, and records `selected_vintage` in the manifest.
  <!-- Touches: src/sources/olrc.ts, src/utils/manifest.ts, tests/**/*olrc*.test.ts -->
- [ ] When the selected vintage omits Title 53 because the upstream response is not a ZIP archive or resolves to an HTML error page, `fetchOlrcSource()` completes with `ok: true`, excludes Title 53 from `manifest.sources.olrc.titles`, and records Title 53 in a machine-readable skip list or equivalent manifest field whose value distinguishes an expected empty title from a transport failure.
  <!-- Touches: src/sources/olrc.ts, src/utils/manifest.ts, tests/**/*olrc*.test.ts -->
- [ ] If the OLRC homepage bootstrap request fails, the listing request fails, or a non-Title-53 title ZIP request returns a non-2xx response, non-ZIP payload, unreadable ZIP, or retry exhaustion, the fetch command returns `ok: false`, preserves any successfully cached prior titles, and records an error whose message contains both the failing title number (when applicable) and the failing URL.
  <!-- Touches: src/sources/olrc.ts, src/index.ts, tests/**/*olrc*.test.ts -->

### 2. XML extraction limits and releasepoint parsing
- [ ] `extractXmlEntriesFromZip()` accepts the current Title 42 releasepoint XML without throwing the existing per-entry size-limit error; this may be satisfied by increasing `MAX_XML_ENTRY_BYTES`, switching to a streamed extraction path, or both, provided the default test fixture for a >64 MiB uncompressed XML entry passes without truncation.
  <!-- Touches: src/sources/olrc.ts, tests/**/*olrc*.test.ts -->
- [ ] `parseUslmToIr()` in `src/transforms/uslm-to-ir.ts` parses both of the following document shapes into the existing `TitleIR` structure with identical downstream semantics for `chapters`, `sections`, and parse errors: (a) legacy `<uslm><title>...</title></uslm>` fixtures and (b) current `<uscDoc xmlns="http://xml.house.gov/schemas/uslm/1.0"><main><title>...</title></main></uscDoc>` fixtures.
  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/unit/transforms/uslm-to-ir.test.ts, tests/fixtures/**/* -->
- [ ] The XML parser configuration removes or tolerates the OLRC namespace prefixing used by current releasepoint XML so that the parser can locate `uscDoc`, `main`, `title`, `chapter`, and `section` nodes without requiring the caller to pre-strip namespaces from the XML string.
  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/unit/transforms/uslm-to-ir.test.ts -->
- [ ] For a current-format Title 1 fixture containing 53 `<section>` elements, `parseUslmToIr()` returns `titleIr.sections.length === 53`, preserves section identifiers as strings, and does not emit `INVALID_XML` solely because the root element is `uscDoc`.
  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/unit/transforms/uslm-to-ir.test.ts, tests/fixtures/**/* -->
- [ ] The existing legacy `<uslm>` fixtures under `tests/fixtures/xml/` continue to pass unchanged after the parser update.
  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/unit/transforms/uslm-to-ir.test.ts -->

### 3. CLI transform behavior on current OLRC data
- [ ] Given a cached current-format OLRC ZIP for Title 1, `npx us-code-tools transform --title 1 --output <dir>` exits with status 0, writes `_title.md` plus one markdown file per successfully parsed section under `uscode/title-01/`, and reports `sections_found` greater than 0 in the final JSON report.
  <!-- Touches: src/index.ts, src/transforms/uslm-to-ir.ts, src/transforms/write-output.ts, tests/integration/**/*transform*.test.ts -->
- [ ] Given cached current-format OLRC ZIPs for every numeric title except 53, a deterministic integration or fixture-driven test can transform titles `1..54` and observes: titles `1..52` and `54` exit with status 0 and write at least one section file, while title `53` exits non-zero with an error message containing `no XML entries`, `not a zip`, or another explicit reserved-empty diagnostic defined by the implementation.
  <!-- Touches: src/index.ts, src/sources/olrc.ts, tests/integration/**/*transform*.test.ts -->
- [ ] The `transform --title` CLI contract remains integer-only for this issue: passing `--title 5a`, `11a`, `18a`, `28a`, or `50a` still fails argument validation with a non-zero exit code and the existing integer-range usage guidance.
  <!-- Touches: src/index.ts, tests/**/*transform*.test.ts -->

### 4. Test coverage and regression hardening
- [ ] The default `npm test` suite includes committed fixtures or mocks that cover: cookie bootstrap + authenticated ZIP request, `download.shtml` listing parsing, current-format `uscDoc` parsing, legacy `uslm` backward compatibility, Title 42 large-entry extraction, and Title 53 reserved-empty handling, and the suite passes without requiring live outbound access to `uscode.house.gov`.
  <!-- Touches: tests/**/*.test.ts, tests/fixtures/**/*, package.json, vitest.config.ts -->

### Non-Functional
- [ ] Performance: parsing a committed current-format Title 1 fixture and writing output for `transform --title 1` completes within 10 seconds on the project’s CI runner class without network access.
- [ ] Security: OLRC session cookies are used only in memory for the active fetch operation and are not written to the manifest, log output, or generated markdown artifacts.

## Out of Scope
- Adding CLI support for appendix titles `5a`, `11a`, `18a`, `28a`, or `50a`
- Changing the downstream markdown schema or file layout emitted by `writeTitleOutput()`
- Supporting live incremental sync, diff generation, or git commit workflows
- Any changes to non-OLRC sources (`voteview`, `legislators`, `govinfo`, `congress`)
- Any attempt to normalize or repair upstream OLRC HTML error pages beyond detecting and classifying them as non-ZIP responses

## Dependencies
- `https://uscode.house.gov/` homepage response for session-cookie establishment
- `https://uscode.house.gov/download/download.shtml` for releasepoint listing discovery
- Current and legacy OLRC XML fixture files committed under `tests/fixtures/`
- Existing TypeScript, Node.js, Vitest, and ZIP extraction stack already used by the repo

## Acceptance Tests (human-readable)
1. Stub `fetch` so the first request to `https://uscode.house.gov/` returns `Set-Cookie: JSESSIONID=...`.
2. Stub the next request to `https://uscode.house.gov/download/download.shtml` and verify the request includes a `Cookie` header containing the session cookie.
3. Return a listing page that includes releasepoint links for the newest vintage and verify `fetchOlrcSource()` selects that vintage and downloads every available numeric title ZIP.
4. Stub Title 53 as an HTML payload or unreadable ZIP response and verify `fetchOlrcSource()` still returns `ok: true`, skips Title 53, and records the skip classification in manifest state.
5. Run `npm test` and verify the OLRC source tests and parser tests pass without live network access.
6. Seed the cache with a current-format Title 1 ZIP fixture and run `npx us-code-tools transform --title 1 --output ./out`; verify `_title.md` and section markdown files are created.
7. Verify the final JSON report from the transform command includes `sections_found` greater than 0 for Title 1.
8. Seed the cache with a Title 42 large-entry fixture and verify extraction succeeds without a size-limit exception.
9. Run the parser against both a legacy `<uslm>` fixture and a current `<uscDoc>` fixture and verify both produce a non-empty `titleIr.sections` array.
10. Run `npx us-code-tools transform --title 5a --output ./out` and verify the CLI rejects the argument with the existing integer-only validation error.

## Edge Case Catalog
- Cookie bootstrap edge cases: homepage returns multiple `Set-Cookie` headers, cookie attributes include `Path`, `Secure`, or `HttpOnly`, bootstrap returns 200 without `Set-Cookie`, retry path receives a refreshed session cookie mid-run.
- Listing edge cases: `download.shtml` contains relative and absolute releasepoint links, duplicate links for the same title, appendix links adjacent to numeric-title links, malformed links missing a title suffix, and multiple vintages on one page.
- ZIP payload edge cases: HTML body served with `200 OK`, truncated ZIP, zero-byte ZIP, nested XML pathnames, multiple XML files per title, and large uncompressed XML entries that exceed previous guardrails.
- XML structure edge cases: namespace-qualified roots, BOM-prefixed XML, `<uscDoc>` with `<meta>` but missing `<main>`, `<main>` with missing `<title>`, sections nested directly under `<title>` and under `<chapter>`, and legacy `<uslm>` fixtures that still must parse identically.
- Section data edge cases: mixed numeric/alphanumeric section identifiers, empty headings, missing section numbers, duplicate section numbers across multiple XML files, and note/cross-reference nodes containing mixed whitespace or XML entities.
- Failure-mode edge cases: bootstrap succeeds but listing fails, some titles download before one title fails, Title 53 returns reserved-empty HTML while other titles succeed, and rerunning after a transient failure reuses valid cached ZIPs.
- Input validation edge cases: malformed `--title` flag values (`0`, `55`, `5a`, empty string, duplicate flags), partial CLI inputs, and invalid UTF-8 or BOM-prefixed XML content in fixtures.

## Verification Strategy
- **Pure core:** releasepoint-link parsing, selected-vintage comparison, XML root/title-node discovery, namespace normalization, and skip/failure classification should be implemented as pure functions with fixture-driven tests.
- **Properties:**
  - For every successfully parsed title XML, section identifiers remain strings and are never numerically reformatted.
  - For any pair of equivalent legacy/current XML fixtures containing the same title/section content, `parseUslmToIr()` produces the same `TitleIR` semantics for chapter count, section count, and section ordering.
  - Title 53 reserved-empty responses are classified deterministically and never written as cached ZIP artifacts.
  - Session cookies never appear in manifest JSON, logs, or output markdown.
- **Purity boundary:** HTTP requests, response-header handling, ZIP reads, cache writes, and CLI stdout/stderr are the effectful shell; listing parsing, XML shape detection, namespace stripping, and result classification should remain isolated from I/O.

## Infrastructure Requirements
- **Database:** None.
- **API endpoints:** None.
- **Infrastructure:** Existing local filesystem cache under the repo data/cache path; no new services.
- **Environment variables / secrets:** No new environment variables or secrets; OLRC session cookies are acquired dynamically per fetch run.

## Complexity Estimate
L

Reason: this work crosses the OLRC network client, cache/extraction path, XML parser, CLI integration behavior, and the default test suite, with one cross-cutting compatibility requirement for both legacy and current upstream formats.

## Required Skills
- TypeScript
- Node.js
- HTTP client behavior and header handling
- XML parsing
- ZIP extraction
- Vitest
- CLI testing
