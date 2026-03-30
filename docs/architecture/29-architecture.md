# Architecture — Issue #29: Markdown heading hierarchy too shallow in chapter files

## Scope and intent

Fix six linked correctness defects in the chapter-mode markdown transform without changing the repository’s core architecture:

1. Embedded section headings in chapter files must render at `##` instead of `#`, with note headings bumped down accordingly.
2. Chapter frontmatter `source` URLs must be concrete canonical title URLs with no unresolved `{section}` placeholder.
3. Chapter-mode cross-references must stop linking to nonexistent `section-*.md` files and instead resolve to chapter-file anchors when locally mappable, or to exact canonical `uscode.house.gov` section URLs when not.
4. Nested labeled body content must render as structured multi-line markdown with deterministic indentation instead of a flattened wall of text.
5. `_title.md` must remove the duplicate per-section list and remain a title/chapter navigation page only.
6. `parseSection()` must reliably preserve `<heading>` content across ordered and non-ordered parse paths, including the Title 51 failure mode.

This remains a **single-package Node.js CLI** with no database, HTTP API, queue, cache service, or background worker. The work stays entirely within the existing `USLM XML -> IR -> markdown -> filesystem` transform pipeline.

`.dark-factory.yml` is not present in this repo snapshot, so stack constraints come from the live codebase and `package.json`: Node.js, TypeScript, `fast-xml-parser`, `gray-matter`, and Vitest.

---

## 1. Data model

### 1.1 Persistent storage model

No database or external storage layer is required.

This issue only changes:
- in-memory parser output (`TitleIR`, `SectionIR`, `ContentNode`)
- markdown rendering decisions in `src/transforms/markdown.ts`
- pure normalization helpers in `src/domain/normalize.ts`
- test fixtures/regression coverage
- filesystem output contents under existing transform output directories

Accordingly:
- **No SQL migrations**
- **No seed data**
- **No indexes**
- **No runtime persistence changes**

### 1.2 Runtime IR contracts

The existing IR stays authoritative. This issue tightens the behavioral contract of several fields and helper derivations.

#### `TitleIR`

The architecture requires these fields to remain sufficient for chapter rendering:

```ts
interface TitleIR {
  titleNumber: number;
  heading: string;
  positiveLaw?: boolean;
  chapters: Array<{ number: string; heading: string }>;
  sections: SectionIR[];
  sourceUrlTemplate: string;
}
```

Behavioral contract for this issue:
- `titleNumber` is the canonical decimal title identifier used in chapter frontmatter `source`
- `chapters[]` remains the authoritative chapter metadata source for chapter filename mapping and chapter heading selection
- `sourceUrlTemplate` must be concretized at parse/build time for title-level rendering as:
  `https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title{titleNumber}`

#### `SectionIR`

```ts
interface SectionIR {
  titleNumber?: number;
  sectionNumber: string;
  heading: string;
  source?: string;
  hierarchy?: {
    subtitle?: string;
    part?: string;
    subpart?: string;
    chapter?: string;
    subchapter?: string;
  };
  content: ContentNode[];
  statutoryNotes?: StatutoryNoteIR[];
  editorialNotes?: NoteIR[];
}
```

Behavioral contract for this issue:
- `heading` must contain `<heading>` text whenever the source section has a heading element; otherwise it must be the empty string
- `source` must remain the concrete section URL:
  `https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title{titleNumber}-section{sectionNumber}`
- `hierarchy.chapter` remains the ownership boundary for chapter-mode file grouping
- `content` must preserve ordered chapeau / inline body / nested descendants / continuation sequencing so markdown formatting can render hierarchy without inventing structure

#### `ContentNode`

No schema expansion is required, but rendering semantics become stricter.

```ts
interface ContentNode {
  type?: string;
  kind?: string;
  label?: string;
  heading?: string;
  text?: string;
  children?: ContentNode[];
}
```

Required renderable labeled node kinds:
- `subsection`
- `paragraph`
- `subparagraph`
- `clause`
- `subclause`
- `item`
- `subitem`

Behavioral contract:
- every labeled node renders on its own logical line
- parent labeled lines render before child labeled lines
- indentation is deterministic and depth-based
- heading and inline text remain on the same logical line, in source order

### 1.3 New pure derivation model

This issue should centralize three derivations as pure helpers instead of scattering them across renderer branches.

#### A. Embedded section anchor derivation

Add or formalize a pure helper in `src/domain/normalize.ts`:

```ts
export function embeddedSectionAnchor(sectionNumber: string): string;
```

Contract:
- deterministic for all supported section identifiers
- anchor prefix is always `section-`
- normalization must support numeric and alphanumeric identifiers including:
  - `411`
  - `125d`
  - `301-1`
  - `125/d`

Normative examples:

```ts
embeddedSectionAnchor('411')   === 'section-411'
embeddedSectionAnchor('125d')  === 'section-125d'
embeddedSectionAnchor('301-1') === 'section-301-1'
embeddedSectionAnchor('125/d') === 'section-125-d'
```

The implementation may normalize other punctuation consistently, but tests must lock exact output for the above shapes.

#### B. Chapter target mapping for cross-references

Introduce a renderer input contract that maps a referenced section number to its final chapter output target.

```ts
interface ChapterSectionTarget {
  sectionNumber: string;
  chapterNumber: string;
  chapterFilename: string;
  anchor: string; // `section-...`
}
```

Recommended pure container:

```ts
type SectionTargetMap = ReadonlyMap<string, ChapterSectionTarget>;
```

Rules:
- built once per rendered title before markdown emission
- keyed by canonical referenced section number, not by preformatted filename
- used by chapter-mode link rewriting only
- if lookup misses, renderer must fall back to the canonical section URL, never to a local `section-*.md` path

#### C. Heading-level selection

Promote heading levels to explicit rendering constants or pure helpers.

```ts
const SECTION_HEADING_LEVEL_SECTION_MODE = 1;
const SECTION_HEADING_LEVEL_CHAPTER_MODE = 2;
const STATUTORY_NOTES_LEVEL_SECTION_MODE = 2;
const STATUTORY_NOTES_LEVEL_CHAPTER_MODE = 3;
const STATUTORY_NOTE_ITEM_LEVEL_SECTION_MODE = 3;
const STATUTORY_NOTE_ITEM_LEVEL_CHAPTER_MODE = 4;
const EDITORIAL_NOTES_LEVEL_SECTION_MODE = 2;
const EDITORIAL_NOTES_LEVEL_CHAPTER_MODE = 3;
```

This avoids hard-coded `#` strings scattered across the renderer.

### 1.4 Invariants

The following invariants must be enforced through code and tests:

- standalone section markdown heading remains `# § {sectionNumber}. {heading}` or `# § {sectionNumber}.`
- embedded chapter-mode section heading is always `## § {sectionNumber}. {heading}` or `## § {sectionNumber}.`
- chapter-mode output contains **no local links to `section-*.md`**
- unmapped cross-references always fall back exactly to:
  `https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title{referencedTitleNumber}-section{referencedSectionNumber}`
- chapter frontmatter `source` never contains `{section}`
- `_title.md` never contains `## Sections`
- ordered and non-ordered parsing produce identical `SectionIR.heading` values for equivalent inputs

---

## 2. API contract

This repository exposes no HTTP API. The external contract is the CLI and the generated markdown files.

### 2.1 CLI surface

No CLI grammar change is required for this issue.

Existing contract remains:

```bash
us-code-tools transform --title <number> --output <dir> [--group-by chapter]
```

The affected observable outputs are:
- chapter markdown file bodies and frontmatter
- title index markdown bodies
- standalone section markdown bodies

### 2.2 Generated markdown contract

#### Standalone section markdown

For `renderSectionMarkdown(section)`:

```md
# § 411. Definitions
```

If `heading === ''`:

```md
# § 411.
```

Notes contract:
- wrapper heading: `## Statutory Notes`
- note item heading: `### {note.heading}`
- editorial notes wrapper: `## Notes`

#### Chapter markdown frontmatter

Required frontmatter shape:

```yaml
---
title: 42
chapter: 6
heading: Public Health Service
section_count: 17
source: https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title42
---
```

Rules:
- `source` must be a fully concrete title URL
- no template placeholders
- no chapter suffix
- no section suffix

#### Embedded section markdown inside chapter files

Required heading contract:

```md
## § 411. Definitions
```

If heading absent:

```md
## § 411.
```

Required note-level contract in chapter mode:
- statutory notes wrapper: `### Statutory Notes`
- statutory note item heading: `#### {note.heading}`
- editorial notes wrapper: `### Notes`

#### Chapter-mode cross-reference contract

Mapped local target example:

```md
[section 411 of title 3](./chapter-004-officers-and-employees.md#section-411)
```

Cross-title mapped target example:

```md
[section 411 of title 3](../title-03-the-president/chapter-004-officers-and-employees.md#section-411)
```

Unmapped fallback example:

```md
[section 411 of title 3](https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title3-section411)
```

Rules:
- relative links must be computed using `titleDirectoryName()` for title folders
- mapped links must target a chapter file plus `#section-...` anchor
- fallback links must use the exact canonical URL format above
- no generated href may target an arbitrary domain

### 2.3 Rate limits, pagination, auth

Not applicable. No network API or service is introduced.

---

## 3. Service boundaries

### 3.1 Architectural style

Keep the implementation in the current monolithic CLI. No service split is justified because:
- transform is a local batch operation
- all affected logic is pure parsing/rendering/path derivation
- there is no latency, scaling, or independent deployment reason to extract services

### 3.2 Module ownership

#### `src/transforms/uslm-to-ir.ts`

Owns:
- XML parsing via `fast-xml-parser`
- ordered and non-ordered section extraction
- construction of `TitleIR`, `SectionIR`, and `ContentNode`
- canonical source URL assignment to title/section IR

Required changes:
- unify heading extraction so ordered and non-ordered paths read `<heading>` through the same helper
- ensure section heading extraction does not accidentally drop headings when section bodies contain nested nodes or mixed ordered content
- ensure title-level `sourceUrlTemplate` is concretized as title URL, not section placeholder template

Recommended helper split:

```ts
function readSectionHeading(sectionNode: unknown): string;
function readTitleSourceUrl(titleNumber: number): string;
function readSectionSourceUrl(titleNumber: number, sectionNumber: string): string;
```

Rules:
- `readSectionHeading()` must only consult the actual `<heading>` element
- it must not substitute descendant text from paragraphs/content
- ordered and non-ordered parsers must both call it

#### `src/transforms/markdown.ts`

Owns:
- standalone section rendering
- chapter-mode embedded rendering
- title index rendering
- final markdown string assembly
- chapter-mode link rewriting based on resolved target map

Required changes:
- stop generating embedded section headings indirectly by stripping frontmatter from standalone section markdown
- instead, render embedded sections with explicit chapter-mode heading levels
- implement deterministic anchor insertion for each embedded section
- rewrite cross-references to chapter-file-plus-anchor targets or exact canonical fallback URLs
- render labeled nodes with depth-based line formatting
- remove the `## Sections` block from `renderTitleMarkdown()`

Recommended internal helper structure:

```ts
function renderSectionHeading(section: SectionIR, level: number): string;
function renderStatutoryNotes(notes: StatutoryNoteIR[], options: { baseHeadingLevel: number }): string[];
function renderEditorialNotes(notes: NoteIR[], options: { baseHeadingLevel: number }): string[];
function renderEmbeddedSection(section: SectionIR, context: EmbeddedRenderContext): string;
function renderContentNodeLines(node: ContentNode, depth: number, tracker: DuplicateTextTracker): string[];
function buildCrossReference(...): string;
```

`renderContentNodeLines()` is preferable to returning one newline-joined string because it makes blank-line and indentation rules easier to test exactly.

#### `src/domain/normalize.ts`

Owns:
- section and title path normalization
- section file safe IDs
- title directory derivation
- new embedded anchor normalization for chapter-mode section anchors

Required changes:
- add one canonical helper for embedded section anchor generation
- ensure chapter-mode cross-title links continue to derive directory names through `titleDirectoryName()`
- do not duplicate normalization logic in the markdown renderer

#### `src/transforms/write-output.ts`

Owns:
- chapter bucketing
- final file path materialization
- pre-write collision protection
- renderer orchestration inputs

Required changes:
- build a per-title `SectionTargetMap` before chapter writes begin
- pass that map into chapter-mode rendering so links resolve against final filenames and anchors
- keep existing file-collision and write-failure behavior unchanged

### 3.3 Dependency direction

```text
src/index.ts
  -> src/sources/olrc.ts
  -> src/transforms/uslm-to-ir.ts
  -> src/transforms/write-output.ts
       -> src/transforms/markdown.ts
       -> src/domain/model.ts
       -> src/domain/normalize.ts
```

Rules:
- `normalize.ts` remains pure
- `markdown.ts` may consume normalized helpers but must not derive filesystem layout ad hoc
- `write-output.ts` owns mapping from sections to actual chapter output files
- parser does not depend on renderer

### 3.4 Communication pattern

Direct in-process function calls only.

