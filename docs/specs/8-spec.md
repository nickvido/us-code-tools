# OLRC Releasepoint Fetch + uscDoc Parser Compatibility

## Summary
Update the OLRC fetch and transform pipeline so the current `uscode.house.gov` releasepoint site works end-to-end: bootstrap the required session cookie, scrape `download.shtml`, parse current `uscDoc` XML, preserve backward compatibility with legacy `uslm` fixtures, accept current large-title extraction requirements, and classify reserved-empty Title 53 separately from transport failures.

## Context
- `src/sources/olrc.ts` still targets `https://uscode.house.gov/download/annualtitlefiles.shtml`, but the current OLRC listing page is `https://uscode.house.gov/download/download.shtml`.
- `src/sources/olrc.ts` currently uses raw `fetch()` calls in `fetchWithRetry()` and does not retain the OLRC session cookie required for later listing/ZIP requests.
- `src/sources/olrc.ts` currently marks any missing title in the selected vintage as a fatal fetch result; that behavior is too strict for reserved-empty Title 53.
- `src/sources/olrc.ts` enforces `MAX_XML_ENTRY_BYTES = 64 * 1024 * 1024`; current Title 42 XML can exceed that threshold after decompression.
- `src/transforms/uslm-to-ir.ts` currently expects `document.uslm.title`; current OLRC XML places the title under `document.uscDoc.main.title` and includes a namespace.
- `src/index.ts` still enforces integer-only `transform --title <1..54>` input. Appendix-title CLI support is not part of this issue.
- Existing tests already cover OLRC source behavior and XML parsing in `tests/unit/sources/olrc.test.ts`, `tests/unit/transforms/uslm-to-ir.test.ts`, and the adversary suite; this work must extend those suites with committed fixtures or mocks rather than rely on live outbound access.

## Acceptance Criteria

### 1. Releasepoint discovery and authenticated OLRC fetch flow
- [ ] `fetchOlrcVintagePlan()` in `src/sources/olrc.ts` requests `https://uscode.house.gov/download/download.shtml`, extracts releasepoint ZIP links matching `releasepoints/us/pl/{congress}/{law}/xml_usc{title}@{congress}-{law}.zip`, ignores appendix-title ZIPs and malformed links, and selects the newest vintage using the existing `compareVintageDescending()` ordering.
  <!-- Touches: src/sources/olrc.ts, tests/unit/sources/olrc.test.ts -->
- [ ] `fetchWithRetry()` performs a bootstrap request to `https://uscode.house.gov/`, captures the session cookie value(s) required by OLRC, and includes a `Cookie` header on every subsequent OLRC listing or ZIP request issued during the same fetch operation.
  <!-- Touches: src/sources/olrc.ts, tests/unit/sources/olrc.test.ts -->
- [ ] When bootstrap, listing, and ZIP retrieval succeed, `fetchOlrcSource({ force: false })` downloads every available numeric title ZIP for the selected vintage without requiring `scripts/download-olrc.sh`, writes the ZIP plus extracted XML into the existing cache layout, and records `selected_vintage` in `manifest.sources.olrc.selected_vintage`.
  <!-- Touches: src/sources/olrc.ts, src/utils/manifest.ts, tests/unit/sources/olrc.test.ts -->
- [ ] When the selected vintage returns a reserved-empty/non-ZIP response for Title 53, `fetchOlrcSource()` returns `ok: true`, preserves successfully downloaded numeric titles, does not store an unreadable Title 53 ZIP artifact, and records the Title 53 skip in a machine-readable manifest field or manifest substructure that distinguishes `reserved_empty` from transport failure.
  <!-- Touches: src/sources/olrc.ts, src/utils/manifest.ts, tests/unit/sources/olrc.test.ts -->
- [ ] If homepage bootstrap fails, listing fetch fails, or any non-Title-53 title ZIP request returns non-2xx, unreadable ZIP, HTML/non-ZIP payload, or retry exhaustion, the OLRC fetch result returns `ok: false`, preserves already cached successful titles, and emits an error message containing the failing URL and title number when a title-specific request failed.
  <!-- Touches: src/sources/olrc.ts, src/commands/fetch.ts, tests/unit/sources/olrc.test.ts -->

