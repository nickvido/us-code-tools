## [spec-writer] — Initial spec drafted
See `docs/specs/20-spec.md` for the canonical spec.

# Transform descriptive title directory names

## Summary
Change transform output so title directories include a slugified form of the parsed title heading instead of only the zero-padded title number. Both default section-level output and `--group-by chapter` output must write under `uscode/title-{NN}-{title-heading-slug}/`, while preserving current fallback behavior for titles whose heading is missing and preserving correct cross-title link resolution.

## Context
- Today `src/transforms/write-output.ts` derives section, chapter, uncategorized, and `_title.md` paths under `uscode/title-{NN}/` using `padTitleNumber()` only.
- `TitleIR.heading` already exists in `src/domain/model.ts`, and `parseUslmToIr()` in `src/transforms/uslm-to-ir.ts` already reads the XML `<heading>` text for each title.
- Existing tests in `tests/unit/transforms/write-output.test.ts` and `tests/integration/transform-cli.test.ts` assert the current `title-NN` layout, so this issue requires an explicit path-contract update rather than an implementation-only tweak.
- The requested change applies to both output layouts already supported by the tool: default section-per-file output and `--group-by chapter` output from issue #16.
- Non-negotiable constraint: if a title heading is missing or normalizes to an empty slug, output must fall back to the current directory name `title-{NN}`.
- Non-negotiable constraint: path generation for title directories must be centralized so section files, chapter files, `_uncategorized.md`, `_title.md`, and any cross-title link rendering cannot drift.

## Acceptance Criteria

### Functional

#### 1. Shared title-directory naming contract
- [ ] A shared production helper derives the title directory segment from a `TitleIR`-equivalent input (`titleNumber` plus optional heading) and returns exactly one of these forms: `title-{NN}-{slug}` when a non-empty slug can be derived from the heading, or `title-{NN}` when heading is missing or slugifies to empty. The helper is used by all output-path writers instead of hand-building `title-{NN}` strings in multiple places. <!-- Touches: src/domain/normalize.ts or new shared helper module, src/transforms/write-output.ts, tests/unit/transforms/write-output.test.ts -->
- [ ] The helper zero-pads the numeric title portion exactly as today via `padTitleNumber()`, so title 1 still begins with `title-01-...`, title 10 with `title-10-...`, and title 54 with `title-54-...`. <!-- Touches: src/domain/normalize.ts, tests/unit/transforms/write-output.test.ts -->
- [ ] The heading slug normalization contract is exactly: lowercase ASCII letters; remove apostrophes and straight/curly quotes rather than turning them into separators; replace every maximal run of other non-alphanumeric characters with a single hyphen; collapse repeated hyphens; trim leading/trailing hyphens; and if the result is empty, treat it as no slug. Mechanically test these exact examples: `General Provisions` → `general-provisions`, `Armed Forces` → `armed-forces`, `Crimes and Criminal Procedure` → `crimes-and-criminal-procedure`, `The Public Health and Welfare` → `the-public-health-and-welfare`, and `Patriotic Societies and Observances` enclosed in quotes/apostrophes still produces `patriotic-societies-and-observances` with no quote characters or doubled hyphens. <!-- Touches: src/domain/normalize.ts, tests/unit/transforms/write-output.test.ts or new normalize tests -->
- [ ] A heading consisting only of stripped punctuation/quotes/whitespace (or a missing/empty heading) produces the fallback directory name `title-{NN}` with no trailing hyphen. <!-- Touches: src/domain/normalize.ts, tests/unit/transforms/write-output.test.ts -->

#### 2. Default section-level output paths
- [ ] Default section-level transform output writes section files to `uscode/title-{NN}-{slug}/section-{section-id}.md` when the title heading slug is available, and to `uscode/title-{NN}/section-{section-id}.md` only when fallback is required. Existing section filename normalization for `section-{sectionFileSafeId(sectionNumber)}.md` is unchanged. <!-- Touches: src/transforms/write-output.ts, tests/unit/transforms/write-output.test.ts, tests/integration/transform-cli.test.ts -->
- [ ] `_title.md` for default output is written into the same derived title directory as its sibling section files. No mode may write section files and `_title.md` into different title-directory names for the same title. <!-- Touches: src/transforms/write-output.ts, tests/integration/transform-cli.test.ts -->

