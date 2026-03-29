# Issue #14 Architecture — Complete structured USLM section-body rendering

## Status
Approved spec input: `docs/specs/14-spec.md`

## Inputs Reviewed
- `docs/specs/14-spec.md`
- GitHub issue #14 and current review context
- `README.md`
- `package.json`
- `src/domain/model.ts`
- `src/domain/normalize.ts`
- `src/transforms/uslm-to-ir.ts`
- `src/transforms/markdown.ts`
- `tests/unit/transforms/uslm-to-ir.test.ts`
- `tests/unit/transforms/markdown.test.ts`
- `docs/schemas/USLM-1.0.15.xsd`
- Existing architecture documents: `docs/architecture/10-architecture.md`, `docs/architecture/12-architecture.md`

## Constraints and Operating Assumptions
- No repo-root `.dark-factory.yml` is present in this worktree. Effective constraints therefore come from the approved spec, the existing TypeScript CLI codebase, and current repository architecture.
- This issue remains inside the existing single-process Node.js CLI. It does **not** introduce a daemon, queue, HTTP service, cache tier, or database.
- The defect is a transform correctness gap, not an acquisition, storage, or interface problem. The implementation must stay additive to the existing `parseUslmToIr()` → `renderSectionMarkdown()` pipeline.
- Tests must remain fixture-backed and deterministic. No live OLRC access, no runtime schema validation, and no non-fixture network access are allowed.
- The XML parser contract remains in force: `fast-xml-parser` with namespace stripping, attributes preserved, and preserve-order parsing used where source-order fidelity matters.
- The latest reviewer context includes `[spec-review] — APPROVED` with no blocking `[security-architect]` or `[arch-reviewer]` findings yet. There is therefore no returned-review remediation to fold in for this first architecture revision.

---

## 1. Data Model

### 1.1 Architectural decision
This issue introduces **no database schema and no persisted manifest change**.

That is the correct production decision because the failure is localized to in-memory transform fidelity:
- structured node types are incompletely represented
- parser coverage is incomplete across the full USLM section-body hierarchy
- renderer ordering currently loses or misplaces parent body text around nested children

The production data model affected by this issue is therefore the in-memory IR plus deterministic markdown rendering rules.

### 1.2 Canonical in-memory model changes
Owner: `src/domain/model.ts`

The current `ContentNode` contract must be extended so the transform can represent **all supported labeled structural levels** and preserve parent text segments without collapsing semantics.

Required contract:

```ts
interface BaseLabeledNode {
  type:
    | 'subsection'
    | 'paragraph'
    | 'subparagraph'
    | 'clause'
    | 'subclause'
    | 'item'
    | 'subitem';
  label: string;
  heading?: string;
  text?: string;
  children: ContentNode[];
}

export interface TextBlockNode {
  type: 'text';
  text: string;
}

export type ContentNode =
  | SubsectionNode
  | ParagraphNode
  | SubparagraphNode
  | ClauseNode
  | SubclauseNode
  | ItemNode
  | SubitemNode
  | TextBlockNode;
```

Required invariants:
- Every labeled hierarchy level from `subsection` through `subitem` has a first-class `type`; no level may be remapped to another level just to fit the old union.
- `label` preserves canonical numbering text derived from `<num>` / `@value`.
- `text` holds inline body text from `<content>`, `<text>`, or `<p>` belonging to that labeled node.
- `children` preserves ordered child blocks that belong structurally under the node.
- Free-standing parent text segments such as `<chapeau>` and `<continuation>` remain `TextBlockNode`s so the renderer can place them in document order.

### 1.3 Supported hierarchy model
Owner: `src/transforms/uslm-to-ir.ts`

The parser must adopt a single canonical section-body hierarchy table:

```ts
const SECTION_BODY_TAGS = [
  'subsection',
  'paragraph',
  'subparagraph',
  'clause',
  'subclause',
  'item',
  'subitem',
] as const;
```

Parent/child progression:
- `subsection -> paragraph`
- `paragraph -> subparagraph`
- `subparagraph -> clause`
- `clause -> subclause`
- `subclause -> item`
- `item -> subitem`

