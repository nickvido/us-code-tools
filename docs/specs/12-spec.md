## [spec-writer] — Initial spec drafted
See `docs/specs/12-spec.md` for the canonical spec.

# Transform zero-padded section filenames, rich metadata, and recursive hierarchy support

## Summary
Update the OLRC transform pipeline so current USLM/uscDoc titles with deep positive-law hierarchy produce complete markdown output, section filenames sort correctly on disk, and section markdown preserves statutory provenance and notes from the source XML. The change must remain offline-testable with committed fixtures, keep the existing title-level output layout, and prove full coverage across all 53 non-reserved numeric titles.

## Context
- `src/transforms/uslm-to-ir.ts` currently collects sections only from `title.section` and `title.chapter.section`, so titles whose sections live under `subtitle`, `part`, `subpart`, or `subchapter` produce zero transformed sections.
- `src/domain/model.ts` and `src/transforms/markdown.ts` currently preserve `sourceCredits`/`editorialNotes` from legacy note parsing, but they do not model the current `sourceCredit` + `notes` structure described in this issue, and they do not preserve hierarchy path metadata per section.
- `src/transforms/write-output.ts` currently writes section files as `section-${sectionFileSafeId(sectionId)}.md`, which breaks lexicographic ordering for mixed-width numeric identifiers.
- `src/transforms/markdown.ts` currently renders `_title.md` section bullets in parser order and renders section notes as a generic `## Notes` list without a statutory-notes section or cross-reference link semantics.
- Existing coverage already lives in `tests/unit/transforms/uslm-to-ir.test.ts`, `tests/unit/transforms/markdown.test.ts`, `tests/unit/transforms/write-output.test.ts`, and `tests/integration/transform-cli.test.ts`; this issue should extend those suites with committed fixtures and deterministic generated fixtures rather than live network access.
- The integer-only title CLI contract in `src/index.ts` remains in scope as-is; appendix titles such as `5a` are not part of this work.

## Acceptance Criteria

### 1. Recursive hierarchy extraction
- [ ] `src/transforms/uslm-to-ir.ts` replaces the fixed `title → chapter → section` traversal with a recursive walk that discovers `<section>` nodes at any nesting depth beneath `<title>`, including at minimum `subtitle`, `part`, `subpart`, `chapter`, and `subchapter` containers.
  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/unit/transforms/uslm-to-ir.test.ts -->
- [ ] For every discovered section, the parser emits a stable hierarchy-path object on `SectionIR` containing each encountered structural level from the set `{ subtitle, part, subpart, chapter, subchapter }`; omitted levels remain absent rather than empty strings.
  <!-- Touches: src/domain/model.ts, src/transforms/uslm-to-ir.ts, src/transforms/markdown.ts, tests/unit/transforms/uslm-to-ir.test.ts, tests/unit/transforms/markdown.test.ts -->
