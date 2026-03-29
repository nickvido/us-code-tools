## [spec-writer] — Initial spec drafted
See `docs/specs/16-spec.md` for the canonical spec.

# Transform chapter-level output mode

## Summary
Add an optional `--group-by chapter` transform mode that writes one markdown file per chapter while preserving the existing section-per-file output as the default. The chapter files must reuse the current section renderer so content stays identical, `_title.md` remains in place, and uncategorized sections are surfaced explicitly instead of being dropped.

## Context
- Today `transform` always writes one file per section plus `_title.md`.
- The requested mode is additive, not a replacement.
- The implementation should group by the already parsed `section.hierarchy.chapter` metadata rather than inventing a second inference path.
- Appendix titles and non-chapter grouping modes remain out of scope.

## Acceptance Criteria

### Functional
- [ ] `transform` accepts `--group-by chapter`, rejects duplicate/unsupported values, and still behaves exactly as today when the flag is omitted.
- [ ] Chapter mode writes `_title.md` plus one file per chapter bucket under `out/uscode/title-{NN}/`, using deterministic file naming and canonical section ordering.
- [ ] Each chapter file includes frontmatter with `title`, `chapter`, `heading`, `section_count`, and `source`.
- [ ] Each chapter file concatenates the existing rendered section markdown for all member sections in order, preserving headings, body content, notes, source credits, and links byte-for-byte relative to standalone section rendering.
- [ ] Sections without `hierarchy.chapter` are written to `_uncategorized.md` and produce diagnostics instead of being silently skipped.
- [ ] A deterministic integration matrix proves chapter mode succeeds for titles `1..52` and `54`, preserves title `53`’s reserved-empty failure path, and writes fewer files than section mode whenever multiple sections share a chapter.

### Non-Functional
- [ ] Chapter-grouped output is deterministic across repeated runs of the same fixture set.
- [ ] No new env vars, secrets, network calls, or out-of-root writes are introduced.
- [ ] Grouping is represented as an extensible mode value so future `part` / `subchapter` modes can be added without redefining the CLI contract.

## Out of Scope
- Grouping modes other than `chapter`
- Inferring missing chapter metadata from headings or filenames
- Appendix-title support (`5a`, `11a`, etc.)
- Downstream publishing changes in the separate content repo

## Dependencies
- `src/index.ts`
- `src/transforms/write-output.ts`
- `src/transforms/markdown.ts`
- `src/domain/model.ts`
- `src/domain/normalize.ts`
- `tests/unit/transforms/write-output.test.ts`
- `tests/unit/transforms/markdown.test.ts`
- `tests/integration/transform-cli.test.ts`

## Acceptance Tests (human-readable)
1. Verify `transform --title 1 --output ./out --group-by chapter` succeeds and `--group-by part` fails with usage text.
2. Run the same title in default mode and chapter mode; confirm default mode still writes `section-*.md` while chapter mode writes `_title.md` plus `chapter-*.md` / `_uncategorized.md` only.
3. Inspect a chapter file and confirm required frontmatter keys plus canonical section ordering.
4. Compare a section’s standalone markdown to the corresponding slice embedded in a chapter file and confirm the body is identical.
5. Run the full deterministic title matrix in chapter mode and confirm titles `1..52` and `54` succeed while title `53` keeps the existing reserved-empty failure path.

## Edge Case Catalog
- Missing/duplicate/unknown `--group-by` flag values
- Titles containing both chapter-tagged and chapter-less sections
- Non-numeric or punctuation-bearing chapter identifiers requiring safe deterministic filenames
- Chapter headings present on sections but missing from `TitleIR.chapters`
- Mixed-width section identifiers that must retain canonical ordering within each chapter
- Output-write partial failures for one chapter bucket

## Verification Strategy
- **Pure core:** grouping, sorting, chapter filename derivation, chapter heading lookup, and chapter markdown assembly.
- **Properties:** every codified section appears exactly once; `section_count` sums match total rendered sections; embedded section bodies are byte-identical to standalone section rendering; output order is deterministic.
- **Purity boundary:** XML parsing and filesystem writes remain effectful; grouping/render assembly remains unit-testable.

## Infrastructure Requirements
- **Database:** None.
- **API endpoints:** None.
- **Infrastructure:** Existing local filesystem output tree and fixture-backed Vitest harness only.
- **Environment variables / secrets:** None.

## Complexity Estimate
M

## Required Skills
TypeScript, CLI argument parsing, markdown rendering, filesystem output design, Vitest integration testing
