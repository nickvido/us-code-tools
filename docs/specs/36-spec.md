## [spec-writer] — Initial spec drafted
See `docs/specs/36-spec.md` for the canonical spec.

# GitHub-safe nested subsection rendering for markdown output

## Summary
Fix nested subsection rendering so generated markdown never relies on leading whitespace to represent paragraph, clause, subclause, item, or subitem labels. Any labeled node below the top-level subsection must render as its own GitHub-safe labeled paragraph using bold labels and blank-line separation, preventing GitHub from interpreting four-space-indented lines as code blocks while preserving source order and label hierarchy.

## Context
- `src/transforms/markdown.ts` currently renders top-level `subsection` nodes differently from deeper labeled nodes.
- Non-subsection labeled descendants are emitted through `renderLabeledLine()` with left-padding based on depth (`paragraph` → 0 spaces, `subparagraph` → 2, `clause` → 4, `item` → 6, etc.).
- GitHub-flavored Markdown interprets lines indented by four or more spaces as code blocks, so nested labels such as `(i)` and `(ii)` render incorrectly in generated statute files.
- The issue cites real breakage in generated outputs such as `title-18/chapter-010-biological-weapons.md` and `title-18/chapter-044-firearms.md`, so the fix must apply to all labeled nesting levels produced by the renderer, not just one fixture.
- Existing renderer coverage lives in `tests/unit/transforms/markdown.test.ts`; parser shape and labeled-node types are defined in `src/transforms/uslm-to-ir.ts` and consumed from the IR model.

## Acceptance Criteria

### Functional
#### 1. Labeled nested-node rendering contract
- [ ] When `renderSectionMarkdown()` renders any labeled node of type `paragraph`, `subparagraph`, `clause`, `subclause`, `item`, or `subitem`, the emitted markdown line must begin with a bold label token (`**(1)**`, `**(A)**`, `**(i)**`, `**(I)**`, etc.) and must not begin with leading indentation spaces. <!-- Touches: src/transforms/markdown.ts, tests/unit/transforms/markdown.test.ts -->
- [ ] The same bold-label contract must apply when labeled descendants appear under top-level subsections and when they appear nested multiple levels deep, including the exact issue shapes `(G) → (i) → text` and `(A) → (i) → (I) → text`. <!-- Touches: src/transforms/markdown.ts, tests/unit/transforms/markdown.test.ts -->
- [ ] Unlabeled text nodes that are rendered as descendant continuation/body text may still use indentation if needed, but labeled descendant lines must never rely on four-or-more-space prefixes for structure. <!-- Touches: src/transforms/markdown.ts, tests/unit/transforms/markdown.test.ts -->

#### 2. Blank-line separation and ordering
- [ ] Every labeled node rendered in markdown must be separated from the preceding rendered block by exactly one blank line whenever it follows non-blank body text or another labeled node, so GitHub renders each label block as a normal paragraph rather than merging adjacent labels or treating them as code. <!-- Touches: src/transforms/markdown.ts, tests/unit/transforms/markdown.test.ts -->
- [ ] Rendering must preserve document order from the IR tree: parent labeled line first, then each child subtree in original order, with no sibling reordering or label promotion across levels. <!-- Touches: src/transforms/markdown.ts, tests/unit/transforms/markdown.test.ts -->
- [ ] Existing top-level subsection output must remain in the current inline form (`**(a)** text`, `**(a) Heading** text`, or `**(a) Heading**`) and must continue to use blank-line-separated paragraphs consistent with issue #31. <!-- Touches: src/transforms/markdown.ts, tests/unit/transforms/markdown.test.ts, docs/specs/31-spec.md -->

#### 3. Parser/renderer compatibility
- [ ] No change may be required to the labeled-node types emitted by `parseUslmToIr()`; the renderer must consume the existing IR node kinds (`subsection`, `paragraph`, `subparagraph`, `clause`, `subclause`, `item`, `subitem`, `text`) without introducing a new persisted schema or altering section discovery behavior. <!-- Touches: src/transforms/uslm-to-ir.ts, src/transforms/markdown.ts, tests/unit/transforms/uslm-to-ir.test.ts -->
- [ ] Markdown output for sections without nested labeled descendants must remain byte-for-byte compatible except where blank-line normalization is already required by the new GitHub-safe rendering contract. <!-- Touches: src/transforms/markdown.ts, tests/unit/transforms/markdown.test.ts, tests/unit/transforms/__snapshots__/markdown.test.ts.snap -->