No:
- queue
- event bus
- RPC
- worker pool
- external scheduler

---

## 4. Infrastructure requirements

### 4.1 Production/runtime

For this repo, “production” means a local or CI Node.js process running the CLI.

Required runtime:
- Node.js 22+
- writable local filesystem
- current npm dependency set

No additional infrastructure is needed.

### 4.2 Storage

- **Primary storage:** filesystem output tree
- **Input storage:** cached OLRC ZIP/XML artifacts already used by transform flow
- **No database**
- **No object storage**
- **No Redis**
- **No CDN**

### 4.3 Local development

Required local commands remain:

```bash
npm install
npm run build
npm test
```

Recommended verification additions for this issue:

```bash
npm run build
npm test -- tests/...chapter... tests/...markdown... tests/...uslm-to-ir...
```

### 4.4 CI

No new CI service is needed.

Existing CI responsibilities are sufficient:
- install dependencies
- run TypeScript build
- run Vitest

### 4.5 Logging and observability

No new operational telemetry is needed.

Correctness is enforced through:
- deterministic markdown snapshots / assertions
- parser regression fixtures
- existing transform error pathways

### 4.6 Rollback plan

Rollback is a normal git revert of:
- parser heading extraction changes
- markdown renderer changes
- normalize helper additions
- tests and fixtures

No data migration or cleanup is required.

---

## 5. Dependency decisions

No new package dependencies should be added.

| Dependency | Version in repo | Role in this issue | Why keep it | License | Maintenance status |
|---|---:|---|---|---|---|
| `typescript` | `^5.8.0` | typed parser/renderer refactor | existing repo standard; enough for pure helper extraction | Apache-2.0 | actively maintained |
| `vitest` | `^3.0.0` | regression and fixture coverage | already used; strong fit for pure helper and transform tests | MIT | actively maintained |
| `fast-xml-parser` | `^4.5.0` | `<heading>` extraction from USLM | existing parser layer already handles both ordered and non-ordered flows | MIT | actively maintained |
| `gray-matter` | `^4.0.3` | frontmatter serialization/parsing | already used for markdown generation; no need to replace | MIT | mature/stable |
| `yauzl` | `^3.1.0` | unchanged ZIP access in transform inputs | unrelated but already part of source acquisition path | MIT | mature/stable |
| `@types/node` | `^22.0.0` | path and filesystem typings | existing repo dependency | MIT | maintained |

### 5.1 Explicit non-decisions

- **No markdown AST library** (`remark`, `mdast`, etc.)
  - the renderer is still simple enough to remain string-based
  - this issue needs deterministic heading/link formatting, not general markdown rewriting

- **No slug/anchor dependency**
  - embedded section anchor rules are narrow and should remain locally controlled in `normalize.ts`

- **No parser replacement**
  - the bug is in heading extraction consistency, not in `fast-xml-parser` viability

---

## 6. Integration points

### 6.1 Existing integration points reused

#### OLRC XML -> IR
`src/sources/olrc.ts` -> `src/transforms/uslm-to-ir.ts`

Unchanged boundary. This issue only tightens IR correctness:
- title source URL derivation
- section source URL derivation
- section heading extraction

#### IR -> markdown
`src/transforms/uslm-to-ir.ts` -> `src/transforms/markdown.ts`

Changed contract:
- chapter-mode rendering can no longer rely on “render standalone section then strip frontmatter” as its only embedding mechanism because heading levels and embedded anchors must differ from standalone mode
- shared body rendering must remain canonical, but heading level selection must become context-aware

#### Markdown -> filesystem
`src/transforms/markdown.ts` -> `src/transforms/write-output.ts`

Changed contract:
- writer must pass resolved chapter filename/anchor targets to renderer for chapter-mode link rewriting
- renderer must emit links matching actual written chapter files

#### Cross-title normalization
`src/transforms/markdown.ts` -> `src/domain/normalize.ts`

Unchanged principle, stronger requirement:
- all title directory traversal must continue to use `titleDirectoryName()`
- no hardcoded `title-03-*` strings in renderer logic

### 6.2 Data flow for chapter mode

