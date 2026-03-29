## [spec-writer] — Initial spec drafted
See `docs/specs/10-spec.md` for the canonical spec.

# Prefer `<num @value>` in USLM parsing and add XSD-contract coverage

## Summary
Update the USLM-to-IR transform so title, chapter, and section numbers use the canonical `@value` attribute on `<num>` elements when present, fall back to cleaned display text only when the attribute is absent or empty, and add fixture-backed parser and CLI coverage that proves the parser matches the USLM XSD contract for current OLRC `uscDoc` XML without breaking legacy `uslm` inputs.

## Context
- `src/transforms/uslm-to-ir.ts` currently derives title, chapter, and section numbers from `<num>` text content via `readNormalizedText(...)` and `parseTitleNumber(...)`.
- The parser already uses `fast-xml-parser` with `ignoreAttributes: false`, `attributeNamePrefix: '@_'`, and `removeNSPrefix: true`, so `<num value="1">` should be readable as `node['@_value'] === '1'`.
- The currently committed `tests/fixtures/xml/title-01/04-current-uscdoc.xml` fixture is a simplified `uscDoc` sample: it proves namespace/root handling and 53-section coverage today, but it does **not** yet model the XSD contract described in this issue because its `<num>` elements have plain text only and its section identifiers use `USC-prelim-title1-section...` instead of `/us/usc/t1/s...`.
- Existing parser coverage lives in `tests/unit/transforms/uslm-to-ir.test.ts`, existing CLI transform coverage lives in `tests/integration/transform-cli.test.ts`, and current OLRC compatibility tests already depend on the committed Title 1 fixture.
- The change must remain fully fixture-backed and must not add runtime XSD validation, network access, or any appendix-title support.

## Acceptance Criteria

### 1. Parser number extraction
- [ ] `src/transforms/uslm-to-ir.ts` introduces a shared pure helper for title/chapter/section `<num>` nodes that returns `normalizeWhitespace(node['@_value'])` when that attribute exists and is non-empty, and otherwise falls back to cleaned text-content extraction.
  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/unit/transforms/uslm-to-ir.test.ts -->
- [ ] The parser uses that helper for every title, chapter, and section number read that currently comes from `titleNode.num`, `chapter.num`, and `sectionNode.num`, so `parseUslmToIr()` can derive `1` from `<num value="1">Title 1—</num>`, `1` from `<num value="1">Chapter 1—</num>`, and `1` from `<num value="1">§ 1.</num>`.
  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/unit/transforms/uslm-to-ir.test.ts -->
- [ ] The fallback path strips display-only decoration before returning a number string: at minimum leading `§`, leading `Title `, leading `Chapter `, trailing `.`, trailing `—`, and surrounding whitespace are removed; alphanumeric or symbolic bodies such as `2/3` and `36B` remain intact after cleanup.
  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/unit/transforms/uslm-to-ir.test.ts -->
- [ ] If `@value` is present but normalizes to an empty or whitespace-only string, the parser behaves identically to the absent-attribute case and uses cleaned text content instead of emitting an empty number.
  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/unit/transforms/uslm-to-ir.test.ts -->

### 2. Fixture and unit-test contract coverage
- [ ] `tests/fixtures/xml/title-01/04-current-uscdoc.xml` is replaced or refreshed with a fixture that models the current OLRC/XSD contract: `uscDoc > meta + main`, `<title identifier="/us/usc/t1">`, at least one chapter with `/us/usc/t1/ch...`, 53 section nodes with identifiers matching `/us/usc/t1/s...`, decorated `<num>` text, and canonical clean `@value` attributes on title/chapter/section `<num>` elements.
  <!-- Touches: tests/fixtures/xml/title-01/04-current-uscdoc.xml, tests/unit/transforms/uslm-to-ir.test.ts, tests/integration/transform-cli.test.ts -->
