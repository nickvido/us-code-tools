# US Code markdown chapter rendering correctness

## Summary
Fix the chapter-mode markdown renderer so generated chapter files have a valid heading hierarchy, valid source URLs, working cross-reference links, readable nested subsection formatting, useful title index pages, and reliable section heading extraction from USLM input. This is needed so chapter-per-file output is navigable, link-safe, and faithful to the source XML.

## Context
- The repository transforms USLM XML into a `TitleIR`/`SectionIR` model in `src/transforms/uslm-to-ir.ts` and renders markdown in `src/transforms/markdown.ts`.
- Chapter output embeds multiple sections into one markdown file via `renderChapterMarkdown()` / `renderEmbeddedSections()` instead of emitting section-per-file links for the primary navigation path.
- Current renderer behavior produces invalid or misleading output in six places: embedded section headings render as H1, chapter frontmatter `source` uses an unresolved `{section}` placeholder, cross-references still target section-per-file markdown paths, nested labeled bodies are rendered as a dense text wall, `_title.md` repeats section lists that are not useful in chapter mode, and some section headings are intermittently missing during XML → IR parsing.
- The fix must preserve existing repository terminology and data flow: `TitleIR`, `SectionIR`, `ContentNode`, `renderSectionMarkdown()`, `renderChapterMarkdown()`, `renderTitleMarkdown()`, `parseSection()`, `parseContentOrdered()`, and `hrefToMarkdownLink()` already exist and should remain the main integration points.
- Non-negotiable constraint: the output format remains chapter-per-file for chapter rendering; this issue does not switch the project back to section-per-file navigation.

## Acceptance Criteria

