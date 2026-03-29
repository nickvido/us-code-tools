## [spec-writer] — Initial spec drafted
See `docs/specs/16-spec.md` for the canonical spec.

# Transform chapter-level output mode

## Summary
Add an optional chapter-grouped transform mode to the CLI so `us-code-tools transform --group-by chapter` writes one markdown file per chapter instead of one file per section. The new mode must reuse the existing section parser and markdown renderer, preserve section content verbatim inside each chapter file, keep `_title.md` generation intact, and leave the default section-per-file output unchanged.

## Context
- Today `src/index.ts` accepts `transform --title <n> --output <dir>` and always writes one markdown file per section plus `_title.md` via `writeTitleOutput()` in `src/transforms/write-output.ts`.
- `SectionIR` already carries hierarchy metadata, including `hierarchy.chapter`, and `renderSectionMarkdown()` already emits the complete section markdown format that downstream content expects.
- The current section-level layout creates 60K+ files across the corpus, which makes repository diffs noisy and strips nearby statutory context from a changed section.
- The requested behavior is additive: section-level output remains the default, while a new flag selects chapter-grouped output.
- Non-negotiable constraint: chapter files must be assembled from the same parsed/sorted section content used by section-level output, not from a second rendering path that could drift.
- Non-negotiable constraint: appendix identifiers such as `5a` remain out of scope because the transform CLI still accepts only integer titles `1..54`.

## Acceptance Criteria

### Functional

#### 1. CLI contract
- [ ] `src/index.ts` accepts an optional `--group-by <value>` flag for the `transform` command, rejects duplicate `--group-by` flags, and rejects unsupported values with a usage error that names the accepted value `chapter`. The command remains valid with no `--group-by` flag. <!-- Touches: src/index.ts, tests/unit/bootstrap-and-cli.test.ts or new CLI-arg tests -->
- [ ] When `--group-by` is omitted, `transform` writes the same file layout and report semantics it writes today: one `_title.md` plus one `section-*.md` file per parsed codified section. Existing integration tests for default output continue to pass unchanged. <!-- Touches: src/index.ts, src/transforms/write-output.ts, tests/integration/transform-cli.test.ts -->

#### 2. Chapter-grouped file generation
- [ ] When `transform --group-by chapter` is used, `writeTitleOutput()` (or a renamed successor) writes `_title.md` plus one markdown file per distinct chapter bucket under `out/uscode/title-{NN}/`, named `chapter-{CCC}.md` when the bucket chapter number is purely numeric and zero-padded to width 3. For non-numeric chapter identifiers, the implementation must use a deterministic file-safe stem `chapter-{safe-id}.md` defined by a single shared helper and covered by unit tests. <!-- Touches: src/transforms/write-output.ts, src/domain/normalize.ts or new helper module, tests/unit/transforms/write-output.test.ts -->
- [ ] Sections are assigned to chapter buckets from `section.hierarchy.chapter` exactly as parsed into `SectionIR`; no fallback inference from `_title.md`, filenames, or heading text is allowed. <!-- Touches: src/transforms/write-output.ts, src/domain/model.ts, tests/unit/transforms/write-output.test.ts -->
- [ ] Within each chapter bucket, sections appear in canonical section order using the existing shared sort behavior (`sortSections()` / `compareSectionNumbers()`), and chapter bucket order is deterministic across repeated runs of the same fixture. <!-- Touches: src/transforms/write-output.ts, src/domain/normalize.ts, tests/unit/transforms/write-output.test.ts, tests/integration/transform-cli.test.ts -->