Rules:
1. The parser may accept malformed skips in source XML without throwing, but the canonical expected nesting is the table above.
2. Every supported level must be parsed both from standard XML object traversal and from preserve-order traversal.
3. The same level names must flow unchanged into the renderer; do not parse `subclause` as `item` or `subitem` as plain text.

### 1.4 Ordered content model
Owners: `src/transforms/uslm-to-ir.ts`, `src/transforms/markdown.ts`

This issue is fundamentally about **document order preservation** within a section body.

Canonical ordered-content contract per container:

```ts
interface OrderedContainerContent {
  prefaceText: ContentNode[];     // chapeau and any text before first labeled child
  labeledChildren: ContentNode[]; // subsection/paragraph/... nodes in source order
  trailingText: ContentNode[];    // continuation and any text after nested children
}
```

Implementation does not need to introduce this exact exported type, but it must preserve these phases semantically.

Required ordering behavior:
1. `<chapeau>` renders before the first labeled child in the same container.
2. Inline body text (`<content>`, `<text>`, `<p>`) renders on the parent node’s own leading line.
3. Nested labeled children render after the parent line and before parent continuation text.
4. `<continuation>` renders after nested children for the same parent, never before them and never attached to a sibling.
5. Multiple `chapeau`, `content`, child, and `continuation` entries must preserve XML source order exactly.

### 1.5 Text extraction model
Owner: `src/transforms/uslm-to-ir.ts`

The parser must treat these tags as body-text sources:
- `<content>`
- `<text>`
- `<p>`
- text content nested inside inline wrappers like `<ref>`, `<xref>`, `<quotedContent>`, and similar inline-only descendants already traversed by the current raw-text helpers

Normalization rules:
- Reuse existing whitespace normalization; do not invent a new normalization system.
- Preserve punctuation, semicolons, em dashes, and parenthetical citations.
- Preserve inline reference text in rendered output, with existing markdown-link generation behavior retained where already supported.
- Empty or whitespace-only body text is omitted from `text`, but the labeled node still renders if it has a label, heading, or children.

### 1.6 Persistence and migration impact
No SQL migrations, schema migrations, or cache migrations are required.

Changed persistence artifacts are limited to generated markdown files whose **body content becomes more complete** under the existing section output locations.

### 1.7 Seed data / fixtures
The committed fixture set remains the canonical seed-equivalent dataset for this issue.

Required fixture coverage:
- Title 42 § 10307: chapeau + ten numbered paragraphs
- One deep-nesting fixture, preferably from Title 10 or another OLRC sample already aligned with the spec, containing subsection body text, nested descendants, and continuation text

Required fixture assertions:
- completeness guard for expected source-body segments
- deterministic repeated render equality
- stable indentation expectations per hierarchy level

### 1.8 Lookup/index strategy
There is no database index in scope.

Equivalent lookup strategy for this issue:
- one shared tag-to-node-type mapping for the section-body hierarchy
- one shared parser path for inline-body extraction across all labeled node types
- one shared indentation mapping in the renderer for all supported labeled node types

That avoids drift between parser coverage and renderer coverage.

---

## 2. Interface Contract

This repository exposes a CLI and pure transform functions, not an HTTP API. Therefore **no OpenAPI surface is introduced** for this issue.

The external contract in scope is:
- `parseUslmToIr(xml, xmlPath?)`
- `renderSectionMarkdown(section)`
- existing transform CLI behavior and generated markdown content

### 2.1 Parser contract
Function:

```ts
parseUslmToIr(xml: string, xmlPath?: string): ParsedTitleResult
```

Required observable behavior after this issue:
- preserve section-level `<chapeau>` text as content that renders between the section heading and the first labeled descendant
- preserve inline body text on labeled nodes for every level from `subsection` through `subitem`
- preserve parent continuation text after nested children in the same parent node
- emit labeled descendants in deterministic source order
- continue returning valid IR for simple/plain-text sections with no structured hierarchy
- continue using existing parse-error behavior for invalid XML and unsupported oversized fields

### 2.2 Markdown rendering contract
Function:

```ts
renderSectionMarkdown(section: SectionIR): string
```

