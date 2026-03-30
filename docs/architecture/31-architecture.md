# Architecture — Issue #31: GitHub-safe section anchors and separated subsection paragraphs

## Scope and intent

Fix two markdown-rendering defects in the existing chapter/embed renderer without changing the repository’s overall architecture:

1. Embedded section headings must stop emitting literal GitHub-visible ` {#section-...}` suffixes and instead emit a standalone HTML anchor line immediately before each embedded section heading.
2. Structured subsection headings in embedded markdown must be separated by blank lines so sibling subsections render as distinct paragraphs in GitHub-flavored Markdown.

This remains a **single-package TypeScript CLI**. The work is limited to pure renderer behavior and regression tests. No parser changes, database, HTTP API, queue, cache, or filesystem/network I/O changes are required.

`.dark-factory.yml` is not present in this repo snapshot, so architectural constraints come from the live codebase and `package.json`: Node.js, TypeScript, `gray-matter`, `fast-xml-parser`, and Vitest.

---

## 1. Data model

### 1.1 Persistent storage model

No database or persistent schema changes are required.

This issue only changes:
- pure markdown rendering in `src/transforms/markdown.ts`
- regression coverage in `tests/unit/transforms/markdown.test.ts`
- possibly markdown snapshots if output fixtures are snapshot-covered

Accordingly:
- **No SQL migrations**
- **No seed data**
- **No indexes**
- **No runtime persistence changes**

### 1.2 Runtime IR contracts reused as-is

The existing IR remains authoritative.

```ts
interface SectionIR {
  titleNumber?: number;
  sectionNumber: string;
  heading?: string;
  content: ContentNode[];
  statutoryNotes?: StatutoryNoteIR[];
  editorialNotes?: NoteIR[];
}

interface ContentNode {
  type?: string;
  kind?: string;
  label?: string;
  heading?: string;
  text?: string;
  children?: ContentNode[];
}
```

No schema expansion is needed. This issue only tightens renderer semantics for existing fields.

### 1.3 Renderer output contract

#### Standalone section mode

`renderSectionMarkdown(section)` must continue to emit:

```md
# § 8. Respect for flag
```

Rules:
- no prepended HTML anchor line
- no trailing ` {#...}` suffix
- existing frontmatter contract remains unchanged

#### Embedded/chapter mode

When embedded rendering is invoked with an anchor derived from `embeddedSectionAnchor(section.sectionNumber)`, output must become:

```md
<a id="section-8"></a>
## § 8. Respect for flag
```

Rules:
- anchor line is on its own line immediately before the section heading
- anchor format is exactly `<a id="section-<normalized-id>"></a>`
- no embedded heading may contain literal ` {#...}` text
- if no anchor option is supplied, no HTML anchor line is emitted

#### Structured subsection paragraph separation

For structured subsection headings in embedded/chapter mode, sibling subsection blocks must be separated by exactly one blank line in compacted output.

Required shape:

```md
Chapeau text.

**(a)** First subsection text.

**(b)** Second subsection text.
```

Rules:
- blank-line separation applies whether the previous block is chapeau text or another subsection block
- existing bold label/heading forms remain unchanged:
  - `**(a)** body text`
  - `**(a) Heading** body text`
  - `**(a) Heading**`
- nested child ordering and indentation remain unchanged

### 1.4 Invariants

The implementation must preserve these invariants:

- standalone section markdown still starts with `# § ...`
- standalone output never gains an HTML anchor line
- embedded output never contains literal `{#section-...}` fragments
- embedded output uses the existing `embeddedSectionAnchor()` normalization helper unchanged
- every structured subsection block is isolated as its own markdown paragraph in compacted output
- child node ordering remains parent before children, in original source order
- renderer functions remain pure string/array transforms with no I/O

---

## 2. API contract

This repository exposes no HTTP API. The external contract for this issue is the CLI-generated markdown files and the renderer function behavior exercised through tests.

### 2.1 CLI surface

No CLI grammar changes are required.

Existing usage remains:

```bash
us-code-tools transform --title <number> --output <dir> [--group-by chapter]
```

### 2.2 Generated markdown contract

#### Standalone section output

```md
# § 8. Respect for flag
```

Must not become:

```md
<a id="section-8"></a>
# § 8. Respect for flag
```

#### Embedded section output

Must become:

```md
<a id="section-8"></a>
## § 8. Respect for flag
```

Must not contain:

```md
## § 8. Respect for flag {#section-8}
```

#### Structured subsection output

Example required output:

```md
The following rules apply.

**(a)** The flag should never be displayed with the union down.

**(b)** The flag should never touch anything beneath it.
```

Rules:
- subsection formatting stays inline-bold, not promoted to markdown headings
- paragraph separation must be GitHub-safe and require no custom markdown extensions

### 2.3 Auth, rate limits, pagination

Not applicable. No network API or service is introduced.

---

## 3. Service boundaries

### 3.1 Architectural style

Keep the implementation inside the current monolithic CLI. No service split is justified because:
- the problem is pure markdown rendering behavior
- there is no independent scaling or deployment concern
- correctness is best enforced in renderer-level tests

### 3.2 Module ownership

#### `src/transforms/markdown.ts`

Owns:
- section heading rendering
- embedded/chapter body assembly
- structured content node rendering
- subsection line formatting

Required changes:
- change embedded heading rendering so anchor markup is emitted as a separate line before the heading instead of as a trailing ` {#...}` suffix
- preserve standalone section heading behavior
- ensure blank-line separation is inserted before every structured subsection block when rendering embedded/chapter output
- preserve existing nested child indentation and ordering

Recommended helper contract:

```ts
function renderSectionHeading(section: SectionIR, level: number): string;
function renderSectionAnchor(anchor?: string): string[];
function renderContentNodes(...): string[];
function shouldSeparateWithBlankLine(existingLines: string[], nextLines: string[]): boolean;
function renderSubsectionHeading(label: string, heading: string, text: string): string;
```

Design rule:
- `renderSectionHeading()` should return only the markdown heading line
- anchor emission should be handled separately so standalone and embedded modes can share heading logic without reintroducing GitHub-visible suffixes

#### `src/domain/normalize.ts`

Owns:
- `embeddedSectionAnchor()` normalization

Required changes:
- none expected for normalization behavior
- renderer must keep using this helper as the sole source of embedded anchor IDs

#### `tests/unit/transforms/markdown.test.ts`

Owns:
- regression verification for renderer behavior

Required additions:
- assert embedded markdown contains `<a id="section-8"></a>` immediately before `## § 8. ...`
- assert embedded markdown does not contain `{#section-8}`
- assert standalone section markdown still lacks prepended anchor markup
- assert sibling structured subsections render with `\n\n**(a)` and `\n\n**(b)` paragraph boundaries
- assert nested child ordering/indentation remains stable

### 3.3 Dependency direction

```text
src/index.ts
  -> src/transforms/uslm-to-ir.ts
  -> src/transforms/write-output.ts
       -> src/transforms/markdown.ts
       -> src/domain/normalize.ts
       -> src/domain/model.ts
```

Rules:
- `markdown.ts` remains pure and may consume normalization helpers
- no renderer logic may introduce filesystem/network/process access
- parser and writer boundaries remain unchanged

### 3.4 Communication pattern

Direct in-process function calls only.

No:
- queue
- event bus
- worker
- RPC
- background task

---

## 4. Infrastructure requirements

### 4.1 Runtime requirements

For this repo, “production” is a local or CI Node.js process running the CLI.

Required runtime:
- Node.js 22+
- existing npm dependency set
- writable local filesystem for transform output (unchanged)

No additional infrastructure is required.

### 4.2 Storage and services

- **Primary storage:** local filesystem output tree
- **No database**
- **No Redis**
- **No object storage**
- **No queue**
- **No CDN**

### 4.3 Development and test requirements

Required commands remain:

```bash
npm install
npm run build
npm test
```

