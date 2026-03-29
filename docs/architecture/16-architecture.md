# Architecture — Issue #16: Transform chapter-level output mode

## Scope and intent

Add an **extensible output grouping mode** to the existing `transform` CLI so callers can request chapter-grouped markdown output with `--group-by chapter` while preserving the current section-per-file behavior as the default. The implementation must remain additive, deterministic, network-neutral during transform, and must reuse the existing section markdown renderer to prevent output drift between section mode and chapter mode.

This repository is a **local TypeScript CLI**, not a network service. Accordingly, this architecture intentionally keeps the change inside the current single-process CLI boundary and does **not** introduce a database, queue, daemon, HTTP API, or background worker.

---

## 1. Data model

### 1.1 Canonical runtime data structures

No persistent database schema is required for this issue. The transform pipeline already operates on in-memory IR objects loaded from OLRC ZIP fixtures/cache and writes markdown artifacts to the filesystem. This feature extends those **runtime domain types** and the **JSON stdout report contract** only.

#### Existing entities reused as-is
- `TitleIR`
  - `titleNumber: number`
  - `heading: string`
  - `positiveLaw: boolean | null`
  - `chapters: ChapterIR[]`
  - `sections: SectionIR[]`
  - `sourceUrlTemplate: string`
- `SectionIR`
  - existing `sectionNumber`, `heading`, `source`, `content`, `hierarchy.chapter`, etc.
- `ChapterIR`
  - `number: string`
  - `heading: string`

#### Required additive type changes

```ts
// src/domain/model.ts
export type TransformGroupBy = 'section' | 'chapter';

export interface TransformWarning {
  code: 'UNCATEGORIZED_SECTION';
  message: string;
  sectionHint: string;
  chapterHint?: string;
}

export interface ParseReport {
  sectionsFound: number;
  filesWritten: number;
  parseErrors: ParseError[];
  warnings?: TransformWarning[];
}
```

Rationale:
- `TransformGroupBy` is an **extensible discriminated mode value**, satisfying the spec requirement that future values such as `subchapter` or `part` can be added without replacing a boolean contract.
- `TransformWarning` separates successful-but-imperfect chapter grouping diagnostics from `parseErrors`, matching the approved spec.

### 1.2 Derived write model

Introduce pure, filesystem-independent grouping structures.

```ts
// proposed internal types in src/transforms/write-output.ts or a nearby pure helper module
interface ChapterBucket {
  bucketType: 'chapter';
  chapter: string;
  heading: string;
  safeFileStem: string;     // e.g. chapter-001 or chapter-subchapter-a
  sections: SectionIR[];
}

interface UncategorizedBucket {
  bucketType: 'uncategorized';
  heading: 'Uncategorized';
  safeFileStem: '_uncategorized';
  sections: SectionIR[];
}
```

### 1.3 Filesystem output contract

No new directories are introduced. All writes remain under:

```text
{outputRoot}/uscode/title-{NN}/
```

#### Default mode (`groupBy = 'section'`)
- `_title.md`
- `section-*.md` (unchanged)

#### Chapter mode (`groupBy = 'chapter'`)
- `_title.md`
- `chapter-{CCC}.md` for numeric chapter identifiers
- `chapter-{safe-id}.md` for non-numeric chapter identifiers
- `_uncategorized.md` if one or more sections have no `hierarchy.chapter`

### 1.4 JSON report schema

The emitted stdout JSON becomes:

```json
{
  "title": 42,
  "source_url": "https://uscode.house.gov/...",
  "sections_found": 1203,
  "files_written": 132,
  "parse_errors": [],
  "warnings": [
    {
      "code": "UNCATEGORIZED_SECTION",
      "message": "Section 999 has no hierarchy.chapter and was written to _uncategorized.md",
      "sectionHint": "999"
    }
  ]
}
```

Backward compatibility:
- Existing consumers that only read `parse_errors` continue to function.
- `warnings` is additive and optional.

### 1.5 Idempotency / migration notes

There are **no database migrations** for this issue.

Idempotency instead applies to file generation:
- repeated transform runs against the same clean output root must produce byte-identical chapter files;
- filename derivation must be pure and deterministic;
- section order inside a bucket must be the output of existing `sortSections()` only.

### 1.6 Seed/test data