Required observable behavior:
- the document heading remains `# § {sectionNumber}. {heading}`
- section-level chapeau text renders as normal body text immediately after the heading
- each labeled node renders a leading line composed in this order when present:
  1. label
  2. heading
  3. inline body text
- nested descendants render in source order with deterministic indentation by node type
- continuation text renders after the descendant block belonging to the same parent
- statutory notes, editorial notes, and existing frontmatter behavior remain backward-compatible

### 2.3 Rendered indentation contract
Owner: `src/transforms/markdown.ts`

The renderer must use a single indentation table that covers the full supported hierarchy.

Canonical contract:

```ts
function indentationForNode(type: LabeledNodeType): number {
  switch (type) {
    case 'paragraph': return 0;
    case 'subparagraph': return 2;
    case 'clause': return 4;
    case 'subclause': return 6;
    case 'item': return 8;
    case 'subitem': return 10;
    default: return 0; // subsection handled separately
  }
}
```

Rules:
- `subsection` remains the heading-style block level.
- Every deeper type gets a deterministic indentation step of two spaces beyond its parent block level.
- Parent continuation text must render aligned with the parent’s child-content indentation, not merged onto a child line.

### 2.4 File output contract
No file naming or path contract changes are required.

Observable effect on output files:
- existing section files keep their current names and frontmatter shape
- body content becomes text-complete for structured sections
- unchanged simple sections keep their current formatting

### 2.5 Error contract
No new top-level parse error enum member is required.

This issue is about preventing silent content loss by better structure handling and test coverage, not about inventing new runtime error categories.

### 2.6 Rate limiting / pagination
Not applicable. No HTTP endpoint or paginated API surface is introduced.

---

## 3. Service Boundaries

### 3.1 Monolith/module decision
Remain a single-process CLI package. No service split.

Rationale:
- the change is entirely local to XML parsing and markdown rendering
- there is no asynchronous workload or independent deployment reason
- adding process boundaries would create complexity with zero operational gain

### 3.2 Module ownership

#### `src/domain/model.ts`
Owns:
- `ContentNode` shape
- new `subclause` and `subitem` node types
- compatibility with existing `SectionIR.content`

#### `src/transforms/uslm-to-ir.ts`
Owns:
- mapping XML section-body tags to IR node types
- preserve-order parsing for section content
- inline text extraction from `<content>`, `<text>`, and `<p>`
- source-order placement of `chapeau`, labeled children, and `continuation`

#### `src/transforms/markdown.ts`
Owns:
- rendering of structured body content from IR
- indentation and heading treatment by node type
- correct ordering of parent body text versus nested children and continuation text
- preservation of existing frontmatter and notes rendering

#### `tests/unit/transforms/uslm-to-ir.test.ts`
Owns:
- parser coverage for chapeau, inline body text, continuation, and deepest hierarchy levels
- ordered-content assertions from real fixtures
- completeness guards against dropped text segments

#### `tests/unit/transforms/markdown.test.ts`
Owns:
- rendered markdown assertions for label + heading + inline text composition
- indentation coverage for every hierarchy level
- order assertions for parent text before and after nested children
- determinism assertions for repeated rendering

### 3.3 Dependency direction
Required dependency graph:

```text
CLI / tests
  -> markdown
  -> parser
  -> domain/model
  -> domain/normalize

markdown
  -> domain/model

parser
  -> domain/model
  -> domain/normalize
  -> fast-xml-parser
```

Rules:
- `markdown.ts` must render only what the IR gives it; do not re-parse XML semantics there.
- `uslm-to-ir.ts` must preserve enough ordered structure that the renderer does not need XML-aware hacks.
- Tests may compare normalized source text to rendered output, but production code remains pure transform logic.

### 3.4 Communication pattern
Direct in-process function calls only.

No queues, workers, RPC, or event buses are required.

---

## 4. Infrastructure Requirements

### 4.1 Production/runtime
This issue adds **no production infrastructure**.

Runtime requirements remain:
- Node.js 22+ compatible environment
- local filesystem output
- `fast-xml-parser` for XML parsing
- `gray-matter` for markdown frontmatter serialization