### 2. ZIP extraction limits and current-format XML parsing
- [ ] `extractXmlEntriesFromZip()` accepts a fixture representing the current large Title 42 XML entry without throwing `XML extraction exceeds size limits`; this may be satisfied by increasing `MAX_XML_ENTRY_BYTES`, introducing a streamed extraction path, or both, as long as the fixture extracts completely without truncation.
  <!-- Touches: src/sources/olrc.ts, tests/unit/sources/olrc.test.ts, tests/fixtures/** -->
- [ ] `parseUslmToIr()` in `src/transforms/uslm-to-ir.ts` parses both legacy `<uslm><title>...</title></uslm>` XML and current `<uscDoc xmlns="http://xml.house.gov/schemas/uslm/1.0"><main><title>...</title></main></uscDoc>` XML into the existing `TitleIR` structure.
  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/unit/transforms/uslm-to-ir.test.ts, tests/fixtures/** -->
- [ ] The XML parser configuration tolerates or strips current OLRC namespace qualification so callers can pass the raw XML string directly; no caller-side namespace pre-processing is required before calling `parseUslmToIr()`.
  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/unit/transforms/uslm-to-ir.test.ts -->
- [ ] For a committed current-format Title 1 fixture containing 53 `<section>` elements, `parseUslmToIr()` returns `titleIr.sections.length === 53`, preserves section identifiers as strings, and does not emit `INVALID_XML` solely because the root element is `uscDoc`.
  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/unit/transforms/uslm-to-ir.test.ts, tests/fixtures/** -->
- [ ] Existing legacy fixtures under `tests/fixtures/xml/` continue to pass unchanged after the parser update.
  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/unit/transforms/uslm-to-ir.test.ts -->

### 3. CLI transform behavior against current OLRC cache data
- [ ] Given a cached current-format OLRC ZIP for Title 1, `npx us-code-tools transform --title 1 --output <dir>` exits with status `0`, writes `_title.md` plus at least one section markdown file, and reports `sections_found > 0` in the final JSON report.
  <!-- Touches: src/index.ts, src/sources/olrc.ts, src/transforms/uslm-to-ir.ts, src/transforms/write-output.ts, tests/integration/** -->
- [ ] Given fixture-backed cached ZIPs for every numeric title except 53, a deterministic integration test can transform titles `1..54` and observes: titles `1..52` and `54` exit `0` and write at least one section file, while title `53` exits non-zero with an explicit reserved-empty/non-zip diagnostic such as `no XML entries`, `not a zip`, or another implementation-defined message asserted by the test.
  <!-- Touches: src/index.ts, src/sources/olrc.ts, tests/integration/** -->
- [ ] The integer-only CLI contract remains unchanged in `src/index.ts`: `transform --title 5a`, `11a`, `18a`, `28a`, and `50a` still fail validation with a non-zero exit code and the existing integer-range guidance.
  <!-- Touches: src/index.ts, tests/integration/**, tests/unit/** -->

### 4. Regression coverage and execution constraints
- [ ] The default `npm test` suite includes committed fixtures or mocks covering: cookie bootstrap plus authenticated follow-on request, `download.shtml` listing parsing, current-format `uscDoc` parsing, legacy `uslm` compatibility, Title 42 large-entry extraction, and Title 53 reserved-empty handling, and the suite passes without live outbound access to `uscode.house.gov`.
  <!-- Touches: tests/unit/sources/olrc.test.ts, tests/unit/transforms/uslm-to-ir.test.ts, tests/integration/**, tests/fixtures/**, package.json -->

### Non-Functional
- [ ] Performance: fixture-driven `transform --title 1` completes within 10 seconds on CI-class hardware with no network access.
- [ ] Security: OLRC session cookies are stored in memory only for the active fetch operation and are not written into manifest JSON, logs, cache metadata, or generated markdown output.

## Out of Scope
- Appendix-title CLI support (`5a`, `11a`, `18a`, `28a`, `50a`)
- Changes to markdown schema or output layout
- Non-OLRC source changes (`congress`, `govinfo`, `voteview`, `legislators`)
- Sync/diff/git automation beyond fetch/transform compatibility
- Any attempt to render or recover content from OLRC HTML error pages beyond detecting and classifying them as reserved-empty or fetch failures

## Dependencies
- `https://uscode.house.gov/`
- `https://uscode.house.gov/download/download.shtml`
- Existing TypeScript, Node.js, Vitest, `fast-xml-parser`, and `yauzl` stack
- Committed XML/ZIP fixtures under `tests/fixtures/`

## Acceptance Tests (human-readable)
1. Stub the OLRC homepage to return `Set-Cookie: JSESSIONID=...` and verify the next request to `download.shtml` includes a `Cookie` header.
2. Stub `download.shtml` with multiple releasepoint vintages and verify the newest numeric vintage is selected.
3. Stub successful title ZIP downloads for numeric titles and verify `fetchOlrcSource()` writes the selected vintage plus extracted XML into the cache and updates `manifest.sources.olrc.selected_vintage`.
4. Stub Title 53 as an HTML payload or unreadable ZIP and verify the fetch still returns `ok: true`, skips caching Title 53, and records a machine-readable `reserved_empty`-style skip state.
5. Stub a non-Title-53 title download failure and verify the fetch result returns `ok: false` with the title number and URL in the error message.
6. Run the parser against a legacy `<uslm>` fixture and a current `<uscDoc>` fixture and verify both produce non-empty `titleIr.sections` arrays.
7. Run the parser against a current-format Title 1 fixture with 53 sections and verify `titleIr.sections.length === 53`.
8. Run extraction against a large-entry Title 42 fixture and verify no size-limit exception is thrown.
9. Seed the cache with a current-format Title 1 ZIP fixture and run `npx us-code-tools transform --title 1 --output ./out`; verify `_title.md`, section files, and `sections_found > 0` in the JSON report.
10. Run `npx us-code-tools transform --title 5a --output ./out` and verify the CLI rejects the argument with the existing integer-only validation error.

## Edge Case Catalog
- **Cookie bootstrap:** multiple `Set-Cookie` headers, cookie refresh on retry, bootstrap `200` without `Set-Cookie`, and bootstrap succeeding while later requests still fail.
- **Listing parsing:** relative vs absolute links, duplicate title links, appendix-title links adjacent to numeric titles, malformed `xml_usc` links, and multiple vintages in one page.
- **ZIP payloads:** HTML with `200 OK`, truncated ZIP, zero-byte ZIP, non-ZIP binary body, nested XML paths, multiple XML files per title ZIP, and very large uncompressed XML entries.
- **XML structure:** namespace-qualified tags, BOM-prefixed XML, `<uscDoc>` with `<meta>` but missing `<main>`, `<main>` missing `<title>`, sections directly under `<title>`, and sections nested under `<chapter>`.
- **Section content:** alphanumeric section identifiers, missing section numbers, empty headings, duplicate section numbers across XML files, and mixed text/xref nodes in notes or cross-references.
- **Failure and recovery:** some titles cached before a later title fails, rerun after transient network failure, Title 53 reserved-empty while other titles succeed, and cached valid ZIP reuse after a partial prior run.
- **Input validation:** malformed `--title` values (`0`, `55`, `5a`, empty string, duplicates), partial CLI inputs, truncated XML, and invalid UTF-8/BOM edge cases in fixtures.

## Verification Strategy
- **Pure core:** releasepoint-link extraction, vintage selection, XML root discovery, namespace normalization, and reserved-empty vs hard-failure classification should be isolated into pure or near-pure helpers with fixture-driven tests.
- **Properties:**
  - Section identifiers remain strings for all parsed XML inputs.
  - Equivalent legacy/current fixtures produce equivalent `TitleIR` semantics for chapter count, section count, and section ordering.
  - Title 53 reserved-empty responses never create cached unreadable ZIP artifacts.
  - Session cookies never appear in manifest JSON, log output, or markdown output.
- **Purity boundary:** HTTP, response-header capture, ZIP reads, filesystem writes, and CLI stdout/stderr are the effectful shell; listing parsing, namespace handling, and result classification should remain testable without I/O.

## Infrastructure Requirements
- **Database:** None.
- **API endpoints:** None.
- **Infrastructure:** Existing local filesystem cache and manifest only; no new services.
- **Environment variables / secrets:** No new environment variables or secrets; OLRC session cookies are acquired dynamically per fetch run.

## Complexity Estimate
L

Reason: the change spans the OLRC client, cache/extraction path, XML parser, CLI transform flow, manifest state, and offline test coverage.

## Required Skills
- TypeScript
- Node.js
- HTTP header/cookie handling
- XML parsing
- ZIP extraction
- Vitest
- CLI/integration testing
