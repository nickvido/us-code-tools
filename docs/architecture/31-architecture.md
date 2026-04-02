# Architecture — Issue #31: GitHub-safe anchors, canonical OLRC links, preserved note structure, and embedded-Act containment

## Scope and intent

Fix all six user-visible markdown/parser regressions covered by `docs/specs/31-spec.md` while preserving the project’s existing architecture as a single-package TypeScript CLI:

1. Embedded section headings must emit standalone HTML anchors instead of literal GitHub-visible `{#section-...}` suffixes.
2. Structured subsection siblings must be separated by blank lines so GitHub renders them as distinct paragraphs.
3. Canonical OLRC cross-reference URLs must include `&num=0&edition=prelim` in both fallback links and frontmatter source URLs.
4. Multi-paragraph statutory/editorial notes must preserve paragraph boundaries instead of collapsing into one whitespace-normalized wall of text.
5. Embedded Acts appearing inside note content must remain inside note scope and must not produce extra top-level `SectionIR` records.
6. Historical and Revision Notes tables must preserve row/column structure in markdown instead of flattening into concatenated text.

This remains a **monolithic Node.js/TypeScript CLI**. No database, HTTP API, queue, cache, or separate service is warranted. The change spans renderer and parser behavior, but it stays inside pure transform modules plus regression tests.

`.dark-factory.yml` is not present in this repo snapshot, so the concrete constraints come from the checked-in code and `package.json`: Node.js, TypeScript, `fast-xml-parser`, `gray-matter`, and Vitest.

---

## 1. Data model

### 1.1 Persistent storage model

No database or external persistence layer exists in this repo, and none should be added for this issue.

This issue changes only in-memory IR construction and markdown serialization in:
- `src/domain/normalize.ts`
- `src/transforms/uslm-to-ir.ts`
- `src/transforms/markdown.ts`
- `tests/unit/transforms/markdown.test.ts`
- `tests/unit/transforms/uslm-to-ir.test.ts`

Accordingly:
- **No SQL migrations**
- **No seed data**
- **No indexes**
- **No runtime persistence changes**

### 1.2 Runtime IR contracts

The architecture should continue using the existing title/section/content/note IR model as the system of record.

Representative current contracts:

```ts
interface TitleIR {
  titleNumber: number;
  heading: string;
  positiveLaw: boolean | null;
  chapters: Array<{ number: string; heading: string }>;
  sections: SectionIR[];
  sourceUrlTemplate: string;
}

interface SectionIR {
  titleNumber?: number;
  sectionNumber: string;
  heading?: string;
  source?: string;
  sourceCredit?: string;
  hierarchy?: HierarchyIR;
  statutoryNotes?: StatutoryNoteIR[];
  editorialNotes?: NoteIR[];
  content: ContentNode[];
}

interface ContentNode {
  type?: string;
  kind?: string;
  label?: string;
  heading?: string;
  text?: string;
  children?: ContentNode[];
}

interface StatutoryNoteIR {
  heading?: string;
  noteType?: string;
  topic?: string;
  text: string;
}

interface NoteIR {
  kind: 'editorial' | 'cross-reference' | 'misc';
  text: string;
}
```

### 1.3 IR-level decisions for this issue

The spec does **not** require introducing a database-like schema or service layer, but it does require clarifying how notes are represented so renderer behavior remains deterministic and mechanically testable.

#### Decision: keep `SectionIR` ownership unchanged

`TitleIR.sections` must continue to contain only real codified title/body sections.

That means:
- embedded Act provisions found **inside note XML** must not be promoted to sibling `SectionIR` objects
- section discovery must be constrained to the true title/body section hierarchy, not arbitrary nested `<section>` descendants under notes or note-like containers
- fixing this issue must not suppress legitimate codified sections already discovered from the title body

#### Decision: preserve note structure before final rendering

The existing `text: string` note shape can remain if the parser produces a deterministic markdown-ready serialization, but the architecture must treat note extraction as **structure-preserving**, not plain whitespace normalization.

Required structural boundaries:
- distinct source `<p>` nodes become distinct markdown paragraphs separated by `\n\n`
- note tables are serialized as distinct markdown table blocks with preserved row order and cell boundaries
- prose before/after a table remains before/after the table in the same source order, with blank-line separation
- embedded Act text remains part of the originating note body serialization

