# US Code markdown chapter rendering correctness

## Summary
Fix the chapter-mode markdown renderer so generated chapter files have a valid heading hierarchy, concrete source URLs, working cross-reference links, readable nested subsection formatting, useful title index pages, and reliable section heading extraction from USLM input. This keeps chapter-per-file output navigable, link-safe, and faithful to the source XML.

## Context
- The repository transforms USLM XML into a `TitleIR`/`SectionIR` model in `src/transforms/uslm-to-ir.ts` and renders markdown in `src/transforms/markdown.ts`.
- Chapter output embeds multiple sections into one markdown file via `renderChapterMarkdown()` / `renderEmbeddedSections()` instead of using section-per-file output as the primary navigation mode.
- Current output is incorrect in six linked areas: embedded section headings render as H1, chapter frontmatter `source` contains an unresolved `{section}` placeholder, inline cross-references still target `section-*.md`, nested labeled bodies render as dense text walls, `_title.md` repeats an unhelpful per-section list, and some section headings are intermittently dropped during XML → IR parsing.
- Existing repository terminology and module boundaries should be preserved: `TitleIR`, `SectionIR`, `ContentNode`, `renderSectionMarkdown()`, `renderChapterMarkdown()`, `renderTitleMarkdown()`, `parseSection()`, `parseContentOrdered()`, and normalization helpers in `src/domain/normalize.ts`.
- Non-negotiable constraint: chapter rendering remains chapter-per-file. This issue does not switch navigation strategy back to section-per-file.

## Acceptance Criteria

