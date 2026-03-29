## [spec-writer] — Initial spec drafted
See `docs/specs/10-spec.md` for the canonical spec.

# Prefer `<num @value>` in USLM parsing and add XSD-contract coverage

## Summary
Update the USLM-to-IR transform so title, chapter, and section numbers use the canonical `@value` attribute on `<num>` elements when present, fall back to decorated text content only when the attribute is absent or empty, and add fixture-backed tests that prove the parser matches the USLM XSD contract for current OLRC `uscDoc` XML without breaking legacy `uslm` inputs.

## Context
- `src/transforms/uslm-to-ir.ts` currently derives title, chapter, and section numbers from normalized `<num>` text content via `readNormalizedText(...)`.
- Current OLRC XML stores decorated display text inside `<num>` (for example `§ 1.` or `Title 1—`) and stores the machine-readable number in `@value`.
- The parser already uses `fast-xml-parser` with `ignoreAttributes: false`, `attributeNamePrefix: '@_'`, and `removeNSPrefix: true`, so `value` attributes should be readable as `node['@_value']` on parsed nodes.
- Existing parser coverage lives in `tests/unit/transforms/uslm-to-ir.test.ts`, existing CLI transform coverage lives in `tests/integration/transform-cli.test.ts`, and current OLRC compatibility tests already use a committed `04-current-uscdoc.xml` fixture.
- The spec must preserve backward compatibility with legacy XML fixtures under `tests/fixtures/xml/title-01/` and must not require runtime XSD validation.

## Acceptance Criteria

### 1. Canonical `<num>` extraction in the parser
- [ ] `src/transforms/uslm-to-ir.ts` introduces a shared helper for `<num>` extraction that returns `node['@_value']` when that attribute exists and normalizes to a non-empty string, and otherwise falls back to normalized text-content extraction.
  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/unit/transforms/uslm-to-ir.test.ts -->
- [ ] The parser uses that helper for all title, chapter, and section number reads that currently come from `titleNode.num`, `chapter.num`, and `sectionNode.num`, so `parseUslmToIr()` returns `titleIr.titleNumber === 1`, `titleIr.chapters[0].number === '1'` when the fixture exposes `@value="1"`, and `titleIr.sections[0].sectionNumber === '1'` for the first section in a current OLRC fixture.
  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/unit/transforms/uslm-to-ir.test.ts -->
- [ ] The fallback path strips leading section/title decoration and trailing punctuation used only for display formatting before returning the number string: at minimum leading `§`, leading `Title `, trailing `.`, trailing `—`, and surrounding whitespace are removed from fallback text content.
  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/unit/transforms/uslm-to-ir.test.ts -->
- [ ] If `@value` is present but normalizes to an empty string, the parser behaves identically to the absent-attribute case and uses the cleaned text content instead of returning an empty number.
  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/unit/transforms/uslm-to-ir.test.ts -->

