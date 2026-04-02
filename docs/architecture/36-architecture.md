# Architecture — Issue #36: GitHub-safe nested subsection rendering for markdown output

## Scope and intent

Fix nested labeled-body rendering so generated markdown never relies on leading indentation for descendant labels. Today, `src/transforms/markdown.ts` renders top-level `subsection` nodes as bold paragraph labels, but deeper labeled nodes such as `paragraph`, `subparagraph`, `clause`, `subclause`, `item`, and `subitem` are emitted via indentation. Once indentation reaches four spaces, GitHub interprets those lines as code blocks.

This issue is therefore a **renderer architecture correction**, not a parser redesign:

1. Any labeled descendant below the top rendered level must render as a GitHub-safe labeled paragraph beginning with a bold label token such as `**(A)**`, `**(i)**`, or `**(I)**`.
2. Continuation/body lines that appear inside a nested labeled hierarchy must also stay below GitHub’s four-space code-block threshold.
3. Output order must remain identical to IR traversal order.
4. Flat sections and sections that contain only top-level subsections with no deeper labeled descendants must remain byte-for-byte unchanged.
5. No persisted IR schema, CLI contract, or infrastructure boundary should change.

The implementation remains a **single-process Node.js/TypeScript CLI** with pure in-memory transforms and fixture-backed Vitest regression tests.

`.dark-factory.yml` is not present in this repository snapshot, so the concrete technology constraints come from the checked-in code and `package.json`: TypeScript, Node.js, `fast-xml-parser`, `gray-matter`, and Vitest.

No `## [security-architect]` or `## [arch-reviewer]` comments are currently present on issue #36 beyond the revised spec guidance, so this document addresses the spec directly.

---

## 1. Data model

### 1.1 Persistent storage model

No database, queue, cache, or other persistent store exists in this repo for this workflow, and none should be added.

This issue changes only:
- `src/transforms/markdown.ts`
- `tests/unit/transforms/markdown.test.ts`
- snapshots/fixtures affected by markdown rendering expectations

Accordingly:
- **No SQL migrations**
- **No seed data**
- **No indexes**
- **No storage-layer changes**

### 1.2 Runtime IR contracts

The renderer must continue consuming the existing IR shapes from `src/domain/model.ts` and `src/transforms/uslm-to-ir.ts` without schema changes.

Relevant current contract:

```ts
export interface SectionIR {
  titleNumber: number;
  sectionNumber: string;
  heading: string;
  status: SectionStatus;
  source: string;
  hierarchy?: HierarchyIR;
  statutoryNotes?: StatutoryNoteIR[];
  editorialNotes?: NoteIR[];
  content: ContentNode[];
}

interface BaseLabeledNode {
  type: 'subsection' | 'paragraph' | 'subparagraph' | 'clause' | 'subclause' | 'item' | 'subitem';
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

### 1.3 IR-level architectural decision

#### Decision: keep parser output unchanged

`parseUslmToIr()` already emits the necessary node kinds and labels. The spec explicitly forbids introducing a new persisted schema or changing section discovery behavior for this issue.

Therefore:
- `subsection`, `paragraph`, `subparagraph`, `clause`, `subclause`, `item`, `subitem`, and `text` remain the only content node kinds involved
- the renderer must infer GitHub-safe formatting from existing `type`, `label`, `heading`, `text`, and `children`
- labels must continue to derive only from current IR labels via existing `formatLabel()` behavior
- no renumbering, normalization, or label synthesis is allowed

### 1.4 Renderer output model

The relevant output contract becomes:

#### Top-level subsection contract — unchanged

Sections whose content contains only top-level subsections with no deeper labeled descendants must remain byte-for-byte unchanged.

Accepted output forms remain:

```md
**(a)** text
**(a) Heading** text
**(a) Heading**
```

This preserves issue #31 behavior.

#### Nested labeled descendant contract — new required behavior

For any labeled node of type `paragraph`, `subparagraph`, `clause`, `subclause`, `item`, or `subitem`, and for any nested `subsection` when it appears below the top rendered level:

```md
**(G)**

**(i)** is an alien ...