Recommended verification for this issue:

```bash
npm run build
npx vitest run tests/unit/transforms/markdown.test.ts
```

### 4.4 CI requirements

Existing CI remains sufficient:
- install dependencies
- run TypeScript build
- run Vitest

No new secrets, containers, or services are required.

### 4.5 Rollback plan

Rollback is a normal git revert of:
- renderer changes in `src/transforms/markdown.ts`
- regression tests and snapshots

No migration or data cleanup is required.

---

## 5. Dependency decisions

No new dependencies should be added.

| Dependency | Version in repo | Role in this issue | Why keep it | License | Maintenance status |
|---|---:|---|---|---|---|
| `typescript` | `^5.8.0` | typed renderer changes | existing repo standard; no need for new tooling | Apache-2.0 | actively maintained |
| `vitest` | `^3.0.0` | regression coverage | already used for unit and snapshot verification | MIT | actively maintained |
| `gray-matter` | `^4.0.3` | unchanged frontmatter rendering | already part of markdown pipeline | MIT | mature/stable |
| `fast-xml-parser` | `^4.5.0` | unaffected parser dependency | no parser replacement needed | MIT | actively maintained |
| `yauzl` | `^3.1.0` | unrelated ZIP input path | unchanged for this issue | MIT | mature/stable |
| `@types/node` | `^22.0.0` | Node typings | existing repo dependency | MIT | maintained |

### 5.1 Explicit non-decisions

- **No markdown AST library** (`remark`, `mdast`, etc.)
  - the required change is small and deterministic
  - string/line-based rendering is already sufficient

- **No anchor-normalization package**
  - the repo already has `embeddedSectionAnchor()`
  - adding another slug/anchor dependency would create drift risk

- **No parser changes**
  - the issue is purely renderer formatting behavior

---

## 6. Integration points

### 6.1 Existing integration points reused

#### IR -> markdown
`src/transforms/uslm-to-ir.ts` -> `src/transforms/markdown.ts`

Unchanged boundary. The renderer continues consuming `SectionIR` and `ContentNode[]` exactly as today.

#### Anchor normalization
`src/transforms/markdown.ts` -> `src/domain/normalize.ts`

Unchanged contract:
- embedded/chapter rendering derives anchor IDs through `embeddedSectionAnchor(section.sectionNumber)`
- normalization rules for values like `36B` and `2/3` remain unchanged

#### Markdown tests
`tests/unit/transforms/markdown.test.ts`

Expanded contract:
- verify GitHub-safe embedded anchor markup
- verify paragraph-separated subsection output
- ensure existing standalone and nested-order behavior still passes

### 6.2 Data flow

```text
SectionIR
  -> renderSectionBody(section, options)
       -> renderSectionAnchor(options.anchor)
       -> renderSectionHeading(section, level)
       -> renderContentNodes(content, options)
            -> renderStructuredLine(...)
                 -> renderSubsectionHeading(...) or renderLabeledLine(...)
       -> compactLines(...)
  -> final markdown string
```

Key rule:
- embedded anchor emission must happen before heading insertion in the line array, not as an inline heading suffix

### 6.3 Blank-line separation logic

The separator decision must recognize structured subsection blocks as paragraph starts even when they follow:
- unlabeled chapeau text
- another structured subsection block
- mixed paragraph/subsection/paragraph sequences

Recommended rule:
- if the next rendered block is a structured subsection block, insert a blank line whenever there is already prior rendered content and the immediately preceding block is not already separated
- compacting should still reduce duplicate blank lines to one

This keeps exact markdown semantics simple and deterministic.

---

## 7. Security considerations

### 7.1 HTML output allowlist

This issue introduces or formalizes embedded raw HTML output in markdown. The allowed HTML must be narrowly constrained to:

```html
<a id="section-..."></a>
```

Controls:
- only `id` attribute is emitted
- anchor value comes only from the existing normalization helper
- no dynamic tag names, event handlers, scripts, styles, or arbitrary HTML fragments