If implementation pressure makes a plain string too brittle, the acceptable architectural extension is to introduce an internal note-block representation such as:

```ts
type NoteBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'table'; rows: string[][] };
```

and serialize to `text` only at the outermost renderer boundary. The key architectural rule is that paragraph/table boundaries are preserved until final markdown emission.

### 1.4 Renderer output contracts

#### Standalone section mode

`renderSectionMarkdown(section)` must continue to emit a normal top-level markdown heading:

```md
# § 8. Respect for flag
```

Rules:
- no prepended HTML anchor line
- no trailing `{#...}` suffix
- existing standalone frontmatter semantics remain unchanged except for corrected source URLs when they originate from normalized canonical URLs

#### Embedded/chapter mode

Embedded rendering must emit a standalone anchor line immediately before each section heading:

```md
<a id="section-8"></a>
## § 8. Respect for flag
```

Rules:
- exact emitted shape: `<a id="section-<normalized-id>"></a>`
- anchor line is on its own line immediately before the heading
- anchor IDs come **only** from `embeddedSectionAnchor()`
- embedded output must never contain literal `{#section-...}` text

#### Structured subsection paragraphing

Structured subsection siblings must render as separate markdown paragraphs in compacted output:

```md
No disrespect should be shown to the flag...

**(a)** The flag should never be displayed...

**(b)** The flag should never touch...
```

Rules:
- blank-line separation is required when a subsection block follows chapeau/body text or another subsection block
- existing inline bold formats remain unchanged:
  - `**(a)** body`
  - `**(a) Heading** body`
  - `**(a) Heading**`
- nested paragraph/subparagraph/clause/item ordering and indentation remain unchanged

#### Canonical OLRC URL contract

The normalized canonical section URL is:

```text
https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title{title}-section{section}&num=0&edition=prelim
```

This exact contract must be used in:
- `buildCanonicalSectionUrl(titleNumber, sectionNumber)`
- chapter-mode fallback link rewriting
- per-section default `source`
- `TitleIR.sourceUrlTemplate` / chapter frontmatter / uncategorized frontmatter where a source URL is emitted

### 1.5 Invariants

The implementation must preserve these invariants:

- standalone section markdown still starts with `# § ...`
- standalone section markdown never gains embedded HTML anchor lines
- embedded output never contains literal `{#section-...}` fragments
- anchor IDs are always produced by `embeddedSectionAnchor()` and never by ad hoc normalization
- canonical OLRC links always include both `num=0` and `edition=prelim`
- note paragraph boundaries correspond to source paragraph boundaries
- note tables preserve row/column ordering in their serialized markdown form
- embedded Act content never appears as additional top-level `SectionIR` records
- parser/renderer modules remain deterministic, in-process transforms with no new I/O side effects

---

## 2. API contract

This repository exposes no HTTP API. The external contract for this issue is the generated markdown plus the parser/renderer function behavior verified in tests.

### 2.1 CLI contract

No CLI grammar changes are required.

Existing usage remains unchanged:

```bash
us-code-tools transform --title <number> --output <dir> [--group-by chapter]
```

### 2.2 Generated markdown contract

#### Embedded section anchor contract

Required embedded output:

```md
<a id="section-8"></a>
## § 8. Respect for flag
```

Forbidden embedded output:

```md
## § 8. Respect for flag {#section-8}
```

#### Subsection paragraph contract

Required shape:

```md
Lead-in paragraph.

**(a)** First subsection.

**(b)** Second subsection.
```

#### Canonical link contract

Required fallback link shape:

```md
[section 8](https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title4-section8&num=0&edition=prelim)
```

#### Note paragraph contract

Required multi-paragraph note shape:

```md
First note paragraph.

Second note paragraph.

Third note paragraph.
```

Single-paragraph notes must remain single-paragraph output with no extra leading/trailing blank lines.

#### Note table contract

Required representation: plain GitHub-flavored markdown table syntax, for example:

```md
| Revised Section | Source (U.S. Code) | Source (Statutes at Large) |
| --- | --- | --- |
| 1 | R.S. § 123 | June 1, 1900, ch. 1, 31 Stat. 1 |
```

Rules:
- preserve header/body reading order
- preserve row boundaries
- preserve cell boundaries
- preserve surrounding prose before/after the table with blank-line separation
- do not introduce custom markdown extensions, raw table HTML passthrough, or client-side rendering assumptions

### 2.3 Auth, rate limits, pagination

Not applicable. No network API or service is introduced.

---

## 3. Service boundaries

### 3.1 Architectural style

Keep the implementation inside the existing monolithic CLI.

No service split is justified because:
- the problem is deterministic XML-to-IR and IR-to-markdown transformation
- there is no independent scaling boundary
- introducing services would add operational complexity without addressing the failure mode
- correctness is best enforced through pure-function tests against fixtures

### 3.2 Module ownership

#### `src/domain/normalize.ts`

Owns canonical normalization helpers.

Required changes:
- update `buildCanonicalSectionUrl(titleNumber, sectionNumber)` to append `&num=0&edition=prelim`
- leave `embeddedSectionAnchor()` unchanged and authoritative for embedded anchor IDs

Design rule:
- URL normalization and anchor normalization stay separate; section-number URL segments must keep their real section text, while embedded anchor IDs may keep normalized/sluggified form

#### `src/transforms/markdown.ts`

Owns final markdown emission.

Required changes:
- separate embedded anchor emission from section-heading rendering
- keep standalone heading rendering free of embedded anchor lines
- ensure structured subsection blocks are paragraph-separated
- continue rewriting chapter-mode local links, but canonical fallback targets must use the updated OLRC URL contract
- render note content in a way that preserves paragraph and table boundaries already carried by the parser
- ensure frontmatter `source` values in chapter/uncategorized output use the corrected canonical URL contract

Recommended helper boundaries:

```ts
function renderSectionHeading(section: SectionIR, level: number): string;
function renderSectionAnchor(anchor?: string): string[];
function renderContentNodes(...): string[];
function shouldSeparateWithBlankLine(existingLines: string[], nextLines: string[]): boolean;
function renderStatutoryNote(note: StatutoryNoteIR, headingLevel: number): string[];
function renderNote(note: NoteIR): string | string[];
function renderMarkdownTable(rows: string[][]): string[];
```

Design rule:
- heading generation returns only the heading line
- anchor generation is its own step
- note/table rendering must never accept arbitrary raw HTML passthrough

#### `src/transforms/uslm-to-ir.ts`

Owns XML parsing and IR extraction.

Required changes:
- update `titleIr.sourceUrlTemplate` and default section source URLs to the corrected canonical OLRC URL shape
- preserve note paragraph structure instead of flattening all note prose through generic whitespace normalization
- preserve note table structure in source order
- ensure note parsing keeps embedded Act content attached to notes instead of enabling top-level section leakage
- tighten section-discovery logic so only actual title/body sections populate `titleIr.sections`

Architectural rules:
- do not treat all descendant `<section>` nodes as codified sections
- note-scoped content must be parsed according to note context, not section-body context
- preserve document order when extracting mixed prose/table content

#### `tests/unit/transforms/markdown.test.ts`

Owns renderer regressions.

Required additions:
- embedded markdown contains `<a id="section-..."></a>`
- embedded markdown does not contain `{#section-...}`
- standalone markdown still lacks embedded anchors
- sibling structured subsections are separated by blank lines
- rewritten canonical links include `num=0` and `edition=prelim`
- rendered notes preserve `\n\n` paragraph boundaries
- rendered note tables preserve structural separators rather than flattened text

#### `tests/unit/transforms/uslm-to-ir.test.ts`

Owns parser regressions.

Required additions:
- `TitleIR.sourceUrlTemplate` uses the corrected canonical OLRC contract
- multi-`<p>` note extraction preserves paragraph boundaries in source order
- embedded Act fixtures do not create extra top-level `SectionIR` entries
- embedded Act text remains attached to the parent note
- note table extraction preserves row/column ordering

### 3.3 Dependency direction