**(ii)** acts for or on behalf of ...
```

Rules:
- the rendered line must begin with `**(` after any separating blank line
- the rendered line must not begin with literal indentation spaces
- each labeled block must be separated from the prior rendered block by exactly one blank line when adjacent to body text or another labeled block
- rendering order remains parent first, then children in source order

#### Continuation/body line contract

When continuation/body text is rendered as its own line inside an affected nested hierarchy, it must not begin with four or more literal spaces.

Permitted examples:

```md
Continuation text for the parent clause.
```

```md
  Continuation text.
```

Forbidden example:

```md
    Continuation text.
```

### 1.5 Byte-stability invariants

The renderer must preserve these invariants:

- flat sections remain byte-for-byte unchanged
- sections with only top-level subsections and no deeper labeled descendants remain byte-for-byte unchanged
- top-level subsection formatting remains the same as issue #31
- nested labeled descendants never appear as `\n    (i)` / `\n    (ii)` / equivalent four-space-indented labels
- nested continuation/body lines inside affected hierarchies never start with four or more spaces
- output order remains identical to tree traversal order
- rendering remains deterministic and side-effect-free

---

## 2. API contract

This repository exposes **no HTTP API**. The external contract for this issue is:
- generated markdown text
- the exported renderer functions in `src/transforms/markdown.ts`
- regression coverage in Vitest snapshots/assertions

### 2.1 CLI contract

No CLI surface changes are required.

Existing CLI behavior and arguments remain unchanged.

### 2.2 Markdown output contract

#### Affected examples

Required nested output shape:

```md
**(G)**

**(i)** is an alien (other than an alien lawfully admitted...)

**(ii)** acts for or on behalf of...

**(H)** has been discharged from the Armed Services...
```

Required deep nesting shape:

```md
**(A)**

**(i)**

**(I)** text
```

Forbidden forms:

```md
    (i) text
```

```md
      (I) text
```

```md
    Continuation text
```

### 2.3 Auth, rate limits, pagination

Not applicable. No network API is introduced.

---

## 3. Service boundaries

### 3.1 Architectural style

Keep the implementation inside the existing monolithic CLI.

Reasons:
- the problem is pure IR-to-markdown formatting
- there is no latency, scaling, or deployment boundary to isolate
- adding services would create operational complexity without reducing risk
- fixture-backed tests are the correct control plane for this class of defect

### 3.2 Module ownership

#### `src/transforms/uslm-to-ir.ts`

Ownership remains unchanged.

For this issue, parser responsibilities are:
- emit the same labeled hierarchy as today
- preserve existing section discovery behavior
- require no schema changes

Architectural rule:
- parser tests must continue to pass unchanged unless an assertion is updated only because markdown output expectations changed elsewhere

#### `src/transforms/markdown.ts`

Owns the full implementation for issue #36.

Required changes:
- distinguish between top-level subsection rendering and nested labeled-descendant rendering
- stop using indentation as the primary structural encoding for affected nested labeled nodes
- emit bold labels for nested labeled descendants
- insert exactly one blank line between adjacent labeled blocks and between body text and the next labeled block
- ensure continuation/body lines within affected hierarchies do not cross the four-space code-block threshold
- preserve byte-for-byte output for unaffected section shapes

Recommended helper responsibilities:

```ts
function renderContentNodes(...): string[];
function renderContentNodeLines(...): string[];
function renderStructuredLine(...): string;
function renderLabeledLine(...): string;
function shouldSeparateWithBlankLine(...): boolean;
function shouldSeparateStructuredChildren(...): boolean;
```

Architectural rule:
- the renderer may add depth/context-aware logic, but it must remain a pure line-emission transform over the current `ContentNode[]`

#### `tests/unit/transforms/markdown.test.ts`

Owns regression protection for this issue.

Required additions/updates:
- assert nested descendant labels render as `**(A)**`, `**(i)**`, `**(I)**`
- assert rendered markdown does not contain `\n    (i)` or `\n    (ii)`
- assert real-world-shaped hierarchy output contains blank-line-separated descendant labels
- assert unaffected flat or top-level-only cases remain unchanged
- update snapshots only where issue #36 intentionally changes output

### 3.3 Dependency direction

Dependency direction remains:

```text
src/index.ts
  -> src/transforms/uslm-to-ir.ts
       -> src/domain/model.ts
       -> src/domain/normalize.ts
  -> src/transforms/markdown.ts
       -> src/domain/model.ts
       -> src/domain/normalize.ts
```

No new dependencies or circular references should be introduced.

### 3.4 Communication pattern

Direct in-process function calls only.

No:
- queue
- worker
- RPC
- subprocess
- network call

---

## 4. Infrastructure requirements

### 4.1 Runtime requirements

Production/runtime environment for this repo remains:
- Node.js 22+
- TypeScript 5.8+
- npm-based install/build/test
- local filesystem for fixtures and generated markdown

No additional runtime infrastructure is required.

### 4.2 Storage and services

- **Primary storage:** local files in repo output paths
- **Database:** none
- **Queue:** none
- **Cache:** none
- **Object storage:** none
- **DNS/certificates:** none
- **Monitoring service:** none required for this transform-only change

### 4.3 Development and testing requirements

Required verification commands remain:

```bash
npm install
npm run build
npm test
```

Minimum focused verification for this issue:

```bash
npx vitest run tests/unit/transforms/markdown.test.ts
```

If snapshots change, review them narrowly and reject unrelated churn.

### 4.4 CI requirements

Existing CI is sufficient:
- install dependencies
- run TypeScript build
- run Vitest

No containers, secrets, service mocks, or environment variables are required.

### 4.5 Rollback plan

Rollback is a standard git revert of:
- `src/transforms/markdown.ts`
- `tests/unit/transforms/markdown.test.ts`
- relevant snapshots

No data migration or cleanup is required.

---

## 5. Dependency decisions

No new dependency should be added for this issue.

| Dependency | Version in repo | Role in this issue | Why keep it | License | Maintenance status |
|---|---:|---|---|---|---|
| `typescript` | `^5.8.0` | typed renderer/test refactor | existing project standard; fully sufficient | Apache-2.0 | actively maintained |
| `vitest` | `^3.0.0` | renderer regression tests and snapshots | already used; ideal for exact output assertions | MIT | actively maintained |
| `gray-matter` | `^4.0.3` | frontmatter serialization around markdown body | already part of renderer path; unaffected but retained | MIT | mature/stable |
| `fast-xml-parser` | `^4.5.0` | parser dependency | parser is unchanged for this issue | MIT | actively maintained |
| `yauzl` | `^3.1.0` | unrelated ZIP support | unaffected | MIT | mature/stable |
| `@types/node` | `^22.0.0` | Node typings | existing dev support | MIT | maintained |

### 5.1 Explicit non-decisions

- **No markdown AST framework** (`remark`, `mdast`, etc.)
  - plain line-based emission is already in place
  - the defect is policy/formatting, not markdown parsing complexity

- **No parser schema change**
  - the spec explicitly keeps parser IR stable

- **No formatter-only post-processing pass outside the renderer**
  - safety rules should live where labeled nodes are rendered, not in a fragile regex cleanup layer after full document assembly

---

## 6. Integration points

### 6.1 Existing integration points reused

#### IR source
`src/transforms/uslm-to-ir.ts`
- continues producing labeled content trees
- remains untouched unless test scaffolding or type clarifications become necessary

#### Markdown renderer
`src/transforms/markdown.ts`
- remains the only implementation boundary for nested label emission
- owns blank-line insertion rules and indentation safety

#### Regression suite
`tests/unit/transforms/markdown.test.ts`
- validates exact markdown behavior for synthetic and real-fixture cases

### 6.2 Data flow

```text
USLM XML
  -> parseUslmToIr()
       -> TitleIR / SectionIR / ContentNode[]
  -> renderSectionMarkdown() / renderChapterMarkdown() / renderUncategorizedMarkdown()
       -> renderContentNodes()
       -> renderContentNodeLines()
       -> renderStructuredLine()
       -> compactLines()
  -> final markdown
```

### 6.3 Formatting decision boundary

The renderer must make one key distinction:

1. **Unaffected path**
   - flat body text
   - top-level subsection-only output
   - preserve existing byte output

2. **Affected path**
   - any subtree containing labeled descendants below the first rendered level
   - render descendant labels as bold standalone paragraphs without indentation-based structure

Preferred implementation approach:
- make rendering decisions based on node depth and/or whether the current node is in a nested labeled hierarchy
- keep top-level subsection formatting path intact
- move nested labeled descendants to a dedicated bold-label rendering path rather than reusing the old indentation-only path

### 6.4 Blank-line contract

The line separator helpers must guarantee:
- exactly one blank line between adjacent labeled blocks
- exactly one blank line between non-blank body text and the next labeled block
- no duplicate empty paragraphs
- no reordering of siblings or continuations

---

## 7. Security considerations

This issue is not about auth or secrets, but it does have a **rendering safety** dimension because GitHub’s markdown rules can misrepresent statutory text.

### 7.1 Output integrity

Risk:
- four-space-indented nested labels are rendered by GitHub as code blocks, materially changing legal text presentation

Control:
- nested labeled descendants must never begin with four or more literal spaces
- tests must explicitly assert the absence of code-block-triggering forms such as `\n    (i)`

### 7.2 Determinism

Risk:
- ad hoc blank-line insertion can cause unstable snapshots or sibling/body reordering

Control:
- centralize separation logic in the renderer
- assert exact output boundaries in tests, including `\n\n**(i)**`
- maintain pure, side-effect-free functions only

### 7.3 Label authenticity

Risk:
- a fix that synthesizes or rewrites labels could introduce legal formatting errors

Control:
- derive label text exclusively from existing IR labels through current `formatLabel()` behavior
- do not renumber, normalize, or infer missing labels

### 7.4 Sensitive data, auth, encryption, rate limits, CORS

Not applicable. This issue introduces:
- no secrets
- no PII handling
- no remote API
- no browser surface
- no CORS policy
- no rate limiting requirement

---

## 8. Concrete implementation plan

### 8.1 `src/transforms/markdown.ts`

1. Preserve the current top-level subsection rendering path exactly as-is for unaffected sections.
2. Introduce nested-hierarchy-aware rendering rules for labeled descendants.
3. Change `renderLabeledLine()` and/or `renderStructuredLine()` so affected nested labeled nodes emit bold labels at column 0 rather than indentation-based labels.
4. Ensure continuation/body lines emitted within those nested hierarchies never start with four or more spaces.
5. Keep parent-before-children traversal and existing child ordering intact.
6. Keep `compactLines()` behavior compatible with exact single blank-line separation.

### 8.2 `tests/unit/transforms/markdown.test.ts`

1. Replace current indentation-based deep-hierarchy expectations for affected nested descendants with bold-label expectations.
2. Add focused assertions for:
   - `**(A)**`
   - `**(i)**`
   - `**(I)**`
   - absence of `\n    (i)` and `\n    (ii)`
   - presence of `\n\n**(i)**`
3. Add or update a real-world-shaped nested fixture case matching `(G) -> (i) -> (ii)`.
4. Preserve byte-stable assertions for flat and top-level-only cases.

### 8.3 Verification

Run:

```bash
npm run build
npx vitest run tests/unit/transforms/markdown.test.ts
```

If any parser-path tests transitively depend on markdown snapshots, run the full suite before merge.

---

## 9. Acceptance mapping

| Spec requirement | Architectural decision |
|---|---|
| Nested labeled descendants must begin with bold labels and no indentation | route nested labeled nodes through a GitHub-safe bold-label rendering path |
| `(G) -> (i)` and `(A) -> (i) -> (I)` must render safely | make descendant rendering depth-aware, not node-type-indentation-driven |
| Continuation/body lines inside nested hierarchies must stay below four spaces | cap/remove indentation for continuation lines in affected nested hierarchies |
| Every labeled block must have exact blank-line separation | keep centralized separator logic and assert exact `\n\n` boundaries |
| Preserve source order | keep current depth-first traversal and child ordering |
| Top-level subsection rendering must remain unchanged | preserve existing subsection-specific rendering path from issue #31 |
| Parser/IR must remain unchanged | confine the fix to renderer logic and renderer-focused tests |
| Flat and top-level-only sections must remain byte-for-byte unchanged | gate new formatting behavior to affected nested labeled hierarchies only |

---

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Fix accidentally changes flat/top-level-only output | High | explicitly gate new behavior to affected nested hierarchies and keep snapshot coverage for unaffected cases |
| Nested labels still render with hidden four-space prefixes in some branch | High | add negative assertions for code-block-triggering forms in tests |
| Blank-line logic adds duplicate empty paragraphs | Medium | centralize separator rules and use exact string assertions |
| Continuation text is left indented at four spaces while labels are fixed | High | treat continuation/body lines in affected hierarchies as part of the same GitHub-safety contract |
| Renderer starts synthesizing label text | High | use only existing IR labels plus current `formatLabel()` behavior |
| Overbroad fix changes embedded/standalone heading behavior | Medium | scope changes to content-node rendering only, not section-heading rendering |

---

## 11. Decision summary

1. **This is a renderer-only architecture change.** The parser and IR schema remain stable.
2. **Indentation is no longer a safe encoding for nested labeled descendants on GitHub.** Bold-label paragraph rendering becomes the required representation below the top level.
3. **Compatibility must be narrow and explicit.** Flat sections and top-level-subsection-only sections remain byte-for-byte unchanged.
4. **Exact blank-line boundaries are part of the contract.** Correctness is not just label text, but paragraph separation.
5. **Tests are the primary control mechanism.** The fix should be enforced through focused markdown assertions and minimal snapshot updates.