The current fixture strategy remains the seed mechanism:
- `tests/fixtures/xml/title-01/...`
- generated per-title ZIP fixtures in integration tests
- synthetic in-memory `TitleIR` / `SectionIR` values for unit tests

Additional fixtures needed:
1. Non-numeric chapter identifiers (`IV`, ` Subchapter A `, `A-1 / Special`, `***`)
2. Missing chapter heading in `TitleIR.chapters`
3. One or more uncategorized sections
4. Multiple sections in same chapter to prove file-count reduction

### 1.7 Index/constraint discussion

Because this is a filesystem-output CLI feature:
- **No SQL tables**
- **No indexes**
- **No relational constraints**

Equivalent invariants must be enforced in pure code and tests:
- every written codified section appears exactly once;
- no section appears in more than one chapter bucket;
- all output paths pass `assertSafeOutputPath()`;
- normalized chapter stems are deterministic and non-empty (`unnamed` fallback).

---

## 2. API contract

This repo has no HTTP API. The externally consumed contract is the **CLI interface** and **stdout JSON report**.

### 2.1 CLI contract

#### Command

```bash
us-code-tools transform --title <number> --output <dir> [--group-by chapter]
```

#### Arguments

| Flag | Required | Type | Allowed values | Notes |
|------|----------|------|----------------|-------|
| `--title` | yes | integer | `1..54` | existing contract; appendix titles like `5a` remain invalid |
| `--output` | yes | path | writable directory path or non-existent path | existing contract |
| `--group-by` | no | enum | `chapter` | omitted means default section mode |

#### Validation rules
- Missing `--title` → usage error, exit `1`
- Missing `--output` → usage error, exit `1`
- `--title` not integer `1..54` → usage error, exit `1`
- `--group-by` missing value → usage error, exit `1`
- duplicate `--group-by` → usage error, exit `1`
- unsupported `--group-by` value (for example `part`) → usage error, exit `1`
- argument validation occurs **before any output write**

### 2.2 CLI result semantics

#### Successful default mode
- exit `0` if section files were written successfully under existing rules
- `_title.md` remains present

#### Successful chapter mode
- exit `0` if `_title.md` plus at least one chapter or `_uncategorized.md` file was written successfully
- uncategorized sections may generate `warnings[]` without changing exit code
- `parse_errors` remains reserved for parse and write failures, not uncategorized routing

#### Failure semantics
- duplicate section collision remains exit `1`
- invalid output root or write failure preserves current non-zero behavior
- reserved-empty title 53 behavior remains unchanged

### 2.3 Stdout report contract

#### Success shape

```json
{
  "title": 1,
  "source_url": "string",
  "sections_found": 53,
  "files_written": 14,
  "parse_errors": [],
  "warnings": []
}
```

#### Error channels
- usage and fatal command errors continue to `stderr`
- structured transform summary continues to `stdout`

### 2.4 Compatibility policy

The transform command is the only public contract affected. Backward compatibility requirements:
- existing invocations without `--group-by` must not change behavior or file layout;
- existing report fields remain intact;
- downstream consumers may safely ignore `warnings`.

### 2.5 Rate limiting / pagination / auth

Not applicable. This command is a local CLI with no user authentication or paginated transport.

---

## 3. Service boundaries

### 3.1 Single-process module architecture

Keep the repo as one deployable unit: a **single Node.js CLI executable**.

No service split is justified because:
- transform is synchronous, local, and bounded to one title per invocation;
- there is no multi-tenant or independently scaled runtime;
- chapter grouping is pure transformation logic on already-parsed IR.

### 3.2 Module ownership and responsibilities

#### `src/index.ts`
Owns:
- CLI arg parsing
- command validation
- invocation of OLRC cache resolution, parse pipeline, and output writing
- JSON report assembly / exit code semantics

Change required:
- extend `parseTransformArgs()` to return `{ titleNumber, outputDir, groupBy }`
- include `warnings` in the report
- pass `groupBy` into output writer

#### `src/domain/model.ts`
Owns:
- shared domain types for IR, diagnostics, and report structures

Change required:
- add `TransformGroupBy`
- add `TransformWarning`
- extend report typing for `warnings`

#### `src/domain/normalize.ts`
Owns:
- deterministic normalization and sorting helpers

Change required:
- add a single shared helper for chapter filename normalization, e.g.:

```ts
export function chapterFileSafeId(chapter: string): string;
export function chapterOutputFilename(chapter: string): string;
```

