## [spec-writer] — Spec revised after adversary review
See `docs/specs/14-spec.md` for the canonical spec.

# Complete structured USLM section-body rendering

## Summary
Ensure the USLM-to-markdown pipeline preserves complete section body text for structured OLRC sections. Rendering must include introductory chapeau text, inline body text attached to labeled nodes, nested list bodies across the full section hierarchy, and continuation text that resumes after nested children so generated markdown is text-complete rather than label-only.

## Context
- The current implementation parses and renders `SectionIR.content` through `src/transforms/uslm-to-ir.ts` and `src/transforms/markdown.ts`.
- The issue report shows the user-visible failure mode: numbered and lettered labels can render without their associated body text, making generated markdown incomplete for many USC sections.
- The current codebase uses `ContentNode` variants in `src/domain/model.ts` and renders them via `renderSectionMarkdown()` / `renderContentNode()` in `src/transforms/markdown.ts`.
- Re-check at the current branch head confirms the adversary-review finding: the ordered parser path still drops some deep inline body text and the markdown renderer still diverges from the approved subsection-heading / continuation-indentation contract. This spec therefore remains a code-change spec for `src/`, not a documentation-only cleanup.
- Knowledge-capture documents are non-authoritative for issue completion. Only passing source-backed tests in `src/` + `tests/` satisfy this issue.
- Non-negotiable constraint: the transform must support the full USLM nesting chain used for section bodies: `subsection → paragraph → subparagraph → clause → subclause → item → subitem`.
- Non-negotiable constraint: generated markdown must preserve document order for parent text before nested children and continuation text after nested children.

## Acceptance Criteria

### Functional