```text
cached OLRC XML
  -> parseUslmToIr()
       -> TitleIR + SectionIR[] with concrete title/section source URLs
       -> SectionIR.heading preserved from <heading>
  -> writeTitleOutput(groupBy='chapter')
       -> bucket sections by hierarchy.chapter
       -> derive chapter filenames
       -> build SectionTargetMap(sectionNumber -> chapterFilename + anchor)
       -> renderChapterMarkdown(titleIr, chapter, sections, sectionTargetMap)
            -> renderEmbeddedSection(...)
            -> render content lines with depth indentation
            -> rewrite xrefs to mapped chapter targets or canonical fallback URLs
       -> write chapter markdown files
       -> renderTitleMarkdown(titleIr) without section list
```

### 6.3 Cross-reference resolution contract

The renderer must distinguish three cases.

#### Case A: same-title mapped reference

Input: inline USC reference to a section known in the current title’s chapter map.

Output:
- relative chapter path within the same title directory
- anchor derived from referenced section number

#### Case B: cross-title mapped reference

Input: inline USC reference to a section in another title whose chapter membership can be resolved from available IR/context.

Output:
- relative path using `../${titleDirectoryName(...)}...`
- final chapter filename for that referenced title/chapter
- anchor derived from referenced section number

#### Case C: unmapped reference

Input: section reference cannot be mapped to a generated local chapter file.

Output:
- exact canonical URL:
  `https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title{referencedTitleNumber}-section{referencedSectionNumber}`

This fallback is mandatory, not best-effort.

#### Slash-bearing parse-output markdown references

Chapter-mode link rewriting must also handle real parse-output markdown links where:
- the visible text is only `section {identifier}` (for example, `section 125/d`), and
- the href is already filename-safe (for example, `../title-05-government-organization-and-employees/section-00125d.md`).

Required behavior:
- recover the canonical referenced pair from the combined markdown link text and href context
- look up the mapping by canonical ref key (`5:125/d`, not `5:125d` or `5:125-d`)
- when mapped, emit the final local target `./chapter-004-officers-and-employees.md#section-125-d`
- when unmapped, emit the exact canonical fallback URL `https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section125/d`

This rule exists to ensure slash-bearing identifiers round-trip correctly even when the parse-output href has already been normalized for filename safety.

### 6.4 Parser parity contract

Heading extraction must not depend on whether the parser path is preserve-order or object-tree.

Required design:
- create one shared heading extraction helper
- ordered path uses it
- non-ordered path uses it
- tests assert equal result for equivalent XML fixtures

### 6.5 Test fixture integration

This issue requires additive fixtures and/or targeted regression tests for:
- chapter-mode heading hierarchy
- chapter frontmatter `source`
- mapped and unmapped chapter-mode cross-references
- nested labeled subsection formatting with exact indentation
- `_title.md` without section list
- Title 51-style adjacent sections retaining headings

The architecture favors a small number of purpose-built XML fixtures over broad golden-file rewrites.

---

## 7. Security considerations

### 7.1 Link-output allowlist

The spec requires generated links to be only:
- relative markdown links to repository output files, or
- `https://uscode.house.gov/...` URLs

Controls:
- `buildCrossReference()` or equivalent helper must only emit:
  - relative paths derived from canonical filename maps, or
  - exact canonical `https://uscode.house.gov/view.xhtml?...` fallbacks
- no user-controlled arbitrary schemes or domains
- do not emit raw HTML anchors or scriptable markup

### 7.2 Path and anchor safety

Risks:
- section identifiers may contain punctuation, slashes, or mixed characters
- ad hoc anchor/path generation can drift from writer outputs or create malformed links

Controls:
- anchor normalization lives in one pure helper
- title directory traversal continues through `titleDirectoryName()`
- chapter filenames come only from canonical writer mapping
- fallback path on unresolved mapping is external canonical URL, not guessed relative filesystem output

### 7.3 Parser input safety

The repository already ingests upstream XML. This issue must not widen the attack surface.

Controls:
- heading extraction reads text content only
- renderer continues to output markdown text, not executable HTML/JS
- missing headings must resolve to `''`, not descendant body text from unrelated nodes

### 7.4 Determinism as a safety property

Deterministic rendering matters because it makes broken-link regressions auditable.

Required controls:
- deterministic anchor derivation
- deterministic chapter target mapping
- deterministic indentation increment per nested depth
- deterministic same input -> same markdown output

### 7.5 Sensitive data

No PII, credentials, or secrets are introduced.

### 7.6 Auth, encryption, CORS, rate limiting

Not applicable. No service or web API is introduced.

---

## 8. Concrete implementation plan

### 8.1 `src/domain/normalize.ts`