Responsibilities:
- numeric detection and zero-padding to width 3
- non-numeric normalization exactly as defined by spec
- deterministic bucket ordering helper if needed

#### `src/transforms/markdown.ts`
Owns:
- markdown rendering from IR

Change required:
- add `renderChapterMarkdown(...)`
- add `renderUncategorizedMarkdown(...)`

Critical constraint:
- `renderChapterMarkdown()` must **compose** `renderSectionMarkdown(section)` output rather than re-implement section-body rendering.

#### `src/transforms/write-output.ts`
Owns:
- materialization of markdown files to disk under safe output roots

Change required:
- preserve current section mode implementation
- add chapter grouping path
- emit `warnings[]` for uncategorized sections
- write `_title.md` in both modes

Recommended shape:

```ts
export async function writeTitleOutput(
  outputRoot: string,
  titleIr: TitleIR,
  options?: { groupBy?: TransformGroupBy }
): Promise<{ filesWritten: number; parseErrors: ParseError[]; warnings: TransformWarning[] }>;
```

#### `src/utils/fs.ts`
Owns:
- safe atomic writes and path boundary checks

No interface change required.

### 3.3 Dependency direction

Dependency flow must remain one-way:

```text
index.ts
  -> sources/*
  -> transforms/uslm-to-ir.ts
  -> transforms/write-output.ts
       -> transforms/markdown.ts
       -> domain/model.ts
       -> domain/normalize.ts
       -> utils/fs.ts
```

Rules:
- `markdown.ts` must not import `write-output.ts`
- `domain/*` stays pure and filesystem-free
- `write-output.ts` may orchestrate grouping + writing but should call pure helpers for bucket derivation

### 3.4 Communication pattern

Pure in-process function calls only. No queues, events, RPC, sockets, or subprocess fan-out are required.

---

## 4. Infrastructure requirements

### 4.1 Production/runtime requirements

For this CLI feature, “production” means a developer/CI machine running Node.js.

#### Required runtime
- Node.js 22+ (aligned with current typings / repo tooling)
- local filesystem access for output directory creation and atomic rename
- existing OLRC cached ZIP artifacts under repo data directory or test fixture cache

#### Storage
- Local filesystem only
- No object store, database, cache layer, or message broker

#### Network
- None during transform execution beyond existing upstream cache assumptions
- Chapter mode must not introduce new network calls

#### Monitoring/logging
- Existing stderr/stdout behavior is sufficient for this scope
- Structured transform report remains the primary machine-readable signal

### 4.2 Development and test requirements

#### Local dev
- `npm install`
- `npm run build`
- `npm test`

#### Test strategy

##### Unit tests
Add/extend tests for:
- `parseTransformArgs()` enum validation and duplicate flag rejection
- chapter filename normalization examples from spec
- missing chapter heading fallback (`Chapter {chapter}`)
- byte-identical section embedding
- uncategorized warning generation
- deterministic bucket ordering

##### Integration tests
Extend `tests/integration/transform-cli.test.ts` to cover:
- default mode unchanged
- chapter mode writes `_title.md` + `chapter-*.md`
- no `section-*.md` in chapter mode
- full title matrix in chapter mode for `1..52` and `54`
- reserved-empty title 53 unchanged
- file count reduced vs default mode when multiple sections share a chapter

#### CI expectations
- build gate: `npm run build`
- test gate: `npm test`
- no new secrets or service containers required

### 4.3 Rollback plan

Because the change is additive and local:
- rollback is a normal git revert of the chapter-mode codepath;
- no migration rollback or data backfill is required;
- existing default behavior remains isolated and can be tested independently.

---

## 5. Dependency decisions

This issue should not add any new runtime dependency unless implementation friction is extreme. Current dependencies are already sufficient.

| Dependency | Version in repo | Purpose in this issue | Why keep/use it | License | Maintenance status |
|-----------|-----------------|----------------------|-----------------|---------|--------------------|
| `typescript` | `^5.8.0` | type-safe implementation | already standard in repo; no change needed | Apache-2.0 | actively maintained |
| `vitest` | `^3.0.0` | unit/integration verification | already used; fast ESM-native testing | MIT | actively maintained |
| `gray-matter` | `^4.0.3` | frontmatter serialization/parsing | already used for markdown output and tests | MIT | mature/stable |
| `fast-xml-parser` | `^4.5.0` | existing parser only | unaffected by feature; no replacement needed | MIT | actively maintained |
| `yauzl` | `^3.1.0` | existing ZIP extraction | unaffected by feature; no replacement needed | MIT | mature/stable |
| `@types/node` | `^22.0.0` | Node typings | already required | MIT | maintained with DefinitelyTyped |