#### 3. Chapter markdown format
- [ ] Every generated chapter file begins with frontmatter containing exactly these required keys when the chapter is categorized: `title`, `chapter`, `heading`, `section_count`, and `source`. `title` equals the numeric title, `chapter` equals the parsed chapter identifier string, `heading` equals the chapter heading from `TitleIR.chapters` when available, `section_count` equals the number of rendered sections in that file, and `source` equals `titleIr.sourceUrlTemplate`. <!-- Touches: src/transforms/markdown.ts or new chapter renderer, src/transforms/write-output.ts, tests/unit/transforms/markdown.test.ts -->
- [ ] The body of each generated chapter file concatenates the existing rendered section markdown for every section in that bucket in order, with each section represented by the same `# § {sectionNumber}. {heading}` heading, body content, notes, source credits, and cross-reference link rendering produced by `renderSectionMarkdown()` for section-level output. Acceptance is satisfied only if a fixture test proves that stripping chapter-file frontmatter and splitting on top-level section headings yields byte-identical section bodies to the standalone section renderer for the same sections. <!-- Touches: src/transforms/markdown.ts, src/transforms/write-output.ts, tests/unit/transforms/markdown.test.ts, tests/integration/transform-cli.test.ts -->
- [ ] `_title.md` is still generated in chapter-grouped mode and continues to report title metadata plus the full section index. The chapter-grouped mode does not remove or rename `_title.md`. <!-- Touches: src/transforms/write-output.ts, src/transforms/markdown.ts, tests/integration/transform-cli.test.ts -->

#### 4. Uncategorized-section behavior
- [ ] If a codified section lacks `hierarchy.chapter`, chapter-grouped output does not drop it silently. The implementation must place such sections into a dedicated `_uncategorized.md` file with frontmatter keys `title`, `heading`, `section_count`, and `source`, where `heading` is the literal string `Uncategorized`. It must also append one structured **warning** per uncategorized section to a dedicated `warnings` array in the JSON report; these warnings are report-only diagnostics and MUST NOT be added to `parse_errors`. <!-- Touches: src/transforms/write-output.ts, src/transforms/markdown.ts, src/domain/model.ts if needed, src/index.ts, tests/unit/transforms/write-output.test.ts, tests/integration/transform-cli.test.ts -->

#### 5. End-to-end transform guarantees
- [ ] A deterministic integration test seeded from local OLRC fixtures proves that `transform --group-by chapter` exits `0` for all non-reserved numeric titles `1..52` and `54`, preserves the existing reserved-empty failure path for title `53`, and reports zero `parse_errors` for the successful titles when the same fixture set also succeeds in default section mode. Fixtures that contain uncategorized sections may emit `warnings`, but those warnings do not change the exit code when chapter files are still written successfully. <!-- Touches: tests/integration/transform-cli.test.ts -->
- [ ] The same integration coverage proves that the total generated file count in chapter-grouped mode equals `1 + categorizedChapterFileCount + uncategorizedFileCount` for each transformed title and is strictly less than the default section-level file count for every title fixture containing at least two sections in the same chapter. <!-- Touches: tests/integration/transform-cli.test.ts -->

### Non-Functional
- [ ] Determinism: running chapter-grouped transform twice against the same local fixture tree produces byte-identical `_title.md` and `chapter-*.md` outputs.
- [ ] Backward compatibility: adding `--group-by chapter` introduces no new environment variables, network calls, or writes outside the selected `--output` root.
- [ ] Extensibility boundary: grouping selection is represented in code as a constrained mode value rather than a bare boolean so future values such as `subchapter` or `part` can be added without redefining the CLI contract.

## Out of Scope
- Implementing grouping modes other than `chapter`.
- Changing the parser to infer chapter membership for sections whose XML does not provide `hierarchy.chapter`.
- Transforming appendix titles such as `5a`, `11a`, or `28a`.
- Changing section markdown formatting beyond wrapping existing rendered section output into chapter files.
- Cross-repo publishing changes in the downstream `us-code` content repository.

## Dependencies
- `src/index.ts`
- `src/transforms/write-output.ts`
- `src/transforms/markdown.ts`
- `src/domain/model.ts`
- `src/domain/normalize.ts`
- `tests/integration/transform-cli.test.ts`
- `tests/unit/transforms/write-output.test.ts`
- `tests/unit/transforms/markdown.test.ts`
- Existing transform fixtures under `tests/fixtures/`