#### 3. Chapter-grouped output paths
- [ ] When `writeTitleOutput(..., { groupBy: 'chapter' })` is used, every chapter file, `_uncategorized.md` file (when present), and `_title.md` file is written under the same derived title directory `uscode/title-{NN}-{slug}/` for that title, with fallback to `uscode/title-{NN}/` only when the title heading is unavailable/empty after normalization. <!-- Touches: src/transforms/write-output.ts, tests/unit/issue16-chapter-mode.test.ts, tests/integration/transform-cli.test.ts -->
- [ ] Chapter output filenames (`chapter-*.md`) and chapter bucketing behavior remain exactly as specified in issue #16; this issue changes only the parent title-directory segment, not chapter filename normalization or chapter ordering semantics. <!-- Touches: src/transforms/write-output.ts, tests/unit/issue16-chapter-mode.test.ts, tests/integration/transform-cli.test.ts -->

#### 4. Corpus-wide path safety and fallback behavior
- [ ] A fixture-backed integration test covering all numeric titles `1..52` and `54` proves that successful transforms create one title directory per title whose basename matches either `title-{NN}-{slug}` or `title-{NN}` and never contains spaces, quote characters, path separators, repeated adjacent hyphens, a trailing hyphen, or characters outside `[a-z0-9-]` after the `title-{NN}-` prefix. <!-- Touches: tests/integration/transform-cli.test.ts -->
- [ ] The same title-matrix coverage verifies that the transform still preserves the existing reserved-empty failure path for title `53`, and that the new directory-naming contract does not introduce extra failures for the other 53 titles. <!-- Touches: tests/integration/transform-cli.test.ts -->
- [ ] At least one targeted fixture or unit test proves fallback behavior by constructing a `TitleIR` (or parser fixture) with an empty/missing heading and asserting that all generated paths for that title stay under `title-{NN}` exactly. <!-- Touches: src/transforms/write-output.ts, tests/unit/transforms/write-output.test.ts or new unit test -->

#### 5. Cross-title reference/link correctness
- [ ] Any production code path that renders filesystem-relative markdown links to another title’s output file must resolve the target title directory via the same shared title-directory helper, not via a hard-coded `title-{NN}` pattern. If the current implementation does not yet emit such links, add or update a unit-level contract around the existing cross-reference renderer/helper that proves this helper will be the sole source of truth once links are rendered. <!-- Touches: src/transforms/markdown.ts and/or any existing cross-reference helper, src/domain/normalize.ts, tests/unit/transforms/markdown.test.ts or new link-resolution tests -->
- [ ] A mechanically checkable fixture test verifies that a cross-reference from one title to another resolves to the slugged target directory name when the target title has a heading, and resolves to `title-{NN}` when the target title heading is missing. <!-- Touches: tests/unit/transforms/markdown.test.ts or new targeted test, possibly tests/integration/transform-cli.test.ts -->

### Non-Functional
- [ ] Determinism: running the same transform twice against the same fixture corpus produces byte-identical file contents and the same title directory names.
- [ ] Backward-compatible fallback: titles with missing headings keep the exact legacy directory name `title-{NN}` so incomplete source data does not break the transform.
- [ ] Centralization: there is exactly one production normalization contract for title-directory names; section mode, chapter mode, and cross-title link resolution all depend on it.

## Out of Scope
- Changing title frontmatter or markdown body content beyond any path/link updates required by the new directory names.
- Renaming chapter files, section files, or changing `sectionFileSafeId()` behavior.
- Introducing new grouping modes beyond the existing default and `chapter` modes.
- Changing CLI flags or output report schema for this issue.
- Publishing or migrating downstream repositories that consume the generated files.

## Dependencies
- `src/domain/model.ts`
- `src/domain/normalize.ts`
- `src/transforms/uslm-to-ir.ts`
- `src/transforms/write-output.ts`
- `src/transforms/markdown.ts` and/or existing cross-reference rendering helpers
- `tests/unit/transforms/write-output.test.ts`
- `tests/unit/issue16-chapter-mode.test.ts`
- `tests/unit/transforms/markdown.test.ts`
- `tests/integration/transform-cli.test.ts`
- Existing local OLRC/USLM fixtures under `tests/fixtures/`

