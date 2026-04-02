## [spec-writer] — Spec revised after review
See `docs/specs/31-spec.md` for the canonical spec.

# GitHub-safe renderer output for anchors, cross-references, notes, and embedded acts

## Summary
Fix the remaining user-visible markdown generation defects for embedded U.S. Code output so generated files render correctly on GitHub and link back to OLRC correctly. The implementation must cover six concrete regressions from the issue: visible section anchor syntax, collapsed subsection paragraphs, broken `uscode.house.gov` cross-reference URLs, note paragraphs flattened into one wall of text, embedded Acts escaping note scope and appearing as standalone sections, and note tables being flattened into unreadable text.

## Context
- `src/transforms/markdown.ts` currently appends literal `{#...}` suffixes to embedded section headings, which GitHub renders as visible text.
- Structured subsection siblings are emitted without required blank-line separators, so GitHub collapses them into one paragraph.
- `src/domain/normalize.ts` currently builds canonical `uscode.house.gov` section URLs without the required `&num=0&edition=prelim` query parameters, and `src/transforms/uslm-to-ir.ts` sets `titleIr.sourceUrlTemplate` to the same incomplete base URL.
- `src/transforms/uslm-to-ir.ts` currently collapses multi-`<p>` note content into a single space-joined string via `readNodeText()` / `readOrderedNodeText()`, which destroys paragraph structure inside statutory/editorial notes.
- The issue reports that embedded Acts appearing inside note content are being promoted into top-level code sections, so the section-discovery/parsing path must preserve those Act sections inside the note block rather than emitting them as sibling `SectionIR` records.
- Historical and Revision Notes include real `<html:table>` structures in fixtures such as `tests/fixtures/xml/title-05/05-part-chapter-sections.xml`; current note extraction/rendering flattens those tables into concatenated text.
- Existing coverage already exercises the markdown renderer and USLM parser in `tests/unit/transforms/markdown.test.ts`, `tests/unit/transforms/uslm-to-ir.test.ts`, and related snapshots/fixtures.

## Acceptance Criteria

### Functional
#### 1. Embedded section anchors and subsection paragraphing
- [ ] Embedded section rendering in `renderChapterMarkdown()` and `renderUncategorizedMarkdown()` must emit a standalone HTML anchor line immediately before each embedded section heading, using exactly `<a id="section-<normalized-id>"></a>`, and must not emit literal ` {#section-...}` text anywhere in the rendered markdown. <!-- Touches: src/transforms/markdown.ts, src/domain/normalize.ts, tests/unit/transforms/markdown.test.ts -->
- [ ] Standalone section rendering in `renderSectionMarkdown()` must continue to start with `# § {sectionNumber}. {heading}` and must not prepend the HTML anchor line used by embedded/chapter output. <!-- Touches: src/transforms/markdown.ts, tests/unit/transforms/markdown.test.ts, tests/unit/transforms/__snapshots__/markdown.test.ts.snap -->
- [ ] When `renderContentNodes()` renders sibling `subsection` nodes with `structuredSubsectionHeadings: true`, the compacted markdown output must contain exactly one blank line before each subsection block that follows prior body text or a prior subsection block, so GitHub renders `**(a)** ...` and `**(b)** ...` as separate paragraphs. <!-- Touches: src/transforms/markdown.ts, tests/unit/transforms/markdown.test.ts -->
- [ ] Structured subsection rendering must preserve the existing inline bold label/heading formats (`**(a)** body`, `**(a) Heading** body`, or `**(a) Heading**`) and must preserve existing child ordering and indentation for paragraph/subparagraph/clause/item descendants. <!-- Touches: src/transforms/markdown.ts, tests/unit/transforms/markdown.test.ts, tests/unit/transforms/__snapshots__/markdown.test.ts.snap -->

#### 2. Canonical OLRC cross-reference URLs
- [ ] `buildCanonicalSectionUrl(titleNumber, sectionNumber)` must return URLs in the exact shape `https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title{titleNumber}-section{sectionNumber}&num=0&edition=prelim`. <!-- Touches: src/domain/normalize.ts, tests/unit/transforms/markdown.test.ts -->
- [ ] When chapter-mode link rewriting falls back to canonical OLRC links, the rewritten markdown links must include the `&num=0&edition=prelim` query parameters rather than the shorter broken URL form. <!-- Touches: src/transforms/markdown.ts, tests/unit/transforms/markdown.test.ts -->
- [ ] `renderChapterMarkdown()` and `renderUncategorizedMarkdown()` frontmatter `source` values must use the same `edition=prelim` / `num=0` URL contract as `titleIr.sourceUrlTemplate`, so generated embedded files link to a resolvable OLRC source page. <!-- Touches: src/transforms/uslm-to-ir.ts, src/transforms/markdown.ts, tests/unit/transforms/markdown.test.ts, tests/unit/transforms/uslm-to-ir.test.ts -->