1. Add `embeddedSectionAnchor(sectionNumber)`.
2. Reuse existing section/title normalization helpers; do not duplicate title-directory logic.
3. Add unit tests locking exact anchor outputs for `411`, `125d`, `301-1`, and `125/d`.

### 8.2 `src/transforms/uslm-to-ir.ts`

1. Add one shared `<heading>` extraction helper.
2. Route both ordered and non-ordered parsing paths through it.
3. Set title-level `sourceUrlTemplate` to the exact title canonical URL.
4. Keep section-level `source` URL generation exact and unchanged in format.
5. Add regression coverage for adjacent Title 51-style sections that each contain headings.

### 8.3 `src/transforms/markdown.ts`

1. Split standalone-section rendering from embedded-section rendering at the heading level.
2. Preserve shared body rendering logic, but parameterize heading levels by mode.
3. Insert deterministic embedded section anchors.
4. Replace local `section-*.md` rewrite behavior with chapter target resolution.
5. Implement exact canonical fallback URLs for unmapped references.
6. Replace single-string recursive body rendering with line-based rendering for labeled nodes.
7. Remove `## Sections` from `renderTitleMarkdown()`.

### 8.4 `src/transforms/write-output.ts`

1. Build chapter filename and section target maps before rendering any chapter file.
2. Pass `SectionTargetMap` into `renderChapterMarkdown()`.
3. Preserve existing chapter filename collision handling.

### 8.5 Tests

#### Unit tests
- anchor normalization
- heading-level selection helpers
- canonical fallback URL generation
- title markdown omits `## Sections`

#### Integration tests
- chapter markdown emits `## § ...`
- statutory/editorial notes use bumped heading levels in chapter mode
- chapter frontmatter `source` equals exact canonical title URL
- mapped refs resolve to chapter file + anchor
- unmapped refs resolve to exact canonical section URL
- nested subsection formatting uses exact indentation rule
- ordered/non-ordered heading extraction parity

---

## 9. Acceptance mapping

| Spec requirement | Architectural decision |
|---|---|
| Embedded section headings must be `##` in chapter mode | separate embedded-section renderer or heading-level helper instead of frontmatter stripping only |
| Chapter `source` must be concrete title URL | parser/title IR builds exact canonical title URL from `titleNumber` |
| Cross-references cannot point to `section-*.md` in chapter mode | writer builds `SectionTargetMap`; renderer resolves to chapter file + anchor or exact canonical fallback |
| Unmapped refs must use exact canonical section URL | one pure fallback URL builder locked by tests |
| Nested labeled nodes must render as structured lines | line-based content renderer with deterministic indentation and parent-before-child order |
| `_title.md` must omit section list | `renderTitleMarkdown()` removes `## Sections` entirely |
| Missing headings must be fixed | one shared `readSectionHeading()` helper used by both parse paths |
| Cross-title directory names must remain canonical | renderer continues using `titleDirectoryName()` |

---

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Embedded rendering still relies on stripped standalone markdown and misses heading-level differences | High | separate heading rendering by mode; keep only body/content logic shared |
| Chapter-mode links drift from actual written filenames | High | build and pass `SectionTargetMap` from writer, not ad hoc renderer guesses |
| Anchor normalization becomes inconsistent across tests and renderer | High | one pure helper in `normalize.ts` with exact example coverage |
| Heading extraction fix addresses only one parser path | High | one shared helper used by ordered and non-ordered paths with parity tests |
| Nested content formatting regresses blank-line order | Medium | line-based renderer with explicit tests for chapeau, nested children, and continuation ordering |
| `_title.md` keeps duplicate section entries through legacy shared logic | Medium | make title index rendering chapter-list-only by design |

---

## 11. Decision summary

1. **Keep the architecture monolithic and additive.** This is a parser/renderer correctness issue, not a systems-design problem.
2. **Promote anchor, fallback URL, and heading-level logic into explicit pure helpers.** That is the cleanest way to make behavior deterministic and testable.
3. **Make writer-owned chapter target mapping the source of truth for chapter-mode links.** The renderer should consume actual target metadata, not reconstruct it from section filenames.
4. **Use one shared heading-extraction helper across ordered and non-ordered parsing.** That directly addresses the intermittent missing-heading bug.
5. **Render nested labeled content as lines, not concatenated blocks.** This is the simplest route to exact indentation and ordering guarantees.
6. **Treat `_title.md` strictly as navigation at the title/chapter level.** Per-section duplication is intentionally removed from the architecture for chapter-mode output.