### 1. Embedded section heading levels
- [ ] `renderChapterMarkdown()` emits each embedded section heading as level-2 markdown: `## § {sectionNumber}. {heading}` when `heading` is non-empty, and `## § {sectionNumber}.` when `heading` is empty.  <!-- Touches: src/transforms/markdown.ts -->
- [ ] In chapter-mode output, the statutory notes wrapper heading renders as `### Statutory Notes`, and any individual statutory note heading renders as `#### {note.heading}`.  <!-- Touches: src/transforms/markdown.ts -->
- [ ] In chapter-mode output, the editorial notes wrapper heading renders as `### Notes`.  <!-- Touches: src/transforms/markdown.ts -->
- [ ] Standalone `renderSectionMarkdown()` continues to emit the section heading line as level-1 markdown: `# § {sectionNumber}. {heading}` when `heading` is non-empty, and `# § {sectionNumber}.` when `heading` is empty.  <!-- Touches: src/transforms/markdown.ts, tests/* -->

### 2. Source URL resolution
- [ ] Every rendered chapter markdown file writes a concrete `source` value in YAML frontmatter with no `{section}` placeholder and no unmatched template braces.  <!-- Touches: src/transforms/markdown.ts, src/transforms/uslm-to-ir.ts -->
- [ ] Chapter markdown frontmatter `source` equals `https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title{titleNumber}` using the decimal `TitleIR.titleNumber` value with no zero-padding, chapter suffix, or section placeholder. Example: Title 42 renders `https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title42`.  <!-- Touches: src/transforms/markdown.ts, src/transforms/uslm-to-ir.ts -->
- [ ] Section markdown frontmatter continues to emit a concrete section-specific `source` URL in the format `https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title{titleNumber}-section{sectionNumber}` using the actual title and section identifiers.  <!-- Touches: src/transforms/uslm-to-ir.ts, src/transforms/markdown.ts -->

### 3. Chapter-mode cross-reference links
- [ ] Cross-references rendered inside chapter markdown never point to local `section-*.md` files.  <!-- Touches: src/transforms/uslm-to-ir.ts, src/transforms/markdown.ts -->
- [ ] When the referenced section number exists in the chapter output mapping for the referenced title, the rendered link target is a chapter markdown file plus a deterministic embedded-section anchor, for example `./chapter-004-...md#section-411` or `../title-03-the-president/chapter-004-...md#section-411`.  <!-- Touches: src/transforms/markdown.ts, src/domain/normalize.ts -->
- [ ] When the referenced section cannot be mapped to a generated local chapter file, the rendered link target falls back to a canonical `https://uscode.house.gov/` URL instead of emitting a broken relative markdown link.  <!-- Touches: src/transforms/markdown.ts and/or src/transforms/uslm-to-ir.ts -->
- [ ] Embedded-section anchor generation is deterministic for numeric and alphanumeric section identifiers including `411`, `125d`, `301-1`, and `125/d`; tests assert the exact anchor strings.  <!-- Touches: src/transforms/markdown.ts, src/domain/normalize.ts -->
- [ ] ⚡ Cross-title relative links continue to derive title directory paths via `titleDirectoryName()` rather than hardcoded title-directory strings.  <!-- Touches: src/transforms/uslm-to-ir.ts, src/transforms/markdown.ts, src/domain/normalize.ts -->

### 4. Nested subsection formatting
- [ ] `renderContentNode()` emits each labeled node type (`subsection`, `paragraph`, `subparagraph`, `clause`, `subclause`, `item`, `subitem`) on its own output line rather than collapsing an entire subtree into one paragraph.  <!-- Touches: src/transforms/markdown.ts -->
- [ ] For labeled nodes with children, the parent line appears before all child lines, and each child depth is indented by one fixed increment relative to its parent; tests assert the exact indentation rule used by the implementation.  <!-- Touches: src/transforms/markdown.ts -->
- [ ] When a labeled node has both `heading` and `text`, the output preserves both on the same logical line in source order.  <!-- Touches: src/transforms/markdown.ts -->
- [ ] Chapeau and continuation text remain in the same relative order around nested labeled children after rendering.  <!-- Touches: src/transforms/uslm-to-ir.ts, src/transforms/markdown.ts -->
- [ ] The rendered markdown preserves blank-line separation between top-level introductory text blocks and subsequent labeled subsections.  <!-- Touches: src/transforms/markdown.ts -->

### 5. Title index output
- [ ] `renderTitleMarkdown()` no longer emits a `## Sections` list in `_title.md`.  <!-- Touches: src/transforms/markdown.ts -->
- [ ] `_title.md` continues to emit the title H1 and the `## Chapters` list when chapter metadata exists.  <!-- Touches: src/transforms/markdown.ts -->
- [ ] Removing the per-section list eliminates duplicate `§ 1.` / `§ 2.` style entries from `_title.md`, including parser-artifact entries such as `§ uncodified-1.`.  <!-- Touches: src/transforms/markdown.ts -->

### 6. Section heading extraction reliability
- [ ] `parseSection()` populates `SectionIR.heading` from `<heading>` content whenever the section element contains a heading, including sections that also contain nested body structures or preserve-order parsing paths.  <!-- Touches: src/transforms/uslm-to-ir.ts -->
- [ ] Ordered parsing and non-ordered parsing produce the same `SectionIR.heading` for equivalent section input; tests assert equality for both paths.  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/* -->
- [ ] If a section has no `<heading>` element, the parser returns an empty string and does not substitute unrelated descendant text into `SectionIR.heading`.  <!-- Touches: src/transforms/uslm-to-ir.ts -->
- [ ] Regression coverage includes a fixture patterned after the Title 51 failure mode where adjacent sections that each contain `<heading>` elements all retain their headings after parse + render.  <!-- Touches: tests/*, fixtures if present -->

### Non-Functional
- [ ] Security: link generation may emit only relative markdown links or `https://uscode.house.gov/` URLs, and the renderer must not introduce new executable HTML/JS output beyond current behavior.  <!-- Touches: src/transforms/markdown.ts, src/transforms/uslm-to-ir.ts -->

## Out of Scope
- Changing the project’s output strategy from chapter-per-file back to section-per-file.
- Reworking slug generation beyond what is required to produce deterministic chapter links and embedded-section anchors for this issue.
- Fixing unrelated parser or renderer bugs outside the six issue areas above.
- Reformatting historical backfill content under `src/backfill/`.

## Dependencies
- Existing normalization helpers in `src/domain/normalize.ts`, especially `titleDirectoryName()`, `sectionFileSafeId()`, and chapter filename helpers.
- Existing IR model types in `src/domain/model.ts`.
- Transform tests and any new fixtures needed to reproduce Title 51-style heading loss and nested-content rendering cases.

## Acceptance Tests (human-readable)
1. Run the parser/markdown transform against a fixture containing one title, one chapter, two sections with headings, statutory notes, editorial notes, nested labeled subsections, and inline cross-references.
2. Open the generated chapter markdown file and verify each embedded section starts with `## § ...`, not `# § ...`.
3. Verify the statutory notes wrapper renders as `### Statutory Notes` and individual statutory note headings render as `#### ...`.
4. Verify the editorial notes wrapper renders as `### Notes`.
5. Verify chapter frontmatter `source:` contains no `{section}` placeholder and exactly equals `https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title{titleNumber}` for the rendered title.
6. Verify an inline cross-reference to a locally mapped section points to a chapter markdown file plus `#section-...` anchor, not `section-....md`.
7. Verify an unmapped cross-reference falls back to `https://uscode.house.gov/...`.
8. Verify nested subsection content renders as multiple lines with deterministic indentation increasing by one fixed step per nesting depth.
9. Open generated `_title.md` and verify it includes the title heading and chapter list but no `## Sections` block.
10. Parse a regression fixture modeled on Title 51 and verify all sections with `<heading>` elements retain non-empty `SectionIR.heading` values and render with heading text in markdown.

## Edge Case Catalog
- **Malformed input:** `<heading>` values containing nested inline tags, xrefs, or truncated markup; malformed `<num>` values; truncated preserve-order child arrays.
- **Partial data:** sections with `<num>` but no `<heading>`; sections with `<heading>` but empty body; chaptered titles with some sections missing `hierarchy.chapter`.
- **Delimiter edge cases:** section identifiers containing letters, hyphens, slashes, repeated punctuation, or trailing separators such as `125d`, `301-1`, and `125/d`.
- **Encoding issues:** BOM-prefixed XML, mixed whitespace, smart quotes, em dashes, non-breaking spaces, Unicode headings, emoji, or RTL text inside headings or paragraph text.
- **Boundaries:** titles with zero chapters, one chapter, or many chapters; sections with zero children, one child, or deeply nested labeled descendants through `subitem`.
- **State:** duplicate section numbers across files; uncodified sections using fallback identifiers; sections marked repealed, transferred, or omitted.
- **Concurrency:** not a runtime concern for batch transforms, but repeated runs over the same input must produce byte-for-byte equivalent link targets and anchors.
- **Subsystem failure:** no network dependency is in scope; when no local chapter target can be resolved, rendering degrades to a canonical `uscode.house.gov` URL instead of a broken local path.
- **Fallback behavior:** unresolved local cross-reference target → canonical external URL; missing heading element → empty heading string, not guessed descendant text.
- **Recovery:** once chapter-target mapping or heading extraction logic is fixed, rerunning the transform produces corrected links and headings without manual cleanup.
- **Time:** no timezone or clock-dependent behavior is in scope; output must remain deterministic regardless of system time.

## Verification Strategy
- **Pure core:** keep URL/anchor derivation, heading-level selection, and labeled-node line formatting as pure string-building helpers that can be unit-tested from `SectionIR` / `ContentNode` inputs.
- **Properties:**
  - chapter-mode markdown never contains links to local `section-*.md` files;
  - chapter frontmatter `source` never contains `{section}`;
  - embedded section headings always begin with `## §`;
  - anchor generation is deterministic for a given section identifier;
  - ordered and non-ordered parse paths yield the same `SectionIR.heading` for equivalent input.
- **Purity boundary:** XML parsing with `fast-xml-parser` and filesystem output remain in the effectful shell; IR construction and markdown rendering remain testable as pure transforms over parsed input and IR objects.

## Infrastructure Requirements
- **Database:** none.
- **API endpoints:** none.
- **Infrastructure:** none.
- **Environment variables / secrets:** none.

## Complexity Estimate
M

## Required Skills
- typescript
- markdown rendering
- XML parsing
- vitest