```text
src/index.ts
  -> src/transforms/uslm-to-ir.ts
       -> src/domain/normalize.ts
       -> src/domain/model.ts
  -> src/transforms/write-output.ts
       -> src/transforms/markdown.ts
            -> src/domain/normalize.ts
            -> src/domain/model.ts
```

Rules:
- `normalize.ts` stays pure and dependency-light
- `uslm-to-ir.ts` owns XML interpretation into IR
- `markdown.ts` owns final markdown formatting only
- no module in this change may introduce filesystem/network/process access beyond existing CLI entrypoints and tests

### 3.4 Communication pattern

Direct in-process function calls only.

No:
- queue
- event bus
- worker pool
- RPC
- background task

---

## 4. Infrastructure requirements

### 4.1 Runtime requirements

For this repo, production is a local or CI Node.js process running the CLI.

Required runtime:
- Node.js 22+
- TypeScript 5.8+
- existing npm dependency set
- local filesystem for reading XML inputs and writing markdown outputs

No additional infrastructure is required.

### 4.2 Storage and services

- **Primary storage:** local filesystem output tree
- **No database**
- **No Redis**
- **No object storage**
- **No queue**
- **No CDN**
- **No external OLRC API calls at runtime**; canonical URLs are emitted as text only

### 4.3 Development and test requirements

Required commands remain:

```bash
npm install
npm run build
npm test
```

Minimum verification for this issue:

```bash
npm run build
npx vitest run tests/unit/transforms/markdown.test.ts tests/unit/transforms/uslm-to-ir.test.ts
```

Fixture requirements:
- use existing XML fixtures under `tests/fixtures/xml/`
- add fixture coverage only where necessary to capture embedded Acts and note tables
- avoid synthetic fixtures that do not resemble actual USLM note structures when a representative real fixture already exists

### 4.4 CI requirements

Existing CI remains sufficient:
- install dependencies
- run TypeScript build
- run Vitest

No new secrets, containers, databases, or services are required.

### 4.5 Rollback plan

Rollback is a normal git revert of:
- parser changes in `src/transforms/uslm-to-ir.ts`
- normalization changes in `src/domain/normalize.ts`
- renderer changes in `src/transforms/markdown.ts`
- associated tests/snapshots

No migration or data cleanup is required.

---

## 5. Dependency decisions

No new dependencies should be added unless an implementation dead-end proves existing tools insufficient. Current architecture supports the required work.

| Dependency | Version in repo | Role in this issue | Why keep it | License | Maintenance status |
|---|---:|---|---|---|---|
| `typescript` | `^5.8.0` | typed parser/renderer changes | existing project standard; sufficient for pure transform refactors | Apache-2.0 | actively maintained |
| `vitest` | `^3.0.0` | regression coverage | already used for unit/snapshot verification | MIT | actively maintained |
| `fast-xml-parser` | `^4.5.0` | XML parsing, including `preserveOrder` mode already in use | existing parser already supports the ordered extraction needed for paragraph/table preservation | MIT | actively maintained |
| `gray-matter` | `^4.0.3` | frontmatter serialization | existing markdown pipeline dependency | MIT | mature/stable |
| `yauzl` | `^3.1.0` | unrelated ZIP input support | unaffected by this issue | MIT | mature/stable |
| `@types/node` | `^22.0.0` | Node typings | existing dev dependency | MIT | maintained |

### 5.1 Explicit non-decisions

- **No markdown AST framework** (`remark`, `mdast`, etc.)
  - current output needs are deterministic and bounded
  - plain string/line emission remains simpler and less risky for this repo

- **No alternate XML parser**
  - `fast-xml-parser` already supports ordered traversal needed for mixed prose/table note content

- **No raw HTML passthrough for notes/tables**
  - the only allowed raw HTML for this issue is the constrained anchor tag above embedded section headings

- **No IR-wide persistence or schema layer**
  - this is still a transform-only CLI concern

---

## 6. Integration points

### 6.1 Existing integration points reused

#### XML -> IR
`src/transforms/uslm-to-ir.ts`

Responsibilities for this issue:
- parse ordered XML content faithfully enough to distinguish paragraphs, prose/table boundaries, and note-contained embedded Act text
- limit top-level section discovery to real title/body sections