#### 4. Regression coverage
- [ ] Unit or snapshot tests must assert that rendered markdown for a nested hierarchy contains bold descendant labels such as `**(A)**`, `**(i)**`, and `**(I)**`, and does not contain the code-block-triggering forms `\n    (i)` or `\n    (ii)` for labeled nodes. <!-- Touches: tests/unit/transforms/markdown.test.ts -->
- [ ] Unit or snapshot tests must cover at least one real-world-shaped nested example where a clause-level label follows a parent label and verify the rendered output contains `\n\n**(i)**` (or equivalent label) rather than a space-indented line. <!-- Touches: tests/unit/transforms/markdown.test.ts -->
- [ ] Existing parser tests for labeled hierarchy construction must continue to pass unchanged unless an assertion must be updated solely to reflect the new markdown rendering format. <!-- Touches: tests/unit/transforms/uslm-to-ir.test.ts, tests/unit/transforms/markdown.test.ts -->

### Non-Functional
- [ ] Compatibility: generated output must remain valid GitHub-flavored Markdown with no raw HTML or custom markdown extensions introduced for nested subsection formatting. <!-- Touches: src/transforms/markdown.ts -->
- [ ] Performance: nested-node rendering must remain a pure in-memory transform with no added network, filesystem, or subprocess activity and no worse-than-linear traversal over the rendered content tree. <!-- Touches: src/transforms/markdown.ts -->
- [ ] Safety: label formatting must derive exclusively from existing node labels in the IR; the renderer must not synthesize, renumber, or normalize labels beyond the current `formatLabel()` behavior. <!-- Touches: src/transforms/markdown.ts -->

## Out of Scope
- Changing how the XML parser identifies labeled nodes or section boundaries.
- Regenerating all title/chapter markdown files as part of this spec.
- Reformatting editorial notes, statutory notes, cross-references, anchors, or heading/frontmatter behavior unrelated to nested labeled body content.
- Changing canonical source URLs or file naming conventions.

## Dependencies
- `src/transforms/markdown.ts`
- `src/transforms/uslm-to-ir.ts`
- `tests/unit/transforms/markdown.test.ts`
- `tests/unit/transforms/uslm-to-ir.test.ts`
- Existing snapshots under `tests/unit/transforms/__snapshots__/`

## Acceptance Tests (human-readable)
1. Render a section IR containing `(a)` → `(1)` → `(A)` → `(i)` → `(I)` and verify every labeled line appears as a standalone paragraph beginning with `**(` rather than indentation.
2. Verify the rendered markdown does not contain a line starting with four spaces followed by a labeled token such as `(i)` or `(ii)`.
3. Render a case shaped like issue #36 (`(G)` with child clauses `(i)` and `(ii)`) and verify the output contains:
   - `**(G)**`
   - a blank line
   - `**(i)** ...`
   - a blank line
   - `**(ii)** ...`
4. Render existing top-level subsection cases and verify they still use the current bold inline subsection format introduced by the earlier formatting work.
5. Run the markdown/unit test suite and verify nested rendering expectations pass without parser regressions.

## Edge Case Catalog
- Labeled nodes with text, heading-only content, text-only content, or empty child arrays: all labeled outputs must still begin with bold labels and avoid code-block indentation.
- Mixed nesting depths (`subsection → paragraph`, `subsection → paragraph → subparagraph`, `subsection → paragraph → subparagraph → clause → item`, `subsection → clause` if present in IR): rendering must stay GitHub-safe at every level.
- Sibling labeled nodes before and after continuation text nodes: blank-line insertion must separate labeled blocks without producing duplicate empty paragraphs.
- Labels containing arabic numerals, letters, roman numerals, or slash-bearing section text in surrounding content: label emphasis must preserve exact label text from the IR.
- Malformed/partial IR nodes with missing labels on non-text descendants: unlabeled output may omit the bold label, but labeled descendants that do have labels must still avoid leading indentation.
- Unicode/emoji/RTL text in node body text or headings: label formatting and blank-line separation must remain correct and independent of text encoding.
- Very deep nesting: renderer must continue to terminate deterministically without exponential blank-line insertion or sibling duplication.
- Degraded behavior: because rendering is local and pure, there is no network/cache/database fallback path; failures should surface as ordinary test failures or thrown renderer errors.

## Verification Strategy
- **Pure core:** `renderContentNodes()`, `renderContentNodeLines()`, `renderStructuredLine()`, `renderLabeledLine()`, and blank-line separation helpers should remain pure transforms from IR nodes to markdown lines.
- **Properties:** (1) any rendered labeled descendant line begins with `**(` after optional preceding blank lines, never indentation; (2) no labeled node is emitted with a four-space prefix; (3) source-order traversal is preserved; (4) top-level subsection formatting remains unchanged.
- **Purity boundary:** all I/O remains in fixture reads and test execution; parser/renderer code paths must remain side-effect-free.

## Infrastructure Requirements
- **Database:** None.
- **API endpoints:** None.
- **Infrastructure:** None.
- **Environment variables / secrets:** None.

## Complexity Estimate
S

## Required Skills
typescript, vitest, markdown rendering
