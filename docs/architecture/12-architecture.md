# Issue #12 Architecture — Zero-padded section filenames, rich metadata rendering, and recursive hierarchy traversal

## Status
Approved spec input: `docs/specs/12-spec.md`

## Inputs Reviewed
- `docs/specs/12-spec.md`
- GitHub issue #12 and current review context
- `README.md`
- `package.json`
- `src/domain/model.ts`
- `src/domain/normalize.ts`
- `src/transforms/uslm-to-ir.ts`
- `src/transforms/markdown.ts`
- `src/transforms/write-output.ts`
- `tests/unit/transforms/uslm-to-ir.test.ts`
- `tests/unit/transforms/markdown.test.ts`
- `tests/unit/transforms/write-output.test.ts`
- `tests/integration/transform-cli.test.ts`
- `docs/schemas/USLM-1.0.15.xsd`
- Existing architecture documents: `docs/architecture/5-architecture.md`, `docs/architecture/10-architecture.md`

## Constraints and Operating Assumptions
- No repo-root `.dark-factory.yml` is present in this worktree. Effective constraints therefore come from the approved spec, the existing TypeScript CLI codebase, and current repository architecture.
- This issue remains inside the existing single-process Node.js CLI. It does **not** introduce a daemon, queue, database, HTTP server, or background service.
- The production artifact remains the generated markdown tree under the existing output root. The implementation must stay additive to the current transform pipeline.
- Tests must remain fully fixture-backed and deterministic. No live OLRC access, no runtime XSD validation, and no writes outside the existing transform output root are allowed.
- The current XML parser contract remains in force: `fast-xml-parser` with `ignoreAttributes: false`, `attributeNamePrefix: '@_'`, `removeNSPrefix: true`, and namespace-stripped tag access.
- The latest `[spec-writer]` revision is already incorporated in this architecture: hierarchy preservation must be visible in **rendered markdown frontmatter**, not only parser IR.
- No `[security-architect]` or `[arch-reviewer]` issue comment was present at architecture time, so there is no returned-review remediation to fold in yet.

---

## 1. Data Model

### 1.1 Architectural decision
This issue introduces **no database schema and no manifest schema change**.

That is the correct production decision because the defect is a transform-layer correctness problem:
- recursive section discovery is incomplete
- section metadata extraction is incomplete
- filename and index ordering are unstable for mixed-width identifiers

The production data model affected by this issue is therefore the in-memory transform IR plus deterministic markdown/file output rules.

### 1.2 Canonical in-memory model changes
Owner: `src/domain/model.ts`

The existing model must be extended so the parser can preserve hierarchy metadata, singular source-credit data, and statutory notes without overloading the legacy `sourceCredits` / `editorialNotes` fields.

Required contract:

```ts
export interface SectionHierarchyPath {
  subtitle?: string;
  part?: string;
  subpart?: string;
  chapter?: string;
  subchapter?: string;
}

export interface StatutoryNoteIR {
  noteType?: string;   // from <notes type="...">
  topic?: string;      // from <note topic="...">
  text: string;
}

export interface SectionIR {
  titleNumber: number;
  sectionNumber: string;
  heading: string;
  status: SectionStatus;
  source: string;
  enacted?: string;
  publicLaw?: string;
  lastAmended?: string;
  lastAmendedBy?: string;
  sourceCredit?: string;
  hierarchy: SectionHierarchyPath;
  statutoryNotes: StatutoryNoteIR[];
  content: ContentNode[];
}
```

Required invariants:
- `sourceCredit` is singular and maps only to `<sourceCredit>`.
- `hierarchy` contains only encountered structural levels; absent levels are omitted, never serialized as empty strings.
- `statutoryNotes` preserves source order exactly as encountered in XML.
- Existing fields unrelated to this issue remain unchanged to minimize implementation risk.

### 1.3 Recursive hierarchy traversal model
Owner: `src/transforms/uslm-to-ir.ts`

The parser must stop treating section discovery as a hard-coded `title -> chapter -> section` walk.

Instead it must adopt a recursive structural traversal over container nodes under `<title>`.

Canonical container set for hierarchy capture:
- `subtitle`
- `part`
- `subpart`
- `chapter`
- `subchapter`

Canonical traversal contract:

```ts
interface HierarchyContext {
  subtitle?: string;
  part?: string;
  subpart?: string;
  chapter?: string;
  subchapter?: string;
}

function collectSectionsRecursively(node: XmlNode, ctx: HierarchyContext): Array<{
  sectionNode: XmlNode;
  hierarchy: HierarchyContext;
}>;
```

Traversal rules:
1. Start at the `<title>` node.
2. When entering a structural container, copy context and set the corresponding hierarchy key from the container's canonical `<num>` value.
3. When a `<section>` is found at any depth beneath `<title>`, emit it with the accumulated context.
4. Preserve document order during traversal.
5. Do not infer hierarchy keys from headings; use normalized `<num>` values.
6. Unknown intermediary tags may be traversed only if needed to reach nested known containers or sections, but only the canonical container set above contributes frontmatter keys.

### 1.4 Section metadata extraction model
Owner: `src/transforms/uslm-to-ir.ts`

The section parser must separate three concerns that are currently conflated:
1. main section content
2. source-credit provenance
3. statutory notes

Required extraction rules:
- `<sourceCredit>` -> `SectionIR.sourceCredit`
- `<notes type="..."> <note topic="...">...</note> </notes>` -> ordered `SectionIR.statutoryNotes[]`
- existing inline content parsing continues for `<content>`, `<subsection>`, `<paragraph>`, etc.

Canonical note structure:

```ts
interface ParsedNotesResult {
  sourceCredit?: string;
  statutoryNotes: StatutoryNoteIR[];
}
```

Normalization rules:
- empty or whitespace-only `<sourceCredit>` is omitted
- empty or whitespace-only `<note>` text is skipped
- note order must match XML order
- `<notes @type>` is copied to each emitted note as `noteType` so rendering has all required context without looking back at the wrapper node

### 1.5 Reference-link model
Owners: `src/transforms/uslm-to-ir.ts`, `src/transforms/markdown.ts`, `src/transforms/write-output.ts`

This issue introduces a production rule for USC cross-reference rendering.

Canonical pure helper boundary:

```ts
export interface UscReferenceTarget {
  titleNumber: number;
  sectionNumber: string;
}

function parseUscReference(identifier: string): UscReferenceTarget | null;
function sectionSortKey(sectionNumber: string): { numericRoot: number; suffix: string; raw: string };
function paddedSectionFileStem(sectionNumber: string): string;
function relativeSectionHref(fromTitle: number, target: UscReferenceTarget): string;
```

Required behavior:
- identifiers matching `/us/usc/t{title}/s{section}` become relative markdown links to the generated section file
- non-matching or malformed identifiers render as plain text, never broken markdown `[]()`
- links may cross titles and must still resolve into the repository output tree
- relative href generation must use the same filename-padding logic as actual file output

### 1.6 Filename and ordering model
Owners: `src/domain/normalize.ts`, `src/transforms/write-output.ts`, `src/transforms/markdown.ts`

This issue hardens the output contract for section filenames and title index ordering.

Canonical helper contracts:

```ts
export interface SectionNumberParts {
  numericRoot: string; // original digits before padding
  suffix: string;      // trailing alphanumeric text after numeric root
}

function splitSectionNumber(sectionNumber: string): SectionNumberParts;
function padSectionNumber(sectionNumber: string): string;
function compareSectionNumbers(a: string, b: string): number;
```

Required behavior:
- pad the leading numeric root to fixed width `5`
- preserve trailing suffix exactly after the padded root
- preserve current slash normalization (`/` -> `-`) in the final file stem
- examples that must remain true:
  - `1 -> 00001`
  - `101 -> 00101`
  - `1234 -> 01234`
  - `106a -> 00106a`
  - `7702B -> 07702B`
  - `2/3 -> 00002-3` for the file-safe stem

Sorting rules:
1. compare numeric root numerically
2. if tied, compare suffix with deterministic case-sensitive string order unless implementation explicitly normalizes case in one shared place
3. use the exact same sort helper for `_title.md` rendering and any filesystem-order assertions

### 1.7 Persistence and migration impact
No SQL migrations, manifest migrations, or cache-layout migrations are required.

Changed persistence artifacts are only generated markdown files:
- `uscode/title-{NN}/section-{PPPPP...}.md`
- `uscode/title-{NN}/_title.md`