#### IR -> markdown
`src/transforms/markdown.ts`

Responsibilities for this issue:
- emit GitHub-safe embedded anchors
- preserve subsection paragraph boundaries
- serialize note prose/tables in the exact preserved order
- emit corrected canonical links and frontmatter source URLs

#### Canonical normalization
`src/domain/normalize.ts`

Responsibilities for this issue:
- centralize OLRC URL shape
- keep anchor ID normalization authoritative and unchanged

### 6.2 Data flow

```text
USLM XML
  -> fast-xml-parser (standard + preserveOrder)
  -> parseUslmToIr()
       -> collect real title/body sections
       -> parse section content
       -> parse note content with preserved paragraph/table boundaries
       -> build TitleIR / SectionIR
  -> renderSectionMarkdown() / renderChapterMarkdown() / renderUncategorizedMarkdown()
       -> emit corrected frontmatter source URLs
       -> emit optional embedded anchor line
       -> render headings/content/notes/tables deterministically
  -> final markdown files
```

### 6.3 Section-discovery containment rule

The key parser boundary for this issue is:

- `collectSectionNodes*()` may only contribute **codified title/body sections** to `titleIr.sections`
- nested note content that happens to contain `<section>`-like constructs or embedded Act headings must not cross that boundary

Acceptable implementation approaches:
1. restrict recursion so note/note-like containers are excluded from section discovery, or
2. allow traversal but filter discovered sections by ancestry/context so note-descended sections are discarded

Preferred approach: **ancestor-aware exclusion during section discovery**, because it prevents incorrect IR creation rather than trying to repair it afterward.

### 6.4 Note serialization order rule

For both statutory and editorial notes, extraction/rendering must preserve source order of mixed content:

```text
paragraph
paragraph
markdown table
paragraph
```

must remain exactly:

```md
Paragraph one.

Paragraph two.

| ...table... |
| --- | --- |
| ... |

Paragraph three.
```

No reordering by type is allowed.

---

## 7. Security considerations

### 7.1 Raw HTML allowlist

This issue formalizes raw HTML usage in markdown. The allowed HTML must be narrowly constrained to:

```html
<a id="section-..."></a>
```

Controls:
- only the `a` tag is allowed for this issue
- only the `id` attribute is emitted
- the `id` value comes only from `embeddedSectionAnchor()`
- no arbitrary HTML from XML note content may be passed through
- note tables must render as markdown tables, not raw HTML tables

### 7.2 Input validation and normalization

Risks:
- malformed section numbers could produce invalid anchors or broken links if normalization is bypassed
- generic whitespace normalization can erase legally meaningful structure inside notes
- over-broad section discovery can turn note text into false codified sections

Controls:
- use `embeddedSectionAnchor()` as the sole source of embedded anchor IDs
- use `buildCanonicalSectionUrl()` as the sole source of fallback OLRC link construction
- preserve note structure using ordered parsing rather than flattening everything through `normalizeWhitespace()`
- explicitly distinguish note context from title-body section context during parsing

### 7.3 Determinism and testability

Deterministic output is a safety property for this repository because regression control depends on exact text assertions.

Required controls:
- exact anchor placement before embedded headings
- exact canonical URL shape including `num=0` and `edition=prelim`
- exact `\n\n` paragraph separators between note paragraphs and subsection siblings
- stable note table row/column ordering
- stable top-level section counts for fixtures containing embedded Acts

### 7.4 Sensitive data, auth, encryption, CORS, rate limiting

Not applicable. This change introduces no secrets, PII handling, network API, browser execution environment, or remote write path.

---

## 8. Concrete implementation plan

### 8.1 `src/domain/normalize.ts`

1. Update `buildCanonicalSectionUrl()` to append `&num=0&edition=prelim`.
2. Keep `embeddedSectionAnchor()` unchanged.
3. Ensure any default source URL builders reuse the same canonical helper or identical contract.

### 8.2 `src/transforms/uslm-to-ir.ts`