- [ ] `tests/unit/transforms/uslm-to-ir.test.ts` adds mechanically testable `<num>` contract cases for: (a) `@value` present with decorated text, (b) `@value` absent with decorated text only, and (c) `@value` present-but-empty with decorated text; each case asserts the parsed title/chapter/section number equals the expected clean value.
  <!-- Touches: tests/unit/transforms/uslm-to-ir.test.ts -->
- [ ] The refreshed `uscDoc` fixture coverage asserts all of the following in unit tests: parsed `titleIr.titleNumber === 1`; parsed chapter numbers equal the source `<num @value>` values; parsed section count is exactly 53; every parsed section number equals the corresponding source `<section><num @value>` value; and populated sections do not emit `MISSING_SECTION_NUMBER`.
  <!-- Touches: tests/unit/transforms/uslm-to-ir.test.ts, tests/fixtures/xml/title-01/04-current-uscdoc.xml -->
- [ ] A structural conformance test inspects the refreshed fixture source and asserts: root element is `uscDoc`; it contains both `meta` and `main`; title/chapter/section nodes under test contain `<num>` immediately followed by `<heading>`; section identifiers match `/us/usc/t1/s[^\"]+/`; and sampled `<num>` nodes have decorated display text that differs from the clean `@value` string.
  <!-- Touches: tests/unit/transforms/uslm-to-ir.test.ts, tests/fixtures/xml/title-01/04-current-uscdoc.xml, docs/schemas/USLM-1.0.15.xsd -->
- [ ] Existing legacy parser tests for `01-base.xml` and `02-more.xml` continue to pass without changing those fixture shapes, proving backward compatibility when `<num @value>` is absent.
  <!-- Touches: tests/unit/transforms/uslm-to-ir.test.ts -->

### 3. CLI and filesystem regressions
- [ ] `tests/integration/transform-cli.test.ts` verifies that a selected-vintage cache seeded with the refreshed current-format Title 1 fixture produces exit code `0`, writes `out/uscode/title-01/_title.md`, writes exactly 53 section markdown files, and reports `sections_found === 53` in the emitted JSON report.
  <!-- Touches: tests/integration/transform-cli.test.ts, tests/fixtures/xml/title-01/04-current-uscdoc.xml -->
- [ ] The fixture-backed multi-title transform test for titles `1..54` excluding `53` continues to pass with current-format `uscDoc` inputs, and title `53` continues to surface the reserved-empty diagnostic already covered by the integration suite.
  <!-- Touches: tests/integration/transform-cli.test.ts -->
- [ ] The CLI integration suite adds a regression assertion that output paths do not contain decorated display text by verifying the Title 1 run writes `title-01` and `section-1.md`, and writes no generated path containing `§`, `Title-1`, `Chapter-1`, `—`, or `..md`.
  <!-- Touches: tests/integration/transform-cli.test.ts -->

### Non-Functional
- [ ] Performance: `npm test` remains deterministic and fully fixture-backed; no acceptance test requires live OLRC downloads or runtime schema validation.
- [ ] Security: the change reads XML attributes already present in committed or cached fixtures and does not add any new external requests, secrets, or persisted metadata fields.

## Out of Scope
- Runtime XSD schema validation during `parseUslmToIr()`.
- Appendix title support such as `5a`, `11a`, `18a`, `28a`, or `50a`.
- Rich-text/content rendering changes beyond corrected numeric identifier extraction.
- OLRC fetch/discovery, releasepoint selection, or cache-manifest behavior beyond using the existing fixture-backed test harness.

## Dependencies
- `src/transforms/uslm-to-ir.ts`
- `tests/unit/transforms/uslm-to-ir.test.ts`
- `tests/integration/transform-cli.test.ts`
- `tests/fixtures/xml/title-01/04-current-uscdoc.xml`
- `docs/schemas/USLM-1.0.15.xsd`
- Existing `fast-xml-parser` configuration in `package.json`