### 1.8 Seed data / fixtures
The committed fixture set remains the canonical seed-equivalent dataset for this issue.

Required fixture coverage:
- Title 1: simple chapter structure and letter-suffix identifiers
- Title 5: part-based hierarchy
- Title 10: subtitle-based hierarchy
- Title 26: deep mixed hierarchy (`subtitle -> part -> chapter -> section` at minimum)

Integration fixture strategy remains deterministic:
- committed representative XML fixtures for parser/markdown correctness
- deterministic multi-title integration fixture generation for numeric titles `1..52` and `54`
- reserved-empty Title 53 remains a negative-path fixture

### 1.9 Index/lookup strategy
There are no database indexes in scope.

Equivalent lookup and ordering strategy for this issue:
- one shared pure sort-key helper owns section ordering
- one shared pure filename-padding helper owns section file stems
- parser IR and rendered markdown must not implement separate ordering logic

That prevents drift between:
- on-disk filename order
- `_title.md` section order
- cross-reference link targets

---

## 2. Interface Contract

This repository exposes a CLI, not an HTTP API. Therefore **no OpenAPI surface is added** for this issue.

The external contract in scope is:
- the existing transform CLI behavior
- parser and renderer function contracts consumed internally
- generated markdown/file layout

### 2.1 Parser contract
Function:

```ts
parseUslmToIr(xml: string, xmlPath?: string): ParsedTitleResult
```

Required observable behavior after this issue:
- accept both legacy `<uslm><title>` and current `<uscDoc><main><title>` roots
- discover sections at any nesting depth beneath `<title>`
- attach hierarchy metadata to every parsed section
- preserve one-to-one correspondence between source `<section>` elements and parsed sections for the tested fixtures
- emit `MISSING_SECTION_NUMBER` only when a section lacks a recoverable canonical identifier
- continue preserving backward compatibility for legacy fixtures

### 2.2 Markdown rendering contract
Functions:

```ts
renderSectionMarkdown(section: SectionIR): string
renderTitleMarkdown(titleIr: TitleIR): string
```

Required observable behavior:
- section frontmatter includes top-level keys for each present hierarchy level: `subtitle`, `part`, `subpart`, `chapter`, `subchapter`
- section frontmatter includes `source_credit` when `SectionIR.sourceCredit` is present
- absent hierarchy/source-credit fields are omitted rather than emitted empty
- statutory notes render under `## Statutory Notes` after the main body
- `_title.md` section bullets are sorted by canonical section order, not parser discovery order
- rendered links for transformable USC refs are relative markdown links to generated section files

### 2.3 File output contract
Functions:

```ts
sectionFilePath(titleNumber: number, sectionId: string): string
writeTitleOutput(outputRoot: string, titleIr: TitleIR): Promise<{ filesWritten: number; parseErrors: ParseError[] }>
```

Required observable behavior:
- generated section filenames always use zero-padded numeric roots
- no legacy unpadded `section-1.md` style outputs remain for transformed sections
- path safety guarantees remain unchanged
- write failures continue surfacing through `OUTPUT_WRITE_FAILED`

### 2.4 CLI transform contract
Command surface remains the existing transform command.

Required observable behavior:
- all non-reserved numeric titles `1..52` and `54` succeed in the deterministic integration matrix
- reserved-empty Title `53` retains its existing non-success diagnostic path
- non-reserved transformed titles produce at least one section file
- summed generated section counts match summed XML `<section>` counts for the fixture set used by acceptance coverage

### 2.5 Error contract
No new top-level error class is required.

Existing parse/write errors remain valid, but this issue tightens correctness so the parser must no longer silently drop sections just because they are nested deeper than one chapter level.

### 2.6 Rate limiting / pagination
Not applicable. No HTTP endpoint or paginated API contract is introduced by this issue.

---

## 3. Service Boundaries

### 3.1 Monolith/module decision
Remain a single-process CLI package. No service split.

Rationale:
- the work is entirely local to XML parsing, markdown rendering, and filesystem output
- there is no independent deployment unit or asynchronous workload here
- adding a service boundary would be pure complexity with no operational benefit

### 3.2 Module ownership

#### `src/domain/model.ts`
Owns:
- `SectionIR` contract changes
- `SectionHierarchyPath`
- `StatutoryNoteIR`
- compatibility with existing transform-facing types