1. Update `titleIr.sourceUrlTemplate` and `defaultSectionSource()` to use the corrected canonical OLRC URL shape.
2. Change note extraction away from flat whitespace-joined text for multi-`<p>` notes.
3. Preserve note content in source order when prose and tables are interleaved.
4. Detect/serialize note tables into a markdown-safe structural representation.
5. Restrict section discovery so note-contained embedded Acts do not create additional top-level `SectionIR` records.
6. Keep legitimate codified section discovery unchanged.

### 8.3 `src/transforms/markdown.ts`

1. Separate anchor emission from `renderSectionHeading()`.
2. Emit anchor line only in embedded/chapter/uncategorized rendering paths.
3. Tighten blank-line separator logic so structured subsection siblings are distinct paragraphs.
4. Render notes using preserved paragraph/table structure without flattening.
5. Keep note table output in plain markdown tables.
6. Ensure chapter-mode fallback links and frontmatter sources use the corrected canonical URLs.

### 8.4 Tests

1. Extend `tests/unit/transforms/markdown.test.ts` for anchors, subsection spacing, canonical URLs, note paragraphing, and table rendering.
2. Extend `tests/unit/transforms/uslm-to-ir.test.ts` for canonical source templates, note paragraph preservation, embedded Act containment, and note table structure.
3. Update snapshots only where outputs changed for these six regressions.
4. Reject unrelated snapshot churn.

---

## 9. Acceptance mapping

| Spec requirement | Architectural decision |
|---|---|
| Embedded headings must stop showing `{#...}` | emit standalone `<a id="section-..."></a>` lines before embedded headings |
| Standalone section headings must remain plain markdown | keep anchor emission outside standalone rendering path |
| Structured subsections must become distinct paragraphs | classify subsection blocks as paragraph-separated content in renderer compaction logic |
| Canonical OLRC URLs must include `num=0` and `edition=prelim` | centralize corrected URL shape in normalization and reuse it for fallback links and frontmatter/source fields |
| Multi-paragraph notes must preserve boundaries | parse note paragraphs in order and serialize them with `\n\n` separators |
| Embedded Acts must stay inside notes | restrict top-level section discovery to codified title/body sections only |
| Historical and Revision Notes tables must preserve structure | model note tables as ordered row/cell data and render with plain markdown tables |
| No arbitrary raw HTML may be introduced | allow only `<a id="section-..."></a>` generated from normalized section anchors |
| Tests must cover all six regressions | add parser and renderer regression tests against representative fixtures |

---

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Anchor markup leaks into standalone section output | High | keep anchor generation as a separate embedded-only step |
| Canonical URLs are corrected in one path but not others | High | centralize URL construction and assert full URL shape in both parser and renderer tests |
| Generic whitespace normalization still flattens note paragraphs | High | preserve note content in ordered block form until final markdown serialization |
| Embedded Act sections are still discovered recursively from note descendants | High | make section discovery ancestor-aware and exclude note-scoped descendants |
| Table extraction preserves text but loses cell boundaries | High | parse note tables into row/cell arrays and render explicit markdown table rows |
| Subsection separator logic inserts extra blank lines | Medium | keep centralized blank-line compaction and assert exact output |
| Legitimate codified sections are accidentally filtered out with note containment fix | High | verify section counts against fixtures containing real title-body sections plus embedded note Acts |
| Raw HTML surface expands beyond anchors | Medium | explicitly prohibit raw HTML passthrough in note/table rendering |

---

## 11. Decision summary

1. **Broaden the architecture from renderer-only to parser-plus-renderer.** The approved spec explicitly includes note extraction, canonical source URLs, embedded Act containment, and table structure preservation.
2. **Keep the system monolithic and pure.** These are deterministic transform fixes, not distributed-systems concerns.
3. **Emit embedded anchors as standalone constrained HTML lines.** This is the smallest GitHub-safe fix.
4. **Centralize the canonical OLRC URL contract.** Every emitted source/fallback URL must use the same working `edition=prelim&num=0` shape.
5. **Preserve note structure until final markdown emission.** Paragraphs and tables are semantic structure, not whitespace trivia.
6. **Constrain top-level section discovery to actual title/body sections.** Embedded Acts belong to notes unless the XML context proves they are codified sections.
7. **Enforce all six regressions through fixture-backed unit tests.** Exact, mechanically testable output is the right guardrail for this CLI.