#### 1. Section-body parsing coverage
- [ ] `parseUslmToIr()` preserves `<chapeau>` text as a `ContentNode` that renders before the first labeled child in the same parent container. <!-- Touches: src/transforms/uslm-to-ir.ts, tests/unit/transforms/* -->
- [ ] `parseUslmToIr()` preserves inline body text from `<content>`, `<text>`, or `<p>` on each labeled level in the section-body hierarchy (`subsection`, `paragraph`, `subparagraph`, `clause`, `subclause`, `item`, `subitem`). <!-- Touches: src/transforms/uslm-to-ir.ts, src/domain/model.ts, tests/unit/transforms/* -->
- [ ] The ordered parser path (`parseOrderedContentChildren()` / `parseLabeledNodeOrdered()` or their renamed equivalent) extracts inline body text from `<content><p>…</p></content>` even when the same parent node also contains later structured children or continuation text. This is satisfied only if the focused Title 26 § 2 / § 1 parser regressions pass. <!-- Touches: src/transforms/uslm-to-ir.ts, tests/unit/transforms/uslm-to-ir.test.ts -->
- [ ] `parseUslmToIr()` preserves `<continuation>` text as content that is ordered after the parent node’s nested labeled children in the resulting IR. <!-- Touches: src/transforms/uslm-to-ir.ts, tests/unit/transforms/* -->
- [ ] The parser accepts and preserves nested labeled nodes for all seven section-body levels named in this issue, including levels that are not currently surfaced by the IR or renderer. <!-- Touches: src/domain/model.ts, src/transforms/uslm-to-ir.ts, tests/unit/transforms/* -->

#### 2. Markdown rendering behavior
- [ ] `renderSectionMarkdown()` renders section-level chapeau text as a normal paragraph between the section heading and the first labeled child. <!-- Touches: src/transforms/markdown.ts, tests/unit/transforms/* -->
- [ ] `renderSectionMarkdown()` renders each non-subsection labeled node on a single leading line containing, in order when present: label, heading, and inline body text. Example expected shape: `(1) Heading. Body text`. <!-- Touches: src/transforms/markdown.ts, tests/unit/transforms/* -->
- [ ] `renderSectionMarkdown()` renders subsection nodes as heading blocks with the exact line shape `## ({label}) {heading} {inline body text}` when heading and inline body text are present. The deep-hierarchy markdown regression is not satisfied by plain `(b) …` output. <!-- Touches: src/transforms/markdown.ts, tests/unit/transforms/markdown.test.ts -->
- [ ] `renderSectionMarkdown()` renders nested labeled nodes with deterministic indentation: paragraph `0`, subparagraph `2`, clause `4`, subclause `6`, item `8`, and subitem `10` leading spaces. <!-- Touches: src/transforms/markdown.ts, src/domain/model.ts, tests/unit/transforms/* -->
- [ ] `renderSectionMarkdown()` renders continuation text after the nested child block belonging to the same parent node and indents that continuation to the same block level as the parent’s own child-text content, not flush-left and not merged into the wrong sibling. <!-- Touches: src/transforms/markdown.ts, tests/unit/transforms/* -->

#### 3. Fixture-backed regression coverage
- [ ] Add a real-XML fixture for Title 42 § 10307 and an automated test asserting the rendered markdown includes the section chapeau plus all ten numbered paragraph texts, not just `(1)` through `(10)`. <!-- Touches: tests/fixtures/**, tests/unit/transforms/* -->
- [ ] Add a real-XML fixture with deep nesting (the in-repo Title 26 fixture is acceptable) and automated tests asserting subsection body text, nested paragraph/subparagraph/clause/subclause content, and parent continuation text all appear in the rendered markdown in source order. <!-- Touches: tests/fixtures/**, tests/unit/transforms/* -->
- [ ] The focused regression tests `tests/unit/transforms/uslm-to-ir.test.ts` and `tests/unit/transforms/markdown.test.ts` pass before the issue is treated as complete. <!-- Touches: tests/unit/transforms/* -->
- [ ] Existing test suites continue to pass after the new transform coverage is added. Verification command: `npx vitest run`. <!-- Touches: tests/** -->

### Non-Functional
- [ ] Determinism: repeated rendering of the same XML fixture produces byte-identical markdown output across two consecutive invocations in the same test process.
- [ ] Completeness guard: for each new structured-body fixture, a test compares normalized source-body text to rendered-body text and fails if any fixture-specific expected content segment is missing.
- [ ] Backward compatibility: unchanged simple sections that contain only plain section text or existing supported structures continue to render without changing frontmatter keys or section-title formatting.

## Out of Scope
- Downloading new OLRC content or changing source-fetch behavior in `src/sources/olrc.ts`.
- Altering the repository file layout, CLI interface, or output path conventions.
- Reformatting notes, source credits, or title-level markdown beyond any incidental changes needed for section-body completeness.
- Perfect semantic typography normalization beyond the existing whitespace normalization rules.

## Dependencies
- Existing transform modules: `src/transforms/uslm-to-ir.ts` and `src/transforms/markdown.ts`.
- Existing IR definitions in `src/domain/model.ts`.
- Vitest-based transform regression coverage and new XML/markdown fixtures under `tests/fixtures/` and `tests/unit/`.
- OLRC/USLM sample XML for Title 42 § 10307 and one deep-nesting section fixture.

## Acceptance Tests (human-readable)
1. Run `npx vitest run tests/unit/transforms/uslm-to-ir.test.ts`.
2. Verify the parser test for Title 42 § 10307 confirms the section chapeau plus all ten paragraph body strings are preserved in IR.
3. Verify the parser test `preserves continuation text after nested children and does not drop subclause bodies` passes and that paragraph `(b)(1)` in Title 26 § 2 contains `For purposes of this subtitle, an individual shall be considered a head of a household ...`.
4. Verify the parser test `extracts subsection body text from nested <content><p> blocks without collapsing later structured children` passes and preserves subsection `(b)` / `(f)` behavior in Title 26 § 1.
5. Run `npx vitest run tests/unit/transforms/markdown.test.ts`.
6. Verify the markdown output for Title 42 § 10307 starts with `# § 10307. Types of research and development`, includes the chapeau paragraph, and contains all ten numbered paragraph lines with body text.
7. Verify the deep-hierarchy markdown test contains the exact subsection heading block `## (b) Definition of head of household`.
8. Verify the same deep-hierarchy markdown test contains `(1)`, `  (A)`, `    (i)`, and `      (I)` lines in source order and that the paragraph continuation text appears after the nested children for `(1)`.
9. Run `npx vitest run` and confirm the full suite passes.

## Edge Case Catalog
- **Malformed input:** A labeled node is present with `<num>` but missing `<content>`; the renderer must still emit the label and any other present text without throwing.
- **Partial data:** A node has inline body text but no nested children; it must render as a single labeled line with no extra blank child block.
- **Ordered-content partial data:** A node has `<content><p>…</p></content>` followed by nested labeled children and later `<continuation>`; the parser must preserve all three phases rather than dropping the inline body when children exist.
- **Delimiter edge cases:** Labels such as `(1)`, `(A)`, `(i)`, and XML content containing semicolons, em dashes, or parenthetical citations render without dropped punctuation.
- **Encoding issues:** Fixtures containing XML entities, non-breaking spaces, BOM-prefixed files, and mixed inline xref/text content remain normalized under existing whitespace rules.
- **Ordering:** A parent node containing `chapeau`, inline `content`, nested children, and `continuation` preserves that exact document order in markdown.
- **Hierarchy boundaries:** The deepest supported node (`subitem`) renders without collapsing into its parent’s line or being discarded.
- **Sibling isolation:** Continuation text from one subsection/paragraph must not attach to an adjacent sibling node.
- **Renderer contract drift:** Subsection lines must remain `##` heading blocks; refactors to shared indentation logic must not silently downgrade them to plain body lines.
- **Plain-text fallback:** A section with no labeled children and only top-level section text continues to render exactly as a plain text section.
- **Subsystem failure:** If fixture loading or XML parsing fails, tests fail explicitly with parse/render errors rather than silently accepting truncated markdown.
- **Recovery:** Re-running the transform on a corrected fixture produces complete output without requiring cache invalidation or repo cleanup.

## Verification Strategy
- **Pure core:** The XML-to-IR section-body extraction logic and IR-to-markdown rendering logic should remain pure functions over parsed XML structures and `ContentNode` trees.
- **Properties:**
  - For every labeled node in the supported hierarchy, the rendered markdown contains its label exactly once in the node’s own output block.
  - For every preserved inline text segment (`chapeau`, node body text, `continuation`), rendered output contains that normalized text in document order.
  - Ordered parsing of `<content><p>` is invariant to whether nested labeled children are present later in the same parent node.
  - Rendering is deterministic for the same IR input.
- **Purity boundary:** XML file loading and fixture reads live in tests / source ingestion; transform and render functions remain the unit-test boundary.
- **Gate to completion:** The issue is not complete until both focused transform suites and the full Vitest suite pass against the current `src/` implementation; downstream docs-only updates cannot substitute for that verification.

## Infrastructure Requirements
- **Database:** None.
- **API endpoints:** None.
- **Infrastructure:** None beyond checked-in XML/expected-output fixtures.
- **Environment variables / secrets:** None.

## Complexity Estimate
M

## Required Skills
typescript, vitest, XML parsing, markdown rendering