- [ ] Fixture-backed parser tests for Title 1, Title 5, Title 10, and Title 26 assert the parsed section count exactly equals the source XML `<section>` element count for each fixture and that no section is dropped solely because it is nested deeper than one chapter level.
  <!-- Touches: tests/fixtures/xml/**, tests/unit/transforms/uslm-to-ir.test.ts -->
- [ ] The selected-vintage integration matrix in `tests/integration/transform-cli.test.ts` (or a successor deterministic transform integration test) proves all numeric titles `1..52` and `54` exit `0`, while reserved-empty title `53` continues to return the existing non-success diagnostic path.
  <!-- Touches: tests/integration/transform-cli.test.ts -->

### 2. Section metadata extraction and markdown rendering
- [ ] `SectionIR` gains a singular `sourceCredit` field for the normalized contents of `<sourceCredit>` when present, and section markdown frontmatter serializes it as `source_credit:`; sections without `<sourceCredit>` omit that frontmatter key.
  <!-- Touches: src/domain/model.ts, src/transforms/uslm-to-ir.ts, src/transforms/markdown.ts, tests/unit/transforms/uslm-to-ir.test.ts, tests/unit/transforms/markdown.test.ts -->
- [ ] Section-level `<notes>` content is parsed into a dedicated statutory-notes structure that preserves note order and note topic/type metadata needed for rendering; markdown output renders those notes under a `## Statutory Notes` heading placed after the main section body.
  <!-- Touches: src/domain/model.ts, src/transforms/uslm-to-ir.ts, src/transforms/markdown.ts, tests/unit/transforms/uslm-to-ir.test.ts, tests/unit/transforms/markdown.test.ts -->
- [ ] `<ref>` elements inside section content or statutory notes render as markdown links: references whose identifiers match `/us/usc/t{title}/s{section}` are emitted as relative links to the generated target section file within the repository output tree, and references without a transformable USC section target fall back to plain normalized text with no broken markdown link syntax.
  <!-- Touches: src/transforms/uslm-to-ir.ts, src/transforms/markdown.ts, src/transforms/write-output.ts, tests/unit/transforms/uslm-to-ir.test.ts, tests/unit/transforms/markdown.test.ts -->
- [ ] Fixture-backed metadata tests assert that every source `<section>` containing `<sourceCredit>` yields `source_credit` in frontmatter, every source `<section>` containing `<notes>` yields a rendered `## Statutory Notes` section, and rendered note/link order matches source XML order.
  <!-- Touches: tests/fixtures/xml/**, tests/unit/transforms/uslm-to-ir.test.ts, tests/unit/transforms/markdown.test.ts -->

### 3. Zero-padded filenames and ordering
- [ ] `src/transforms/write-output.ts` derives section filenames from a pure padding helper that left-pads the leading numeric portion of each section identifier to a fixed width of 5 digits, preserves any trailing alphanumeric suffix, and still normalizes `/` to `-`; examples that must pass unit tests: `1 → section-00001.md`, `101 → section-00101.md`, `1234 → section-01234.md`, `106a → section-00106a.md`, `7702B → section-07702B.md`, and `2/3 → section-00002-3.md`.
  <!-- Touches: src/domain/normalize.ts, src/transforms/write-output.ts, tests/unit/transforms/write-output.test.ts -->
- [ ] `_title.md` renders sections in ascending canonical section order determined by the same sort key used for filename padding (numeric portion first, then suffix tie-breaker), rather than raw parser discovery order; a fixture-backed markdown test must prove `1`, `2`, `10`, `106a`, `106b`, and `114` appear in that order.
  <!-- Touches: src/transforms/markdown.ts, src/transforms/write-output.ts, tests/unit/transforms/markdown.test.ts, tests/unit/transforms/write-output.test.ts -->
- [ ] A filesystem integration test proves that after transforming a fixture title containing mixed-width numeric and alphanumeric section identifiers, `readdirSync(...).sort()` for generated section files matches the canonical numeric section order with no unpadded `section-1.md`-style outputs remaining.
  <!-- Touches: tests/integration/transform-cli.test.ts, tests/unit/transforms/write-output.test.ts -->

### 4. Regression and full-run guarantees
- [ ] Existing transform/parser regression tests that cover legacy `uslm` input, current `uscDoc` input, path-safe filenames, and reserved-empty title handling continue to pass after this change without requiring live OLRC access.
  <!-- Touches: tests/unit/transforms/uslm-to-ir.test.ts, tests/unit/transforms/markdown.test.ts, tests/unit/transforms/write-output.test.ts, tests/integration/transform-cli.test.ts -->
- [ ] A deterministic acceptance test seeded from committed or generated OLRC fixtures validates that the transform pipeline writes at least one section file for each non-reserved numeric title and that the summed transformed section counts equal the summed source XML `<section>` counts for the same fixture set.
  <!-- Touches: tests/integration/transform-cli.test.ts, tests/fixtures/xml/** -->

### Non-Functional
- [ ] Performance: the full fixture-backed transform test suite for this issue runs under `npm test` with no live network access and no runtime XSD validation.
- [ ] Security: the change does not introduce new environment variables, secrets, outbound requests, or filesystem writes outside the existing output root and cache/test harness.

## Out of Scope
- Appendix-title support such as `5a`, `11a`, `18a`, `28a`, or `50a` at the CLI argument level.
- Changes to OLRC fetch/discovery, releasepoint selection, cookie/bootstrap handling, or reserved-empty classification beyond consuming the already cached ZIP/XML inputs used by transform tests.
- Runtime XSD validation against `docs/schemas/USLM-1.0.15.xsd`.
- Reformatting section prose beyond the metadata/note/link rendering required here.
- Cross-title link rewriting to absolute website URLs; only relative links into generated USC section markdown are required when the target is transformable.

## Dependencies
- `src/domain/model.ts`
- `src/domain/normalize.ts`
- `src/transforms/uslm-to-ir.ts`
- `src/transforms/markdown.ts`
- `src/transforms/write-output.ts`
- `tests/unit/transforms/uslm-to-ir.test.ts`
- `tests/unit/transforms/markdown.test.ts`
- `tests/unit/transforms/write-output.test.ts`
- `tests/integration/transform-cli.test.ts`
- Fixture XML under `tests/fixtures/xml/`

## Acceptance Tests (human-readable)
1. Parse a simple Title 1 fixture and verify the section count equals the number of `<section>` elements in the source XML.
2. Parse a Title 5 fixture whose sections are nested under `<part>` and verify the parser returns non-zero sections plus `part` metadata on each parsed section.
3. Parse a Title 10 fixture whose sections are nested under `<subtitle>` and verify the parser returns non-zero sections plus `subtitle` metadata on each parsed section.
4. Parse a Title 26 fixture with mixed `subtitle → part → chapter → section` nesting and verify section counts match source XML counts and path metadata includes every encountered hierarchy level.
5. Render a section that contains `<sourceCredit>` and verify markdown frontmatter includes `source_credit:` with the normalized source text.
6. Render a section that contains `<notes>` and verify markdown contains `## Statutory Notes` after the main content plus one rendered bullet/entry per parsed note in source order.
7. Render a note/content block containing `<ref identifier="/us/usc/t2/s285b">` and verify the output contains a relative markdown link to the generated section file for Title 2 §285b.
8. Derive filenames for `1`, `101`, `1234`, `106a`, `7702B`, and `2/3` and verify they equal `section-00001.md`, `section-00101.md`, `section-01234.md`, `section-00106a.md`, `section-07702B.md`, and `section-00002-3.md` respectively.
9. Transform a mixed-width fixture title and verify sorted directory listing order matches canonical section order and `_title.md` lists sections in the same order.
10. Run the selected-vintage transform matrix for numeric titles `1..54` and verify titles `1..52` and `54` succeed, title `53` retains its reserved-empty failure path, and non-reserved titles produce at least one section file.

## Edge Case Catalog
- **Hierarchy depth:** sections directly under `<title>`, under `<chapter>`, under `<part>`, under `<subtitle>`, and under mixed chains such as `subtitle → part → subpart → chapter → subchapter → section`.
- **Hierarchy metadata gaps:** some containers present without headings, repeated container numbers across different branches, and sections whose parent chain omits intermediate levels.
- **Section identifier shapes:** plain integers, letter suffixes (`106a`, `112b`, `7702B`), slash-separated identifiers (`2/3`), mixed case suffixes, and duplicate numeric roots with different suffixes.
- **Ordering boundaries:** `1`, `01`, `2`, `10`, `99`, `100`, `9999`, `10000`, and `99999`; suffix ordering for `106`, `106A`, `106a`, `106b`; and lexicographic-vs-numeric mismatches.
- **Metadata presence:** sections with `<sourceCredit>` only, `<notes>` only, both, neither, empty-note wrappers, multiple notes, and note topics such as `miscellaneous` and `crossReferences`.
- **Reference rendering:** `<ref>` with transformable USC targets, `<ref>` with missing/unknown identifiers, nested refs inside notes, refs whose display text differs from target identifier, and refs pointing to other titles.
- **Malformed/partial XML:** missing `<num>`, empty `<sourceCredit>`, notes with empty text, truncated XML, unclosed tags, BOM-prefixed files, and namespace-qualified tags.
- **Encoding/normalization:** mixed whitespace, entities, smart punctuation, invalid replacement characters, and identifiers/text with uppercase/lowercase suffix variations.
- **Degraded behavior:** when a section lacks a usable identifier it should still surface the existing parse error path rather than generating an invalid filename or broken link.

## Verification Strategy
- **Pure core:** hierarchy walking, hierarchy-path accumulation, section sort-key derivation, zero-padding/filename derivation, and USC reference-to-relative-link conversion should be pure helpers with direct unit coverage.
- **Properties:**
  - Every parsed section corresponds to exactly one source `<section>` node in the fixture under test.
  - All generated section filenames are path-safe and begin with `section-` followed by a 5-digit numeric root.
  - `_title.md` section order equals the canonical sort order derived from parsed section identifiers.
  - Sections with `<sourceCredit>` always emit `source_credit` frontmatter; sections without it never emit an empty key.
  - Relative markdown links are produced only for recognized USC section references; unrecognized refs never produce malformed `[]()` output.
- **Purity boundary:** XML parsing, ZIP extraction, and filesystem writes remain the effectful shell; hierarchy discovery, metadata normalization, sort-key derivation, and markdown rendering decisions remain unit-testable logic.

## Infrastructure Requirements
- **Database:** None.
- **API endpoints:** None.
- **Infrastructure:** Existing local cache/output layout and Vitest integration harness only.
- **Environment variables / secrets:** None.

## Complexity Estimate
XL

Reason: this work spans parser data modeling, recursive traversal, markdown rendering, filename derivation, title-index ordering, and full-title integration coverage across more than three components.

## Required Skills
- TypeScript
- XML parsing
- Markdown rendering
- Vitest
- CLI/integration testing
- Regression test design