## Acceptance Tests (human-readable)
1. Run `npm run build`.
2. Run the existing default transform integration tests and verify they still pass unchanged.
3. Run a focused CLI-arg test and verify `transform --title 1 --output ./out --group-by chapter` is accepted, `--group-by part` fails with a usage error, and duplicate `--group-by` flags fail.
4. Transform a fixture title containing multiple sections in the same chapter and verify the output directory contains `_title.md` plus `chapter-001.md` (and no `section-*.md` files for chapter mode).
5. Open `chapter-001.md` and verify frontmatter contains `title`, `chapter`, `heading`, `section_count`, and `source`.
6. Verify the chapter file contains the expected section headings in canonical order: `# § ...` for each member section.
7. For one sampled section, compare the standalone `renderSectionMarkdown(section)` output to the corresponding slice inside the chapter file and verify the section body text, notes, source credit, and links are identical.
8. Transform a fixture with at least one section lacking `hierarchy.chapter` and verify `_uncategorized.md` is written, includes that section, and the JSON report includes one entry in `warnings` per uncategorized section while `parse_errors` remains unchanged.
9. Run the full title matrix in chapter mode and verify titles `1..52` and `54` succeed, title `53` keeps its current reserved-empty failure path, and successful titles report zero `parse_errors` even when `warnings` are present.
10. Compare file counts for the same title fixture in default mode vs chapter mode and verify chapter mode writes fewer files whenever multiple sections share a chapter.

## Edge Case Catalog
- **Malformed input:** `--group-by` present with no value, duplicate `--group-by`, or unknown mode such as `--group-by foo` must fail with a usage error before any output files are written.
- **Partial data:** a title contains both chapter-tagged and chapter-less sections; tagged sections go to their chapter files, untagged sections go to `_uncategorized.md`, and transform still succeeds with one report-only `warnings[]` entry per uncategorized section and no added `parse_errors`.
- **Delimiter edge cases:** chapter identifiers that include punctuation, spaces, roman numerals, or mixed case must map to deterministic file-safe stems through one shared helper; tests must define the exact mapping used by the implementation.
- **Encoding issues:** chapter headings containing em dashes, quotes, non-breaking spaces, or non-ASCII characters render correctly in frontmatter/body and do not corrupt filenames.
- **Ordering boundaries:** section ordering within a chapter must stay canonical for values such as `1`, `2`, `10`, `106a`, `106A`, and `106b`; chapter bucket ordering must stay deterministic for `1`, `2`, `10`, and non-numeric identifiers.
- **Missing chapter metadata:** if `TitleIR.chapters` lacks a heading entry for a chapter identifier that exists on sections, the file is still written with a deterministic fallback heading value defined in code and covered by tests; it must not crash or drop the bucket.
- **Subsystem failure:** if one chapter file write fails, the transform returns a non-zero status through the existing output-write error path and surfaces which chapter bucket failed.
- **Partial failure:** if `_title.md` writes successfully but one chapter file fails, the JSON report still includes the write diagnostic and no successful chapter bucket is counted twice.
- **Recovery:** rerunning the transform into a clean output directory after fixing the underlying write problem regenerates the same deterministic chapter files without manual cache cleanup.
- **Concurrency:** multiple independent transforms to different output directories must not share mutable grouping state.

## Verification Strategy
- **Pure core:** group sections into buckets by `hierarchy.chapter`, derive deterministic chapter file stems, resolve chapter headings from `TitleIR.chapters`, and assemble chapter markdown from existing rendered section markdown using pure helpers.
- **Properties:**
  - Every rendered codified section appears exactly once in chapter-grouped mode: either in one `chapter-*` file or in `_uncategorized.md`.
  - The sum of `section_count` across all chapter-grouped output files equals the number of written codified sections for that title.
  - For any section with `hierarchy.chapter = X`, the section appears only in bucket `X`.
  - Each uncategorized section contributes exactly one `warnings[]` entry and zero additional `parse_errors` entries.
  - Extracted section bodies are byte-identical between standalone section rendering and embedded chapter rendering.
  - Output filenames and file ordering are deterministic for the same input fixture set.
- **Purity boundary:** XML parsing, ZIP extraction, and filesystem writes remain in the effectful shell; grouping, sorting, filename derivation, chapter frontmatter assembly, and markdown concatenation remain unit-testable pure logic.

## Infrastructure Requirements
- **Database:** None.
- **API endpoints:** None.
- **Infrastructure:** Existing local filesystem output tree and fixture-backed Vitest integration harness only; JSON stdout report schema may be extended with a report-only `warnings` array.
- **Environment variables / secrets:** None.

## Complexity Estimate
M

## Required Skills
TypeScript, CLI argument parsing, markdown rendering, filesystem output design, Vitest integration testing