#### 3. Note paragraph preservation
- [ ] When a statutory or editorial note contains multiple source `<p>` elements, the extracted/rendered note text must preserve those paragraph boundaries with `\n\n` separators in markdown output instead of joining paragraphs with spaces. <!-- Touches: src/transforms/uslm-to-ir.ts, src/transforms/markdown.ts, tests/unit/transforms/markdown.test.ts, tests/unit/transforms/uslm-to-ir.test.ts -->
- [ ] Multi-paragraph note rendering must preserve paragraph order exactly as it appears in the XML, including headings, lead-in text, quoted text, and continuation paragraphs. <!-- Touches: src/transforms/uslm-to-ir.ts, src/transforms/markdown.ts, tests/unit/transforms/uslm-to-ir.test.ts -->
- [ ] Single-paragraph notes must continue to render as a single paragraph with no leading/trailing blank paragraph separators added. <!-- Touches: src/transforms/uslm-to-ir.ts, src/transforms/markdown.ts, tests/unit/transforms/markdown.test.ts -->

#### 4. Embedded Acts must remain inside note scope
- [ ] Parsing a section fixture that contains an embedded Act inside note content (for example, the Title 4 / Title 18 scenarios cited in the issue) must not create additional top-level `SectionIR` entries for the embedded Act’s internal `§ 1.`, `§ 2.`, etc.; only actual codified sections from the title body may appear in `titleIr.sections`. <!-- Touches: src/transforms/uslm-to-ir.ts, src/transforms/parser.ts (if present), tests/unit/transforms/uslm-to-ir.test.ts -->
- [ ] The text of embedded Act provisions that were previously mis-promoted into standalone sections must remain attached to the originating statutory note content so that the generated markdown still exposes that note material under the parent section’s note block. <!-- Touches: src/transforms/uslm-to-ir.ts, src/transforms/markdown.ts, tests/unit/transforms/uslm-to-ir.test.ts, tests/unit/transforms/markdown.test.ts -->
- [ ] Existing codified-section discovery for real title body sections must remain unchanged: fixing embedded Act leakage must not suppress or renumber legitimate top-level sections in the parsed title. <!-- Touches: src/transforms/uslm-to-ir.ts, tests/unit/transforms/uslm-to-ir.test.ts -->

#### 5. Historical and Revision Notes table rendering
- [ ] When a statutory/editorial note contains an HTML/USLM table (for example `<html:table class="HNR">`), the extracted/rendered markdown must preserve row and column boundaries in a mechanically testable table representation instead of concatenating all cells into a single whitespace-normalized string. <!-- Touches: src/transforms/uslm-to-ir.ts, src/transforms/markdown.ts, tests/unit/transforms/uslm-to-ir.test.ts, tests/unit/transforms/markdown.test.ts -->
- [ ] The chosen markdown representation for note tables must preserve header/body reading order, including the example headings equivalent to `Revised Section | Source (U.S. Code) | Source (Statutes at Large)`. <!-- Touches: src/transforms/uslm-to-ir.ts, src/transforms/markdown.ts, tests/unit/transforms/uslm-to-ir.test.ts -->
- [ ] Non-table note text that precedes or follows a note table must remain before/after the table in the same source order, with blank-line separation between paragraph text and the rendered table block. <!-- Touches: src/transforms/uslm-to-ir.ts, src/transforms/markdown.ts, tests/unit/transforms/markdown.test.ts -->

#### 6. Regression coverage
- [ ] Unit or snapshot coverage must assert that embedded markdown contains `<a id="section-...\"></a>`-style anchor lines and does not contain `{#section-...}`. <!-- Touches: tests/unit/transforms/markdown.test.ts -->
- [ ] Unit or snapshot coverage must assert paragraph breaks between at least two sibling subsections by checking for `\n\n**(a)` and `\n\n**(b)` (or an equivalent exact separator assertion). <!-- Touches: tests/unit/transforms/markdown.test.ts -->
- [ ] Unit coverage must assert the full canonical cross-reference URL shape, including both `num=0` and `edition=prelim`, in rendered fallback links and/or frontmatter `source` values. <!-- Touches: tests/unit/transforms/markdown.test.ts, tests/unit/transforms/uslm-to-ir.test.ts -->
- [ ] Unit or fixture-based coverage must assert that multi-paragraph notes render with `\n\n` boundaries, embedded Acts do not produce extra top-level `SectionIR` records, and note tables render with preserved structural separators rather than flattened cell text. <!-- Touches: tests/unit/transforms/markdown.test.ts, tests/unit/transforms/uslm-to-ir.test.ts -->
- [ ] Existing renderer/parser tests unrelated to these six regressions must continue to pass without expectation changes unrelated to anchor, paragraph, link, note, embedded-Act, or table formatting. <!-- Touches: tests/unit/transforms/markdown.test.ts, tests/unit/transforms/uslm-to-ir.test.ts, tests/unit/transforms/__snapshots__/markdown.test.ts.snap -->