### 1. Embedded section heading levels
- [ ] `renderChapterMarkdown()` output renders each embedded section heading as level-2 markdown (`## § {sectionNumber}. {heading}` when `heading` is present, `## § {sectionNumber}.` when `heading` is empty).  <!-- Touches: src/transforms/markdown.ts -->
- [ ] In chapter-mode output, statutory note headings render at one level below their containing section (`### Statutory Notes` section wrapper and `#### {note.heading}` for individual statutory notes when present).  <!-- Touches: src/transforms/markdown.ts -->
- [ ] In chapter-mode output, editorial notes render at one level below their containing section (`### Notes`).  <!-- Touches: src/transforms/markdown.ts -->
- [ ] Standalone `renderSectionMarkdown()` output remains section-centered and does not regress existing section-per-file heading semantics unless the implementation intentionally unifies them and updates tests accordingly.  <!-- Touches: src/transforms/markdown.ts, tests/* -->

### 2. Source URL resolution
- [ ] Every rendered chapter markdown file writes a concrete `source` value in YAML frontmatter with no `{section}` placeholder and no unmatched template braces.  <!-- Touches: src/transforms/markdown.ts, src/transforms/uslm-to-ir.ts -->
- [ ] For chapter files, the `source` frontmatter points to a canonical uscode.house.gov URL for that title/chapter output unit, or to another deterministic canonical title-level URL explicitly derived from `TitleIR`; tests must assert the exact URL format chosen by the implementation.  <!-- Touches: src/transforms/markdown.ts, src/transforms/uslm-to-ir.ts -->
- [ ] Section markdown frontmatter continues to emit a concrete section-specific `source` URL using the actual title and section identifiers.  <!-- Touches: src/transforms/uslm-to-ir.ts, src/transforms/markdown.ts -->

### 3. Chapter-mode cross-reference links
- [ ] Cross-references rendered inside chapter markdown do not point to non-existent `section-*.md` files.  <!-- Touches: src/transforms/uslm-to-ir.ts, src/transforms/markdown.ts -->
- [ ] For every cross-reference whose target section number exists in the chapter output mapping for the referenced title, the rendered markdown link resolves to the chapter file plus a deterministic section anchor for the embedded section heading. Example shape: `./chapter-004-...md#section-411` or `../title-03-the-president/chapter-004-...md#section-411`.  <!-- Touches: src/transforms/markdown.ts, src/domain/normalize.ts -->
- [ ] For cross-references whose target section cannot be mapped to a generated chapter file/anchor, the renderer falls back to a canonical uscode.house.gov URL rather than emitting a broken local markdown path.  <!-- Touches: src/transforms/markdown.ts and/or src/transforms/uslm-to-ir.ts -->
- [ ] The section anchor generation strategy is deterministic and slug-safe for numeric and alphanumeric section identifiers (for example `411`, `125d`, `301-1`), and tests assert the exact anchor strings.  <!-- Touches: src/transforms/markdown.ts, src/domain/normalize.ts -->
- [ ] ⚡ Cross-title cross-references continue to compute relative paths using the existing title directory naming rules in `titleDirectoryName()` and do not hardcode title directory strings.  <!-- Touches: src/transforms/uslm-to-ir.ts, src/transforms/markdown.ts, src/domain/normalize.ts -->

### 4. Nested subsection formatting
- [ ] `renderContentNode()` emits each labeled node type (`subsection`, `paragraph`, `subparagraph`, `clause`, `subclause`, `item`, `subitem`) on its own line rather than concatenating an entire subtree into one paragraph.  <!-- Touches: src/transforms/markdown.ts -->
- [ ] For labeled nodes with children, the parent label/heading/text line is rendered before any child lines, and each child line is indented by a fixed, testable increment relative to its parent (for example 2 spaces per depth level).  <!-- Touches: src/transforms/markdown.ts -->
- [ ] When a labeled node has both a `heading` and `text`, the output preserves both on the same logical line in document order.  <!-- Touches: src/transforms/markdown.ts -->
- [ ] Chapeau/continuation text that belongs before or after nested labeled children remains in the correct relative order after rendering.  <!-- Touches: src/transforms/uslm-to-ir.ts, src/transforms/markdown.ts -->
- [ ] The renderer preserves blank-line separation between top-level introductory text blocks and subsequent labeled subsections so the output is readable in markdown previews.  <!-- Touches: src/transforms/markdown.ts -->

### 5. Title index output
- [ ] `renderTitleMarkdown()` no longer emits a `## Sections` list in `_title.md`.  <!-- Touches: src/transforms/markdown.ts -->
- [ ] `_title.md` continues to emit the title H1 and the `## Chapters` list when chapter metadata exists.  <!-- Touches: src/transforms/markdown.ts -->
- [ ] Removing the per-section list eliminates duplicate `§ 1.` / `§ 2.` style entries from `_title.md`, including parser-artifact entries such as `§ uncodified-1.`.  <!-- Touches: src/transforms/markdown.ts -->

### 6. Section heading extraction reliability
- [ ] `parseSection()` populates `SectionIR.heading` from `<heading>` content whenever a section element contains a heading in the source XML, including sections that also contain nested body structures or preserve-order parsing paths.  <!-- Touches: src/transforms/uslm-to-ir.ts -->
- [ ] Ordered parsing and non-ordered parsing produce the same `SectionIR.heading` for the same section input when both parsing paths are exercised in tests.  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/* -->
- [ ] If a section truly has no `<heading>` element, the parser returns an empty string rather than copying unrelated descendant text into `SectionIR.heading`.  <!-- Touches: src/transforms/uslm-to-ir.ts -->
- [ ] Regression coverage includes a fixture patterned after the Title 51 failure mode where neighboring sections with `<heading>` elements all retain their headings after parsing and rendering.  <!-- Touches: tests/*, fixtures if present -->

### Non-Functional
- [ ] Performance: rendering a title in chapter mode does not introduce more than one additional in-memory pass over each section body compared with the current renderer, and the full existing test suite for transforms completes within the repository’s normal CI timeout.  <!-- Touches: tests/* -->
- [ ] Security: markdown rendering must escape or preserve source text without introducing executable HTML/JS beyond what is already emitted today; link fixes may only generate relative markdown links or `https://uscode.house.gov/` URLs.  <!-- Touches: src/transforms/markdown.ts, src/transforms/uslm-to-ir.ts -->
- [ ] Compatibility: existing public function exports in `src/transforms/markdown.ts` and `src/transforms/uslm-to-ir.ts` remain import-compatible unless a change is explicitly covered by updated tests and implementation notes.  <!-- Touches: src/transforms/markdown.ts, src/transforms/uslm-to-ir.ts -->

## Out of Scope
- Changing the repository’s overall output strategy from chapter-per-file back to section-per-file.
- Reworking title/chapter slug generation beyond what is required to produce deterministic chapter links and anchors for this issue.
- Fixing unrelated parser or renderer bugs outside headings, source URLs, cross-reference targets, nested subsection formatting, and title index contents.
- Reformatting historical backfill content under `src/backfill/`.

## Dependencies
- Existing normalization helpers in `src/domain/normalize.ts`, especially `titleDirectoryName()`, `sectionFileSafeId()`, and chapter filename helpers.
- Existing IR model types in `src/domain/model.ts`.
- Existing transform tests and any new fixtures needed to reproduce Title 51-style heading loss and nested-content rendering cases.

## Acceptance Tests (human-readable)
1. Run the parser/markdown transform against a fixture with one title, one chapter, and two sections with headings.
2. Open the generated chapter markdown file.
3. Verify each section starts with `## § ...`, not `# § ...`.
4. Verify the section wrapper for statutory notes is `### Statutory Notes` and each note heading is `#### ...`.
5. Verify the YAML frontmatter `source:` value contains no `{section}` placeholder.
6. Verify an inline cross-reference to another section in the same title points to a chapter markdown file plus `#section-...` anchor, not `section-....md`.
7. Verify an unmapped cross-reference falls back to `https://uscode.house.gov/...`.
8. Verify nested subsection content renders as multiple lines with indentation increasing by one fixed step per level.
9. Open the generated `_title.md` file and verify it includes the title heading and chapter list but no per-section list.
10. Parse a regression fixture modeled on Title 51 and verify all sections with `<heading>` elements retain non-empty `SectionIR.heading` values and render with heading text in markdown.

## Edge Case Catalog
- **Malformed input:** sections whose `<heading>` contains nested inline tags, xrefs, or partial/truncated markup; malformed `<num>` values; truncated preserve-order child arrays.
- **Partial data:** sections with `<num>` but no `<heading>`; sections with `<heading>` but empty body; chaptered titles with some sections missing `hierarchy.chapter`.
- **Delimiter edge cases:** section numbers containing letters, hyphens, slash-separated subsection hints (`125/d`), repeated punctuation, or trailing separators.
- **Encoding issues:** BOM-prefixed XML, mixed whitespace, smart quotes, em dashes, non-breaking spaces, Unicode section headings, emoji/RTL text inside headings or paragraph text.
- **Boundaries:** titles with zero chapters, one chapter, many chapters; sections with zero children, one child, or deeply nested labeled descendants through `subitem`.
- **State:** duplicate section numbers across files; uncodified sections using fallback numbers; sections marked repealed/transferred/omitted.
- **Concurrency:** not applicable to runtime behavior because transforms are batch/pure-process oriented, but tests should confirm deterministic output for the same input across repeated runs.
- **Network/subsystem failure:** not applicable inside the pure transform path; when no local chapter target can be resolved, output must degrade to a canonical `uscode.house.gov` URL instead of a broken relative file link.
- **Fallback behavior:** unresolved local cross-reference target → canonical external URL; missing heading element → empty heading string, not guessed descendant text.
- **Recovery:** once chapter target maps or heading extraction logic is corrected, rerunning the transform should automatically produce corrected links/headings without manual cleanup.
- **Time:** no timezone/DST behavior is in scope; output must remain deterministic independent of system clock.

## Verification Strategy
- **Pure core:** keep URL/anchor derivation, heading-level selection, and labeled-node line formatting as pure string-building helpers that can be unit tested from `SectionIR` / `ContentNode` inputs.
- **Properties:**
  - chapter-mode markdown never contains links to non-existent `section-*.md` targets;
  - chapter frontmatter `source` never contains `{section}`;
  - embedded section headings always begin with `## §`;
  - anchor generation is deterministic for a given section number;
  - parser heading extraction returns the same heading across ordered/non-ordered parse paths for equivalent input.
- **Purity boundary:** XML parsing with `fast-xml-parser` and filesystem output stay at the effectful boundary; conversion from parsed nodes to `TitleIR`/`SectionIR`, plus markdown rendering from IR to strings, should remain testable without filesystem I/O.

## Infrastructure Requirements
- **Database:** none.
- **API endpoints:** none.
- **Infrastructure:** none.
- **Environment variables / secrets:** none.

## Complexity Estimate
M

## Required Skills
typescript, markdown rendering, XML parsing, vitest