No new requirements for:
- Postgres
- Redis
- object storage
- background queues
- hosted telemetry systems

### 4.2 Dev/testing
Required local and CI capabilities:
- `npm install`
- `npm run build`
- `npm test`
- committed XML fixtures under `tests/fixtures/`
- deterministic temp-directory/file reads for test execution

### 4.3 Fixture infrastructure
Tests must remain fully local and deterministic.

Required fixture assets:
- checked-in XML fixture for Title 42 § 10307
- checked-in XML fixture for a deep nested section body
- optional checked-in expected markdown snapshots or inline snapshot expectations for stable formatting

### 4.4 CI requirements
CI must run, at minimum:

```bash
npm run build
npm test
```

Success conditions:
- model changes compile cleanly
- parser and renderer suites pass with new hierarchy coverage
- repeated rendering assertions are stable
- existing plain-text/simple-section regressions continue to pass

### 4.5 Observability and logging
No new telemetry pipeline is required.

Correctness belongs in fixture-backed tests rather than extra runtime logging.

---

## 5. Dependency Decisions

### 5.1 `fast-xml-parser` `^4.5.0`
- **Why this one:** already used by the repository; supports preserve-order parsing needed to honor XML document order for `chapeau`, child nodes, and `continuation`.
- **Alternatives rejected:** replacing the XML parser would expand scope and risk without solving the actual ordering/model gap.
- **License:** MIT-compatible.
- **Maintenance status:** active and already adopted in the repo.
- **Architecture decision:** retain it and improve transform logic rather than changing parser vendors.

### 5.2 `gray-matter` `^4.0.3`
- **Why this one:** already provides deterministic frontmatter output and is unaffected by this issue’s body-rendering changes.
- **Alternatives rejected:** custom frontmatter serialization is unnecessary risk.
- **License:** MIT-compatible.
- **Maintenance status:** mature and acceptable.
- **Architecture decision:** keep unchanged.

### 5.3 `vitest` `^3.0.0`
- **Why this one:** already powers unit and integration tests and is sufficient for fixture-backed transform verification.
- **Alternatives rejected:** no value in introducing a second test harness for localized transform work.
- **License:** MIT-compatible.
- **Maintenance status:** actively maintained.
- **Architecture decision:** extend existing suites with regression fixtures and determinism/completeness assertions.

### 5.4 No new dependencies
This issue should add **zero** new runtime or dev dependencies.

Rationale:
- the missing behavior is achievable with the current parser, IR, and renderer
- reducing dependency churn lowers regression risk
- no external service, validation engine, or formatting package is needed

---

## 6. Integration Points

### 6.1 Existing repository integrations

#### XML parser -> IR
`src/transforms/uslm-to-ir.ts` populates `SectionIR.content`.

This issue extends that integration by requiring:
- first-class node support for `subclause` and `subitem`
- ordered preservation of `chapeau` and `continuation`
- consistent inline-body extraction across all labeled levels

#### IR -> Markdown
`src/transforms/markdown.ts` consumes `SectionIR.content`.

This issue hardens that integration by making rendered markdown the canonical proof that section bodies are text-complete, not label-only.

#### Fixtures -> Transform tests
The new regression fixtures become the primary safety net proving:
- Title 42 § 10307 includes all ten paragraph texts
- deep nesting preserves subsection body text, descendant text, and continuation text in order

### 6.2 Schema reference integration
`docs/schemas/USLM-1.0.15.xsd` remains a **reference artifact**, not a runtime dependency.

Required use:
- justify supported structural elements and hierarchy expectations
- inform fixture construction and coverage
- do not add runtime XSD validation to the transform path

### 6.3 Data flow contract
Canonical data flow:

```text
OLRC/USLM XML fixture or source
  -> fast-xml-parser object model + preserve-order model
  -> parseUslmToIr()
  -> SectionIR.content with full structured body fidelity
  -> renderSectionMarkdown()
  -> generated section markdown
```

The architecture requirement is that no stage silently drops body text that exists in source XML for supported section-body tags.

---

## 7. Security Considerations

### 7.1 Input validation strategy
XML remains untrusted input at the parser boundary.