## Acceptance Tests (human-readable)
1. Parse inline XML containing `<title><num value="1">Title 1—</num></title>` and verify the parsed title number is `1`.
2. Parse inline XML containing `<chapter><num value="1">Chapter 1—</num></chapter>` and verify the parsed chapter number is `1`.
3. Parse inline XML containing `<section><num value="1">§ 1.</num></section>` and verify the parsed section number is `1`.
4. Parse inline XML containing `<section><num>§ 1.</num></section>` and verify fallback stripping still yields `1`.
5. Parse inline XML containing `<section><num value="   ">§ 1.</num></section>` and verify fallback stripping still yields `1`.
6. Run the parser against the refreshed `tests/fixtures/xml/title-01/04-current-uscdoc.xml` and verify title number `1`, exactly 53 sections, and per-section numbers equal source `<num @value>` values.
7. Inspect the same fixture in a structural test and verify `uscDoc > meta + main`, section identifiers use `/us/usc/t1/s...`, `<heading>` follows `<num>`, and decorated `<num>` text differs from clean `@value`.
8. Run the existing legacy fixture tests for `01-base.xml` and `02-more.xml` and verify they still pass unchanged.
9. Run the selected-vintage Title 1 CLI fixture test and verify `_title.md`, 53 `section-*.md` files, `sections_found === 53`, and no decorated characters in generated output paths.
10. Run the title-matrix integration test and verify titles `1..52` and `54` still succeed while title `53` still fails with the reserved-empty diagnostic.

## Edge Case Catalog
- **Attribute-state edges:** `@value` missing, empty string, whitespace-only, or disagreeing with decorated text.
- **Decoration edges:** `§ 1.`, `Title 1—`, `Chapter 1—`, extra spaces, doubled punctuation, and mixed decoration such as `§ 1.—`.
- **Legacy compatibility:** old fixtures with no attributes on `<num>`, sections nested directly under `<title>`, sections nested under `<chapter>`, and alphanumeric section numbers like `2/3` and `36B`.
- **Malformed/partial XML:** missing `<num>`, `<num>` present but empty, missing `<heading>`, truncated XML, unclosed tags, and BOM-prefixed XML.
- **Encoding issues:** namespace-qualified tags, mixed whitespace, entity-decoded punctuation, and invalid replacement characters in text content.
- **Filesystem regression edges:** generated directory/file names must remain path-safe even when display `<num>` text contains punctuation, prefixes, or repeated periods.
- **Degraded behavior:** if both `@value` and cleaned fallback text are empty, existing `MISSING_SECTION_NUMBER` behavior remains in place and the section is omitted rather than producing a malformed identifier or filename.

## Verification Strategy
- **Pure core:** `<num>` value selection, decoration stripping, and title-number coercion should be isolated into pure helpers that accept parsed node values and return normalized strings/numbers.
- **Properties:**
  - When `@value` is non-empty, parsed title/chapter/section numbers equal `@value` after whitespace normalization.
  - When `@value` is absent or empty, parsed numbers equal fallback text after deterministic decoration stripping.
  - Decorated display text never appears in generated title directories or section markdown filenames.
  - Legacy fixtures without `@value` continue to produce the same `TitleIR` semantics as before.
- **Purity boundary:** XML parsing and filesystem writes remain the effectful shell; `<num>` extraction, cleanup, and coercion remain unit-testable logic.

## Infrastructure Requirements
- **Database:** None.
- **API endpoints:** None.
- **Infrastructure:** Existing fixture files and current Vitest integration harness only.
- **Environment variables / secrets:** None.

## Complexity Estimate
M

Reason: the implementation stays localized to one parser module plus one refreshed XML fixture and the existing unit/integration suites, but it changes canonical number extraction behavior and adds contract-level regression coverage.

## Required Skills
- TypeScript
- XML parsing
- Vitest
- CLI/integration testing
- Regression test design