### 2. XSD-contract parser tests
- [ ] `tests/unit/transforms/uslm-to-ir.test.ts` adds fixture-backed or inline XML tests for these `<num>` contract cases: `@value` present and decorated text content also present, `@value` absent and decorated text content only, and `@value` present but empty; each test asserts the parsed title/chapter/section number equals the canonical clean value expected by the XSD contract.
  <!-- Touches: tests/unit/transforms/uslm-to-ir.test.ts, tests/fixtures/xml/title-01/* -->
- [ ] The current `uscDoc` fixture coverage is extended so every parsed section number taken from `04-current-uscdoc.xml` matches the corresponding source `<num @value>` and no `MISSING_SECTION_NUMBER` error is emitted for sections whose `@value` is populated.
  <!-- Touches: tests/unit/transforms/uslm-to-ir.test.ts, tests/fixtures/xml/title-01/04-current-uscdoc.xml -->
- [ ] A structural conformance test reads the committed current-format Title 1 fixture and asserts all of the following about the source XML itself: root element is `uscDoc`; it contains `meta` and `main`; section identifiers match `/us/usc/t1/s{...}` for all section nodes; each section/chapter/title node under test has a `<num>` sibling followed by `<heading>`; and sampled `<num>` nodes contain decorated display text while `@value` contains the undecorated machine-readable value.
  <!-- Touches: tests/unit/transforms/uslm-to-ir.test.ts, tests/fixtures/xml/title-01/04-current-uscdoc.xml, docs/schemas/USLM-1.0.15.xsd -->
- [ ] Existing legacy parser tests for `01-base.xml` and `02-more.xml` continue to pass without changing their fixture shape, proving backward compatibility when `<num @value>` is missing.
  <!-- Touches: tests/unit/transforms/uslm-to-ir.test.ts -->

### 3. Real-fixture transform regressions
- [ ] `tests/integration/transform-cli.test.ts` verifies that a selected-vintage cache seeded with the committed current-format Title 1 fixture produces exit code `0`, writes `out/uscode/title-01/_title.md`, writes exactly 53 section markdown files, and reports `sections_found === 53` in the emitted JSON report.
  <!-- Touches: tests/integration/transform-cli.test.ts, tests/fixtures/xml/title-01/04-current-uscdoc.xml -->
- [ ] The fixture-backed multi-title transform test for titles `1..54` excluding `53` continues to pass with current-format `uscDoc` inputs, and title `53` continues to produce the reserved-empty diagnostic already covered by the integration suite.
  <!-- Touches: tests/integration/transform-cli.test.ts -->
- [ ] A regression assertion in the CLI integration suite proves decorated display text does not leak into filesystem output names by asserting the Title 1 run writes `title-01` and `section-1.md` and does not write any path containing `§`, `Title-1`, `—`, or `..md`.
  <!-- Touches: tests/integration/transform-cli.test.ts -->

### Non-Functional
- [ ] Performance: the added parser logic and tests do not introduce any live network dependency; `npm test` remains fully fixture-backed and deterministic.
- [ ] Security: the change reads XML attributes already present in committed or cached inputs and does not add any new external requests, secrets, or persisted metadata fields.

## Out of Scope
- Runtime XSD schema validation during `parseUslmToIr()`.
- Appendix title support such as `5a`, `11a`, `18a`, `28a`, or `50a`.
- Changes to markdown schema/content rendering beyond corrected numeric identifiers.
- Broader rich-text conversion changes inside `<content>` bodies.
- Changes to OLRC fetch behavior, releasepoint discovery, or cookie handling already covered by earlier specs.

## Dependencies
- `src/transforms/uslm-to-ir.ts`
- `tests/unit/transforms/uslm-to-ir.test.ts`
- `tests/integration/transform-cli.test.ts`
- `tests/fixtures/xml/title-01/04-current-uscdoc.xml`
- `docs/schemas/USLM-1.0.15.xsd`
- Existing `fast-xml-parser` configuration in `package.json`

## Acceptance Tests (human-readable)
1. Run the unit parser suite against inline XML where `<section><num value="1">§ 1.</num></section>` and verify the parsed section number is `1`.
2. Run the unit parser suite against inline XML where `<section><num>§ 1.</num></section>` and verify the parsed section number still resolves to `1` via fallback stripping.
3. Run the unit parser suite against inline XML where `<section><num value="">§ 1.</num></section>` and verify the parsed section number resolves to `1` via fallback stripping.
4. Run the parser against `tests/fixtures/xml/title-01/04-current-uscdoc.xml` and verify `titleIr.titleNumber === 1`, `titleIr.sections.length === 53`, and each parsed section number matches the source `<num @value>`.
5. Inspect the same fixture in a structural test and verify `uscDoc > meta + main`, section identifiers use `/us/usc/t1/s...`, `<heading>` follows `<num>`, and decorated `<num>` text differs from clean `@value`.
6. Run the existing legacy fixture tests for `01-base.xml` and `02-more.xml` and verify they still pass unchanged.
7. Run the CLI integration test with the selected-vintage Title 1 cache fixture and verify `_title.md`, 53 `section-*.md` files, `sections_found === 53`, and no decorated characters in output paths.
8. Run the matrix integration test for titles `1..54` and verify titles `1..52` and `54` still succeed while title `53` still fails with the reserved-empty diagnostic.

## Edge Case Catalog
- **Attribute-state edges:** `@value` missing, `@value` empty string, `@value` whitespace-only, `@value` numeric string, and decorated text content that disagrees with `@value`.
- **Decoration edges:** leading `§`, title prefixes like `Title 1`, trailing `.` or `—`, multiple surrounding spaces, and mixed decoration such as `§ 1.—`.
- **Legacy compatibility:** old fixtures with no attributes on `<num>`, sections nested directly under `<title>`, sections nested under `<chapter>`, and alphanumeric section numbers like `2/3` or `36B`.
- **Malformed/partial XML:** missing `<num>`, `<num>` present but empty, `<heading>` missing, truncated XML, unclosed tags, and BOM-prefixed XML.
- **Encoding issues:** invalid UTF-8 replacement characters, namespace-qualified tags, mixed whitespace, and entity-decoded punctuation in `<num>` text.
- **Filesystem regression edges:** section numbers used in filenames must remain URL/path-safe when display text contains punctuation, prefixes, or doubled periods.
- **Degraded behavior:** if parser fallback still cannot derive a section number, existing `MISSING_SECTION_NUMBER` behavior remains in place and the bad section is omitted rather than producing a malformed filename.

## Verification Strategy
- **Pure core:** number extraction from `<num>` nodes, cleanup of decorated fallback text, and title-number parsing should be isolated into pure helpers that accept parsed node values and return normalized strings/numbers.
- **Properties:**
  - When `@value` is non-empty, parsed title/chapter/section numbers equal `@value` exactly after whitespace normalization.
  - When `@value` is absent or empty, parsed numbers equal fallback text after deterministic decoration stripping.
  - Decorated display text never appears in generated title directory or section markdown filenames.
  - Legacy fixtures without `@value` continue to produce the same `TitleIR` semantics as before.
- **Purity boundary:** XML parsing, ZIP extraction, and filesystem writes remain the effectful shell; `<num>` value selection, fallback cleanup, and number coercion remain unit-testable logic.

## Infrastructure Requirements
- **Database:** None.
- **API endpoints:** None.
- **Infrastructure:** Existing fixture files and current Vitest integration harness only.
- **Environment variables / secrets:** None.

## Complexity Estimate
M

Reason: this is localized to the parser plus fixture-backed unit/integration coverage, but it touches both canonical parsing behavior and CLI output regression tests.

## Required Skills
- TypeScript
- XML parsing
- Vitest
- CLI/integration testing
- Regression test design