#### `src/domain/normalize.ts`
Owns:
- section-number splitting
- numeric-root padding
- canonical section comparison
- file-safe section stem derivation

#### `src/transforms/uslm-to-ir.ts`
Owns:
- recursive hierarchy traversal
- hierarchy-context accumulation
- extraction of `<sourceCredit>` and `<notes>`
- parsing of `<ref>` identifiers into normalized internal link targets or plain text fallbacks
- continued XML parser configuration

#### `src/transforms/markdown.ts`
Owns:
- frontmatter serialization for hierarchy keys and `source_credit`
- `## Statutory Notes` rendering
- markdown link emission for recognized USC refs
- `_title.md` canonical section ordering

#### `src/transforms/write-output.ts`
Owns:
- section file path generation using padded section identifiers
- consistent linkage between filename helper and actual output layout
- write-path safety and atomic output semantics already present in the repository

#### `tests/unit/transforms/uslm-to-ir.test.ts`
Owns:
- recursive-walk coverage
- hierarchy-path capture coverage
- metadata extraction coverage
- one-to-one `<section>` count assertions against representative fixtures

#### `tests/unit/transforms/markdown.test.ts`
Owns:
- frontmatter serialization assertions
- statutory-notes rendering assertions
- canonical title-index ordering assertions
- markdown link rendering assertions

#### `tests/unit/transforms/write-output.test.ts`
Owns:
- padding helper correctness
- section filename generation
- path-safe output behavior

#### `tests/integration/transform-cli.test.ts`
Owns:
- full transform regression for selected fixtures/titles
- reserved-empty Title 53 path
- filesystem ordering assertions
- summed section-count acceptance validation

### 3.3 Dependency direction
Required dependency graph:

```text
CLI / integration tests
  -> write-output
  -> markdown
  -> parser
  -> domain helpers

markdown
  -> domain/model
  -> domain/normalize

write-output
  -> markdown
  -> domain/normalize
  -> fs utilities

parser
  -> domain/model
  -> domain/normalize
  -> fast-xml-parser
```

Rules:
- normalization helpers must be pure and reusable
- markdown/rendering must not reimplement parsing rules
- write-output must not invent its own filename-padding logic
- tests may validate fixtures and emitted markdown/files, but production code must not depend on test-only helpers

### 3.4 Communication pattern
Direct in-process function calls only.

No events, queues, RPC, HTTP callbacks, or worker processes are required.

---

## 4. Infrastructure Requirements

### 4.1 Production/runtime
This issue adds **no production infrastructure**.

Runtime requirements remain:
- Node.js 22+ compatible environment
- local filesystem for transform output
- `fast-xml-parser` for XML parsing
- `gray-matter` for markdown frontmatter serialization

No new requirements for:
- Postgres
- Redis
- S3/object storage
- background queues
- DNS/certificates
- hosted monitoring

### 4.2 Dev/testing
Required local and CI capabilities:
- `npm install`
- `npm run build`
- `npm test`
- deterministic temp-directory filesystem access for integration tests
- committed XML fixtures under `tests/fixtures/xml/`

### 4.3 Fixture infrastructure
Tests must remain fully local and deterministic.

Required fixture assets or equivalents:
- committed XML fixtures for Titles 1, 5, 10, and 26
- deterministic matrix-generation support for titles `1..52` and `54`
- negative fixture path for reserved-empty Title `53`
- schema file `docs/schemas/USLM-1.0.15.xsd` as the reference artifact for test design only

### 4.4 CI requirements
CI must run, at minimum:

```bash
npm run build
npm test
```

Success conditions:
- parser compiles after IR/model changes
- existing transform/parser tests still pass
- new hierarchy/metadata/padding coverage passes
- integration matrix proves non-reserved-title success and reserved-empty Title 53 behavior

### 4.5 Observability and logging
No new telemetry pipeline is required.

This issue should not add verbose per-section logging. Correctness belongs in unit/integration assertions rather than noisy runtime output.

---

## 5. Dependency Decisions

### 5.1 `fast-xml-parser` `^4.5.0`
- **Why this one:** already used by the repository; supports the current XML parsing contract and namespace/attribute behavior needed for USLM/uscDoc.
- **Alternatives rejected:** replacing the parser would increase risk and scope without solving the core traversal/rendering defects.
- **License:** MIT-compatible.
- **Maintenance status:** active and already present in the repo.
- **Architecture decision:** retain and extend parser-side pure helpers rather than changing XML engines.