### 5.1 Explicit non-decisions
- **No commander/yargs**: CLI parsing remains simple enough to keep custom parsing in `src/index.ts`; introducing a parser library would be unnecessary churn for one enum flag.
- **No slugify package**: chapter filename normalization is spec-defined and simple; implementing it in `src/domain/normalize.ts` is smaller, safer, and more controllable than adding a third-party slugification dependency.
- **No YAML library changes**: none needed.

---

## 6. Integration points

### 6.1 Existing repo integrations

#### OLRC cache resolution
`src/index.ts` -> `resolveCachedOlrcTitleZipPath()`
- unchanged
- chapter mode consumes the exact same ZIP and XML entries as default mode

#### USLM parsing
`src/index.ts` -> `parseUslmToIr()`
- unchanged parser boundary
- chapter mode consumes `section.hierarchy.chapter` exactly as parsed
- no fallback inference from title headings or filenames

#### Section sorting
`sortSections()` / `compareSectionNumbers()` in `src/domain/normalize.ts`
- reused for within-bucket order
- must remain the single source of truth for section order

#### Title metadata markdown
`renderTitleMarkdown()`
- unchanged output semantics
- still writes `_title.md` in both modes

### 6.2 New integration points introduced by this issue

#### Chapter filename derivation
- shared helper in `src/domain/normalize.ts`
- used by both write logic and unit tests
- exact spec examples become acceptance fixtures

#### Chapter markdown assembly
- new renderer in `src/transforms/markdown.ts`
- consumes `TitleIR`, chapter identifier, resolved heading, and sorted `SectionIR[]`
- must embed section markdown slices generated by `renderSectionMarkdown()`

#### Warning propagation
- `write-output.ts` emits report-only `TransformWarning[]`
- `index.ts` surfaces them in stdout JSON report

### 6.3 Data flow

```text
cached OLRC ZIP
  -> XML entries
  -> parseUslmToIr()
  -> merged TitleIR
  -> sortSections()
  -> branch on groupBy
       section mode:
         write each section markdown + _title.md
       chapter mode:
         group by section.hierarchy.chapter
         resolve chapter headings from TitleIR.chapters
         render concatenated chapter markdown
         write chapter files + optional _uncategorized.md + _title.md
  -> emit JSON report { files_written, parse_errors, warnings }
```

### 6.4 External systems

None new for this issue.

---

## 7. Security considerations

Even for a local CLI, this feature changes output write patterns and filename derivation, so security and robustness matter.

### 7.1 Path safety

Requirements:
- every chapter output path must be built from controlled helpers only;
- all writes must continue to go through `assertSafeOutputPath()`;
- chapter identifiers must never be interpolated raw into filenames.

Controls:
- numeric chapter filenames: fixed `chapter-{pad3}.md`
- non-numeric filenames: sanitized by a spec-defined helper
- uncategorized filename: constant `_uncategorized.md`

This blocks path traversal and hostile filename injection from malformed upstream XML metadata.

### 7.2 Input validation

Controls:
- strict enum validation for `--group-by`
- duplicate flag rejection
- no fallback inference for missing chapter values
- unsupported values fail before writing any output

### 7.3 Output determinism as a safety property

Determinism reduces operational risk:
- makes diffs auditable;
- prevents flaky CI artifacts;
- reduces chances of accidentally committing semantically identical but byte-different output.

Controls:
- stable `sortSections()` for section order
- deterministic chapter bucket ordering
- single normalization helper for all chapter file stems
- chapter rendering delegated to existing section renderer

### 7.4 Integrity of rendered content

Primary risk: chapter mode could silently diverge from section mode if a second renderer is implemented.

Mitigation:
- `renderChapterMarkdown()` must be implemented as **composition of `renderSectionMarkdown()` output**, not re-rendering from raw content nodes.
- tests must compare standalone section markdown slices to chapter-embedded slices byte-for-byte after frontmatter stripping.

### 7.5 Sensitive data handling

No new secrets, credentials, PII, or external auth tokens are introduced.