### 7.2 Input and output safety

Risks:
- malformed or unexpected section numbers could lead to malformed anchor markup if normalization is bypassed
- ad hoc string concatenation could reintroduce literal `{#...}` fragments or duplicate blank lines

Controls:
- use `embeddedSectionAnchor()` as the sole anchor ID source
- emit anchor markup only when a non-empty anchor string is supplied
- keep line compaction centralized so duplicate separators collapse predictably

### 7.3 Determinism as a safety property

Deterministic output matters because renderer regressions are caught through exact text assertions and snapshots.

Required controls:
- exact anchor line placement before the heading
- no mode-dependent normalization drift
- exact one-blank-line paragraph separation in compacted output
- stable child ordering and indentation

### 7.4 Sensitive data, auth, encryption, CORS, rate limiting

Not applicable. No secrets, PII, network API, or browser-side capability changes are introduced.

---

## 8. Concrete implementation plan

### 8.1 `src/transforms/markdown.ts`

1. Separate anchor-line emission from `renderSectionHeading()`.
2. Update embedded rendering so line assembly becomes:
   - optional anchor line
   - section heading line
   - content lines
3. Preserve standalone section rendering with no anchor line.
4. Update subsection separation logic so each structured subsection block is preceded by a blank line when it is not the first rendered block.
5. Keep `renderSubsectionHeading()` output format unchanged except for paragraph separation behavior around it.

### 8.2 `tests/unit/transforms/markdown.test.ts`

1. Add a chapter/embed rendering test for anchor-line output.
2. Assert absence of `{#section-...}` in embedded markdown.
3. Add a structured subsection regression with sibling `(a)` and `(b)` subsection nodes.
4. Assert `\n\n**(a)` and `\n\n**(b)` boundaries.
5. Assert standalone section output still begins with `# § ...` and has no prepended anchor line.

### 8.3 Snapshot updates

If snapshot-covered outputs change, update only snapshots directly affected by:
- embedded anchor formatting
- subsection paragraph separation

No unrelated snapshot churn is acceptable.

---

## 9. Acceptance mapping

| Spec requirement | Architectural decision |
|---|---|
| Embedded headings must stop showing `{#...}` | emit standalone `<a id="section-..."></a>` line before embedded heading |
| Standalone section markdown must remain unchanged | keep anchor emission outside standalone rendering path |
| Structured subsections must render as distinct paragraphs | treat every structured subsection block as paragraph-separated content |
| Bold subsection label/heading format must remain | keep `renderSubsectionHeading()` text shape unchanged |
| Child ordering/indentation must remain stable | only adjust separator logic, not recursive child rendering |
| Tests must cover both regressions | add targeted unit assertions and update affected snapshots only |
| No new I/O in renderer | keep all changes inside pure string/array transform helpers |

---

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Anchor markup accidentally appears in standalone section output | High | separate anchor emission from heading rendering and gate it on embedded mode only |
| Blank-line logic inserts too many separators | Medium | rely on central `compactLines()` to collapse duplicates and assert exact output in tests |
| Consecutive subsection nodes still collapse in GitHub | High | explicitly classify subsection blocks as paragraph starts and add sibling subsection regression coverage |
| Nested child indentation/order regresses | Medium | do not change recursive child traversal; add ordering assertions around subsection tests |
| Anchor normalization drifts for `36B` or `2/3` | Medium | continue using existing `embeddedSectionAnchor()` helper without modification |

---

## 11. Decision summary

1. **Keep the architecture monolithic and additive.** This is a small renderer correctness fix, not a systems change.
2. **Emit embedded anchors as standalone HTML lines, not markdown heading suffixes.** That is the GitHub-compatible fix with the least churn.
3. **Keep standalone section rendering unchanged.** The anchor behavior belongs only to embedded/chapter mode.
4. **Solve subsection rendering through separator logic, not a new node model.** The IR is already sufficient.
5. **Enforce behavior through focused renderer tests.** Exact text assertions are the right guardrail for this class of regression.