### Non-Functional
- [ ] Performance: renderer/parser behavior for existing fixtures must remain deterministic and must complete within the current unit-test runtime budget; no new network calls, subprocesses, or filesystem writes may be introduced in parser/renderer code paths. <!-- Touches: src/transforms/markdown.ts, src/transforms/uslm-to-ir.ts -->
- [ ] Compatibility: generated markdown must remain valid GitHub-flavored Markdown plus inline-safe HTML anchor tags, and note tables must render with plain markdown constructs rather than custom extensions or client-side scripting. <!-- Touches: src/transforms/markdown.ts -->
- [ ] Safety: anchor markup must remain constrained to the exact `<a id="section-..."></a>` form derived from `embeddedSectionAnchor()`; no arbitrary raw HTML passthrough may be added for note/table content. <!-- Touches: src/transforms/markdown.ts, src/domain/normalize.ts -->

## Out of Scope
- Changing `embeddedSectionAnchor()` normalization rules for valid section numbers.
- Introducing any new CLI flags, HTTP APIs, databases, background jobs, or external services.
- Reformatting body content that is unrelated to the six reported regressions.
- Bulk-regenerating repository outputs beyond normal test/fixture expectations.

## Dependencies
- `src/transforms/markdown.ts`
- `src/transforms/uslm-to-ir.ts`
- `src/domain/normalize.ts`
- `tests/unit/transforms/markdown.test.ts`
- `tests/unit/transforms/uslm-to-ir.test.ts`
- Representative XML fixtures under `tests/fixtures/xml/`

## Acceptance Tests (human-readable)
1. Parse a fixture/title containing ordinary codified sections plus embedded/chapter output.
2. Render chapter markdown and verify each embedded section heading is preceded by `<a id="section-..."></a>` on its own line and the file contains no `{#section-...}` suffixes.
3. Render content with chapeau text followed by subsection `(a)` and subsection `(b)` under structured subsection mode; verify each subsection starts after a blank line and still uses the current bold inline format.
4. Render a chapter-mode cross-reference that falls back to canonical OLRC URLs; verify the final link contains `&num=0&edition=prelim`.
5. Render chapter or uncategorized frontmatter and verify `source:` points to a URL that also includes `num=0` and `edition=prelim`.
6. Parse/render a note fixture with multiple `<p>` elements; verify the output contains paragraph boundaries (`\n\n`) between note paragraphs and preserves source order.
7. Parse a fixture containing an embedded Act inside a note; verify no extra top-level `SectionIR` entries are created for the Act’s internal sections and that the Act text remains inside the parent section’s note block.
8. Parse/render a Historical and Revision Notes fixture with `<html:table>`; verify the markdown preserves column/row structure instead of flattening the cells into one string.
9. Run the unit test suite covering markdown and USLM transforms and verify existing unrelated expectations still pass.

## Edge Case Catalog
- Empty/omitted embedded anchor input: no placeholder HTML anchor and no extra blank line.
- Section numbers requiring normalization (`36B`, `2/3`, zero-padded values): embedded anchors still derive IDs exclusively from `embeddedSectionAnchor()`, while canonical OLRC URLs still use the unnormalized section number segment.
- Consecutive subsection blocks after plain text, after other subsection blocks, or around nested continuation text: each subsection remains its own paragraph without duplicating blank lines.
- Cross-reference text containing punctuation, Unicode, en dashes, or title-qualified references: canonical fallback URL generation must still preserve the same link text while appending the required OLRC query parameters.
- Notes with one paragraph, many paragraphs, headings plus paragraphs, quoted content, or mixed inline refs/dates: paragraph boundaries must be preserved only where separate `<p>` nodes exist.
- Embedded Act note content whose internal sections resemble real codified `§` headings: parser logic must keep them inside the note body unless the XML node belongs to the actual title/body section list.
- Note tables with header rows, body rows, empty cells, inline links, or surrounding paragraph text: structural separators must survive and surrounding prose must keep source order.
- Malformed/partial XML note content: parser should continue reporting ordinary parse/runtime errors rather than silently emitting misleading merged output.
- Degraded behavior: because parsing/rendering remains in-process and fixture-driven, there is no network/database/cache fallback path; failures should remain normal parse/test exceptions.

## Verification Strategy
- **Pure core:** `buildCanonicalSectionUrl()`, section-heading rendering, subsection separation logic, note extraction helpers, and note/table serialization helpers should remain pure value-to-value transforms.
- **Properties:** (1) embedded output never contains literal `{#...}` fragments; (2) standalone section output never gains embedded anchor lines; (3) canonical OLRC links always include both `num=0` and `edition=prelim`; (4) note paragraph boundaries correspond 1:1 with source `<p>` boundaries; (5) embedded Act sections never appear as additional top-level `SectionIR` records; (6) note tables preserve row/column ordering in rendered output.
- **Purity boundary:** I/O remains limited to fixture reads and test harness execution; parser/renderer functions themselves must not introduce network or filesystem side effects.

## Infrastructure Requirements
- **Database:** None.
- **API endpoints:** None.
- **Infrastructure:** None.
- **Environment variables / secrets:** None.

## Complexity Estimate
M

## Required Skills
typescript, vitest, markdown rendering, XML parsing