Security requirements:
- keep existing parser configuration without enabling dangerous evaluation features
- normalize extracted text with the existing normalization helpers
- preserve existing normalized-field length limits
- omit empty values rather than creating malformed markdown blocks

### 7.2 Output integrity
This issue is primarily a **data-integrity** fix.

A bad implementation can:
- drop statutory text while still producing syntactically valid markdown
- attach continuation text to the wrong sibling
- collapse deep hierarchy levels into the wrong indentation depth
- falsely appear successful because only labels remain

Therefore the architecture requires explicit tests proving:
- expected source-body segments are present in output
- parent text appears before and after nested children in the correct positions
- deepest supported levels render rather than disappearing
- repeated renders are byte-identical

### 7.3 Path and filesystem safety
No new path-generation behavior is introduced.

Guardrail:
- this issue must not expand the filesystem attack surface; only body-content correctness changes are in scope

### 7.4 Denial-of-service posture
This issue does not materially increase runtime resource risk, but recursive parsing/rendering must remain bounded by the parsed XML tree.

Guardrails:
- preserve existing normalized text-size limits
- avoid unbounded string concatenation patterns beyond current transform behavior
- do not add runtime network calls or schema validation loops

### 7.5 Secrets and sensitive data
No secrets, auth tokens, cookies, or PII are introduced by this issue.

### 7.6 Auth model / CORS / rate limiting
Not applicable. This issue does not expose an HTTP service.

---

## Implementation Plan Summary

1. Extend `src/domain/model.ts` so `ContentNode` supports `subclause` and `subitem` explicitly.
2. Introduce one canonical section-body hierarchy mapping in `src/transforms/uslm-to-ir.ts`.
3. Refactor ordered content parsing so it preserves `chapeau`, inline body text, nested labeled nodes, and `continuation` in source order for every supported level.
4. Refactor non-ordered fallback parsing to use the same hierarchy coverage and body-text extraction sources.
5. Update `src/transforms/markdown.ts` to render label + heading + inline text on the leading line and to indent all supported levels deterministically.
6. Add fixture-backed parser/renderer tests for Title 42 § 10307 and a deep-nesting section, including completeness and determinism guards.
7. Run the full Vitest suite to prove backward compatibility.

## Acceptance Mapping

| Spec Requirement | Architectural Mechanism |
|---|---|
| Preserve `<chapeau>` before first labeled child | Preserve free-text nodes in ordered container content before child rendering |
| Preserve inline body text for every labeled level | Shared inline-body extraction from `<content>`, `<text>`, and `<p>` across all node types |
| Preserve `<continuation>` after nested labeled children | Ordered container rendering with explicit trailing-text phase |
| Support all levels from `subsection` through `subitem` | First-class `ContentNode` types plus canonical hierarchy mapping |
| Deterministic indentation and source order | Single renderer indentation table and preserve-order parser traversal |
| Title 42 § 10307 regression coverage | Real XML fixture asserting chapeau + all ten paragraph texts |
| Deep nesting regression coverage | Real fixture asserting subsection body text, nested descendants, and continuation ordering |
| Existing tests continue to pass | Additive transform-only changes with full-suite validation |

## Components Affected

| Component | Change | Impact |
|---|---|---|
| `src/domain/model.ts` | Add `subclause` and `subitem` node types to `ContentNode` | Medium |
| `src/transforms/uslm-to-ir.ts` | Unify hierarchy parsing and ordered body-text preservation | High |
| `src/transforms/markdown.ts` | Render full structured bodies with deterministic indentation/order | High |
| `tests/unit/transforms/uslm-to-ir.test.ts` | Add fixture-backed completeness coverage | High |
| `tests/unit/transforms/markdown.test.ts` | Add ordered rendering and deep indentation assertions | High |
| `tests/fixtures/**` | Add Title 42 § 10307 and deep-nesting XML fixtures | Medium |

## Explicit Non-Goals
- No OLRC download or acquisition changes
- No CLI command-surface changes
- No title index/frontmatter redesign outside incidental compatibility needs
- No runtime XSD validation
- No new service, queue, database, or cache layer