### 5.2 `gray-matter` `^4.0.3`
- **Why this one:** already used for markdown frontmatter serialization; adequate for deterministic section/title markdown generation.
- **Alternatives rejected:** hand-rolled YAML frontmatter serialization adds avoidable risk.
- **License:** MIT-compatible.
- **Maintenance status:** mature and acceptable for current usage.
- **Architecture decision:** keep and expand usage to serialize hierarchy/source-credit frontmatter keys.

### 5.3 `vitest` `^3.0.0`
- **Why this one:** already powers both unit and integration coverage.
- **Alternatives rejected:** no value in adding another test harness for a localized transform change.
- **License:** MIT-compatible.
- **Maintenance status:** actively maintained.
- **Architecture decision:** extend current suites with fixture-backed coverage instead of introducing custom runners.

### 5.4 No new dependencies
This issue should add **zero** new runtime or dev dependencies.

Rationale:
- recursive traversal, ordering, padding, and reference parsing are straightforward with existing code
- runtime XSD validation is explicitly out of scope
- keeping the dependency surface flat lowers regression and security risk

---

## 6. Integration Points

### 6.1 Existing repository integrations

#### Parser -> IR
`src/transforms/uslm-to-ir.ts` populates `TitleIR` and `SectionIR`.

This issue extends that integration by requiring:
- `SectionIR.hierarchy`
- `SectionIR.sourceCredit`
- `SectionIR.statutoryNotes`

#### IR -> Markdown
`src/transforms/markdown.ts` consumes the parser IR.

This issue hardens that integration by making rendered markdown the canonical proof that hierarchy metadata survives beyond parser memory.

#### Markdown -> Filesystem output
`src/transforms/write-output.ts` maps section identifiers into actual file paths.

This issue requires that the same section-number normalization logic drive:
- file naming
- title index order
- internal relative link targets

### 6.2 Schema reference integration
`docs/schemas/USLM-1.0.15.xsd` remains a **reference artifact**, not a runtime dependency.

Required use:
- justify fixture structure and test expectations
- do not parse or validate the XSD during normal CLI execution

### 6.3 Fixture-driven acceptance integration
The deterministic transform integration matrix is part of the production safety net for this issue.

Required acceptance integration points:
- section count from transformed output == source `<section>` count for tested fixtures
- every section with `<sourceCredit>` in source XML produces `source_credit` frontmatter
- every section with `<notes>` produces `## Statutory Notes`
- mixed-width identifiers produce lexicographically correct file listings after transform

---

## 7. Security Considerations

### 7.1 Input validation strategy
XML remains untrusted input at the parser boundary, even when sourced from committed fixtures or cached OLRC artifacts.

Security requirements:
- continue using the existing parser configuration without enabling dangerous evaluation features
- normalize all hierarchy numbers, section numbers, and metadata text before rendering or path generation
- omit empty/invalid fields rather than emitting malformed frontmatter or broken file paths
- preserve existing degraded behavior when a section lacks a usable identifier

### 7.2 Path-safety guarantees
The main security-sensitive output for this issue is filesystem naming.

Required guarantees:
- filenames are derived only from normalized section-number helpers
- slash normalization remains explicit (`/` -> `-`)
- no raw XML text may be interpolated directly into output paths
- padded filename generation must not permit traversal or separator injection
- write-output continues to enforce safe output-root confinement through existing path checks

### 7.3 Link rendering safety
Relative markdown links must be emitted only for recognized USC section identifiers.

Guardrails:
- recognized `/us/usc/t{title}/s{section}` refs become computed relative links
- unrecognized identifiers fall back to plain text
- renderer must never emit malformed empty-link markdown
- target filenames must be derived through the same sanitized helper used for actual writes

### 7.4 Resource and denial-of-service posture
This issue does not materially increase runtime resource risk, but recursive traversal must remain bounded by the parsed XML tree.

Guardrails:
- reuse existing normalized-field limits
- keep recursive logic pure and local to the parsed tree
- avoid runtime schema validation or extra network operations
- do not add per-node logging that could explode output volume on large titles