### 7.6 Denial-of-service / resource considerations

Chapter mode reduces output file count materially, which is operationally beneficial. It does, however, create larger individual markdown files.

Assessment:
- acceptable within current title sizes and existing fixture constraints;
- no queue or streaming writer is required;
- write operations remain atomic per file.

### 7.7 Error isolation

If one chapter file fails to write:
- the command must surface an `OUTPUT_WRITE_FAILED` diagnostic identifying the failed bucket/file;
- successful buckets must not be double-counted;
- the process returns non-zero through the existing write-failure path.

### 7.8 CORS / auth / transport encryption

Not applicable: no HTTP surface is introduced.

---

## 8. Concrete implementation plan

### 8.1 `src/index.ts`
1. Extend `parseTransformArgs()` to parse `--group-by` safely.
2. Return `groupBy: 'section' | 'chapter'`, defaulting to `'section'`.
3. Pass `{ groupBy }` into `writeTitleOutput()`.
4. Include `warnings` in the stdout JSON report.
5. Keep title 53 and duplicate-section semantics unchanged.

### 8.2 `src/domain/model.ts`
1. Add `TransformGroupBy`.
2. Add `TransformWarning`.
3. Extend `ParseReport` or output result typing to support `warnings`.

### 8.3 `src/domain/normalize.ts`
1. Add helper to detect purely numeric chapter identifiers.
2. Add helper implementing the spec normalization contract for non-numeric chapter identifiers.
3. Add helper to generate final filename stem (`chapter-001`, `chapter-iv`, etc.).
4. Optionally add deterministic bucket comparator.

### 8.4 `src/transforms/markdown.ts`
1. Add frontmatter renderer for chapter file.
2. Lookup heading from `TitleIR.chapters`, else use `Chapter {chapter}`.
3. Strip each section’s frontmatter and concatenate bodies separated by a single blank line.
4. Add `_uncategorized.md` renderer with `heading: Uncategorized`.

### 8.5 `src/transforms/write-output.ts`
1. Preserve current section write codepath as default.
2. Add grouping helper producing categorized and uncategorized buckets.
3. Write chapter files in deterministic order.
4. Return `{ filesWritten, parseErrors, warnings }`.
5. Always write `_title.md` regardless of mode.

### 8.6 Tests
1. Unit tests for chapter stem normalization and heading fallback.
2. Unit test proving embedded section bodies are byte-identical to section renderer output.
3. Integration coverage for chapter mode, uncategorized warnings, and full title matrix.

---

## 9. Acceptance mapping

| Spec requirement | Architectural decision |
|---|---|
| Extensible `--group-by` contract | `TransformGroupBy = 'section' | 'chapter'` enum-like type |
| Default behavior unchanged | section mode remains the default path in `writeTitleOutput()` |
| Chapter files preserve exact section rendering | chapter renderer composes `renderSectionMarkdown()` output |
| Non-numeric chapter filenames testable | single shared normalization helper in `src/domain/normalize.ts` |
| Missing chapter heading fallback specified | exact literal `Chapter {chapter}` in renderer |
| Uncategorized sections not silent | `_uncategorized.md` + `warnings[]`, not `parse_errors` |
| Deterministic file count reduction | grouped write path with stable sort and stable bucket order |

---

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Chapter renderer drifts from section renderer | High | compose from `renderSectionMarkdown()` only; byte-identity tests |
| Non-deterministic bucket order for mixed numeric/non-numeric chapters | Medium | central comparator and deterministic sort in one helper |
| Invalid filenames from punctuation-heavy chapter identifiers | Medium | spec-defined normalization helper with `unnamed` fallback |
| Uncategorized sections silently dropped | High | mandatory `_uncategorized.md` + warning emission |
| Regression to default output mode | High | keep default code path separate and covered by existing integration tests |
| Partial file writes on failure | Medium | continue using `atomicWriteFile()` and per-file error capture |

---

## 11. Decision summary

1. **No new service or storage layer** — this is a local filesystem transform enhancement.
2. **Use an extensible grouping mode type, not a boolean** — future grouping modes remain additive.
3. **Preserve one canonical section renderer** — chapter mode is composition, not duplication.
4. **Surface missing chapter metadata as warnings, not parse errors** — aligned with approved spec and success criteria.
5. **Keep all writes under existing safe output root enforcement** — no raw chapter IDs in filenames.