## Acceptance Tests (human-readable)
1. Run `npm run build`.
2. Run the existing unit tests for path derivation and confirm they now expect `title-01-general-provisions` rather than `title-01` when a heading is present.
3. Run a unit test over the shared title-directory helper and verify these exact mappings: `1 + "General Provisions"` → `title-01-general-provisions`, `10 + "Armed Forces"` → `title-10-armed-forces`, `18 + "Crimes and Criminal Procedure"` → `title-18-crimes-and-criminal-procedure`, `42 + "The Public Health and Welfare"` → `title-42-the-public-health-and-welfare`.
4. Run a unit test over quote/apostrophe-heavy headings and verify quote characters are stripped instead of becoming doubled separators.
5. Run a unit test with an empty/missing heading and verify the helper returns `title-04` with no trailing hyphen.
6. Run the default transform integration fixture for title 1 and verify output files are written under `out/uscode/title-01-general-provisions/`, including `_title.md` and `section-00001.md`.
7. Run chapter mode for a fixture title and verify `_title.md` plus `chapter-*.md` files are written under the same slugged title directory.
8. Run the full numeric-title matrix fixture and verify every successful title output directory name is filesystem-safe, slugged when headings exist, and fallback-only when headings are missing/empty.
9. Run a targeted cross-reference test and verify a link from one title to another points at the slugged destination directory, not `title-{NN}`.
10. Re-run the same transform and verify the directory names and file bytes are unchanged.

## Edge Case Catalog
- **Malformed input:** title headings containing punctuation-only text, repeated separators, XML entity-expanded quote characters, or leading/trailing delimiter noise must normalize to a deterministic slug or cleanly fall back to `title-{NN}`.
- **Partial data:** some titles may have a numeric title number but missing/empty heading; those titles must still transform successfully into `title-{NN}` while titles with headings in the same corpus use slugged names.
- **Delimiter edge cases:** apostrophes, straight quotes, curly quotes, em dashes, commas, slashes, ampersands, and multiple spaces must not produce doubled hyphens, trailing hyphens, or unsafe path separators.
- **Encoding issues:** Unicode punctuation and non-breaking spaces in title headings must not corrupt the slugging process or emit raw unsafe bytes in directory names; normalization must remain deterministic.
- **Boundary values:** title numbers 1, 9, 10, 52, 53, and 54 must preserve zero padding and reserved-title behavior exactly.
- **State:** existing tests and any code that assume `title-{NN}` paths must be updated together so output writers, readers, and link renderers do not disagree on the new path layout.
- **Concurrency:** simultaneous transforms to different output roots must not share mutable slugging state.
- **Subsystem failure:** if creating a slugged title directory fails on disk, the transform must surface the existing output-write failure path rather than silently falling back to a different directory.
- **Partial failure:** if some files for a title are written before a later file write fails, rerunning into a clean directory after fixing the error must reproduce the same slugged directory layout.
- **Recovery:** once a missing/empty heading is later populated in source data, the title directory name will change from fallback `title-{NN}` to `title-{NN}-{slug}` on the next transform run; no hidden cache may preserve stale directory names.

## Verification Strategy
- **Pure core:** title-heading slugification and title-directory derivation should be pure helpers that accept `titleNumber` plus optional heading and return the final directory segment.
- **Properties:**
  - For every valid heading, the derived directory name starts with `title-{NN}` and contains only lowercase ASCII letters, digits, and hyphens after that prefix.
  - Removing quotes/apostrophes from a heading never introduces empty path segments or repeated hyphens.
  - Missing/empty headings always map to exactly `title-{NN}`.
  - All output files for a given title in a given mode share the same parent title directory.
  - Cross-title references, when rendered, resolve target directories through the same helper used by output writers.
  - Re-running the same input corpus yields identical directory names.
- **Purity boundary:** XML parsing and filesystem writes remain effectful; slug generation, directory-segment derivation, and link-target path derivation remain unit-testable pure logic.

## Infrastructure Requirements
- **Database:** None.
- **API endpoints:** None.
- **Infrastructure:** Existing local filesystem output tree and fixture-backed Vitest integration harness only.
- **Environment variables / secrets:** None.

## Complexity Estimate
S

## Required Skills
TypeScript, path normalization, markdown/link rendering, filesystem output design, Vitest