### 7.5 Secrets and sensitive data
No secrets, auth tokens, cookies, or PII are introduced by this issue.

### 7.6 Auth model / CORS / rate limiting
Not applicable. This issue does not expose an HTTP service or browser-facing API.

### 7.7 Integrity guarantees
This is primarily a data-integrity issue.

A bad implementation can:
- drop sections silently
- misorder section files
- produce broken internal citations
- lose hierarchy provenance in the final markdown

Therefore the architecture requires explicit tests proving:
- one parsed section per source `<section>` node for representative fixtures
- one canonical filename helper reused everywhere
- frontmatter emits present hierarchy keys and omits absent ones
- links are only generated for recognized USC identifiers

---

## Implementation Plan Summary

1. Extend `src/domain/model.ts` with hierarchy and statutory-note types plus singular `sourceCredit`.
2. Add pure section-number helpers in `src/domain/normalize.ts` for splitting, padding, sorting, and file-safe stems.
3. Replace fixed section collection in `src/transforms/uslm-to-ir.ts` with recursive traversal that accumulates hierarchy context.
4. Extract `<sourceCredit>` and `<notes>` into dedicated IR fields, preserving XML order.
5. Add shared USC-reference parsing helpers so markdown rendering can emit relative links only when safe.
6. Update `src/transforms/markdown.ts` to serialize hierarchy/source-credit frontmatter, render `## Statutory Notes`, and sort `_title.md` sections canonically.
7. Update `src/transforms/write-output.ts` to use padded section filenames exclusively.
8. Expand unit/integration tests for Titles 1, 5, 10, and 26 plus the full numeric-title matrix.

## Acceptance Mapping

| Spec Requirement | Architectural Mechanism |
|---|---|
| Recursive section discovery at any depth | Recursive traversal with accumulated `HierarchyContext` |
| Hierarchy preserved in rendered markdown | Top-level frontmatter serialization for `subtitle`, `part`, `subpart`, `chapter`, `subchapter` |
| Singular `source_credit` output | Dedicated `SectionIR.sourceCredit` extracted from `<sourceCredit>` |
| Statutory notes rendered after main body | Dedicated `SectionIR.statutoryNotes` rendered under `## Statutory Notes` |
| USC refs become internal links when transformable | Pure reference parser + relative href helper + shared filename helper |
| Zero-padded filenames | Shared numeric-root padding helper at width `5` |
| `_title.md` sorted in canonical order | Shared `compareSectionNumbers()` helper reused by markdown renderer |
| All non-reserved titles transform successfully | Deterministic integration matrix for titles `1..52` and `54` |
| Reserved Title 53 behavior unchanged | No change to reserved-empty integration path |
| Existing tests keep passing | Additive model/parser/rendering changes with backward-compatible regression coverage |

## Components Affected

| Component | Change | Impact |
|---|---|---|
| `src/domain/model.ts` | Add hierarchy + statutory-note + singular source-credit IR fields | Medium |
| `src/domain/normalize.ts` | Add canonical section split/pad/sort helpers | Medium |
| `src/transforms/uslm-to-ir.ts` | Replace fixed walk with recursive traversal and richer metadata extraction | High |
| `src/transforms/markdown.ts` | Serialize hierarchy/source-credit frontmatter, render statutory notes, canonical ordering, ref links | High |
| `src/transforms/write-output.ts` | Switch section filenames to padded helper | Medium |
| `tests/unit/transforms/uslm-to-ir.test.ts` | Add recursive hierarchy and count-completeness coverage | High |
| `tests/unit/transforms/markdown.test.ts` | Add rendered frontmatter/order/link/statutory-note coverage | High |
| `tests/unit/transforms/write-output.test.ts` | Add padded filename expectations | Medium |
| `tests/integration/transform-cli.test.ts` | Add mixed-width ordering and full-title matrix guarantees | High |
| `tests/fixtures/xml/**` | Add or refresh representative OLRC fixtures for Titles 1/5/10/26 | Medium |

## Explicit Non-Goals
- No appendix-title CLI support (`5a`, `11a`, etc.)
- No runtime XSD validation
- No redesign of general prose formatting beyond statutory-note/link requirements
- No changes to OLRC acquisition, releasepoint selection, or cache schema
- No new services, databases, queues, or background workers
