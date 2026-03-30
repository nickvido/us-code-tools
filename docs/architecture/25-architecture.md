# Architecture — Issue #25: Descriptive chapter filenames and appendix title selection

## Scope and intent

Extend the existing `transform` CLI in two additive ways:

1. In `--group-by chapter` mode, categorized chapter files must use descriptive filenames derived from both the chapter identifier and the chapter heading, e.g. `chapter-047-fraud-and-false-statements.md`.
2. The CLI must treat appendix titles as first-class transform targets, so callers can run `transform --title 5A` and `transform --all`, with appendix output written under directories such as `title-05a-appendix/`.

This repository is still a **single-process local TypeScript CLI**. The change stays inside the current transform pipeline and OLRC cache model. No database, queue, HTTP API, daemon, or background job is warranted.

The implementation must preserve all existing guarantees from issues #16 and #20:
- deterministic output
- no new network requirements during transform
- `_title.md` and `_uncategorized.md` remain unchanged
- section rendering remains canonical
- path safety remains enforced at the write boundary
- title `53` continues to report through the existing reserved-empty path rather than becoming a writable success case

`.dark-factory.yml` is not present in this repo snapshot, so architecture decisions are constrained by the repository’s current TypeScript/Node/Vitest stack as expressed in `package.json`, existing source layout, and prior architecture documents.

---

## 1. Data model

### 1.1 Persistent storage model

No database schema is required for this issue. The feature operates entirely on:
- cached OLRC ZIP/XML artifacts already present in the local corpus/manifest model
- in-memory transform IR objects
- filesystem output trees under the selected `--output` root
- JSON stdout reports emitted by the CLI

Accordingly:
- **No SQL migrations**
- **No seed tables**
- **No indexes**
- **No relational ownership changes**

The equivalent "data model" for this issue is the runtime type system plus the cache/manifest selector contract.

### 1.2 Canonical selector model

Introduce a single normalized title-selector boundary shared across CLI parsing, OLRC cache resolution, report emission, and output path derivation.

```ts
// src/domain/normalize.ts
export type TransformTitleSelector =
  | { kind: 'numeric'; value: number }          // 1..54
  | { kind: 'appendix'; value: 5 | 11 | 18 | 28 | 50; suffix: 'A' };

export interface NormalizedTitleTarget {
  selector: TransformTitleSelector;
  reportId: string;               // "5", "54", "5A", "11A"
  cacheKey: string;               // "05", "54", "05A", "11A"
  fixtureEnvKey: string;          // "05", "54", "05A", "11A"
  sourceXmlStem: string;          // "usc05", "usc54", "usc05A", "usc11A"
  outputDirectoryName: string;    // "title-05", "title-05a-appendix"
  sourceUrlId: string;            // "05", "54", "05A", "11A"
  isReservedEmptyCandidate: boolean;
}
```

Required normalization rules:
- numeric selectors accept only integers `1..54`
- appendix selectors accept only `5A`, `11A`, `18A`, `28A`, `50A`
- input is case-insensitive for appendix selectors
- canonical report form uses uppercase appendix suffix (`5A`)
- canonical output directory form uses lowercase appendix suffix with `-appendix` suffix (`title-05a-appendix`)
- canonical cache/XML lookup must match the actual cached appendix artifact naming without introducing a second acquisition path

This normalization boundary must be pure and unit-testable.

### 1.3 Runtime report model

The existing transform report is extended from a single-title numeric report to a selector-aware report model that still supports one-title invocation and aggregated `--all` invocation.

Recommended additive type shape:

```ts
// src/domain/model.ts
export interface TransformTargetReport {
  title: string;                  // "1", "5A", "53"
  source_url: string;
  sections_found: number;
  files_written: number;
  parse_errors: ParseError[];
  warnings?: TransformWarning[];
}

export interface TransformAllReport {
  requested_scope: 'all';
  targets: TransformTargetReport[];
}
```

Single-target transform may continue emitting the existing object shape for backward compatibility, but internally the implementation should normalize around a per-target report structure so `--all` becomes composition instead of a special-case rewrite.

### 1.4 Chapter filename composition model

Add one shared pure helper for descriptive chapter filenames.

```ts
// src/domain/normalize.ts
export function normalizeDescriptiveSlug(input: string | undefined): string;
export function descriptiveChapterOutputFilename(chapterId: string, heading?: string): string;
```

Contract:
- chapter identifier uses existing chapter-safe normalization rules
- normalized heading slug follows the issue #20 descriptive slug contract:
  - trim Unicode whitespace
  - lowercase ASCII letters
  - strip quotes/apostrophes
  - replace each maximal run of remaining non-ASCII-alphanumeric characters with `-`
  - collapse repeated hyphens
  - trim edge hyphens
  - omit suffix when normalization yields empty
- output is:
  - `chapter-{safe-id}-{slug}.md` when slug is non-empty
  - `chapter-{safe-id}.md` otherwise

Normative examples that must remain unit-locked:
- `047` + `Fraud and False Statements` → `chapter-047-fraud-and-false-statements.md`
- `IV` + `Program Administration` → `chapter-iv-program-administration.md`
- `12` + `"Emergency" Powers` → `chapter-012-emergency-powers.md`
- `A / B` + `General Provisions & Definitions` → `chapter-a-b-general-provisions-definitions.md`

### 1.5 Filesystem output model

#### Numeric title targets

```text
{outputRoot}/uscode/title-{NN}/
```

Examples:
- `title-01/`
- `title-54/`

#### Appendix title targets

```text
{outputRoot}/uscode/title-{NNa}-appendix/
```

Examples:
- `title-05a-appendix/`
- `title-11a-appendix/`
- `title-50a-appendix/`

#### Chapter mode contents

Within either numeric or appendix directories:
- `_title.md` — unchanged filename
- `chapter-*.md` — descriptive filenames for categorized chapter buckets
- `_uncategorized.md` — unchanged filename, only when needed

### 1.6 Cache/fixture model

Appendix targets must reuse the existing OLRC cache/fixture system.

Required fixture/env contract extension:

```text
US_CODE_TOOLS_TITLE_01_FIXTURE_ZIP
US_CODE_TOOLS_TITLE_54_FIXTURE_ZIP
US_CODE_TOOLS_TITLE_05A_FIXTURE_ZIP
US_CODE_TOOLS_TITLE_11A_FIXTURE_ZIP
...
```

Required manifest/cache resolution behavior:
- numeric titles continue using the current manifest/state model
- appendix titles resolve through the same manifest/cache directory tree and ZIP extraction logic
- appendix artifacts must be matched against the actual cached XML stems already present in the corpus (`usc05A.xml`, `usc11a.xml`, etc.)
- no appendix-only downloader, no second manifest tree, and no appendix-only fetch command

### 1.7 Invariants and constraints

Because there is no SQL layer, correctness must be enforced in pure code and tests:
- every supported selector maps to exactly one canonical internal target
- every canonical target maps to exactly one output directory segment
- descriptive chapter filenames always match `^chapter-[a-z0-9-]+\.md$`
- `_title.md` and `_uncategorized.md` never rename
- a filename collision in chapter mode fails before chapter writes begin
- `--all` includes all successful numeric titles plus all five appendix titles, while preserving title `53` as reserved-empty

---

## 2. API contract

This repo has no HTTP API. The external contract is the CLI interface plus the JSON report written to stdout.

### 2.1 CLI grammar

#### Single target

```bash
us-code-tools transform --title <selector> --output <dir> [--group-by chapter]
```

Where `<selector>` is either:
- numeric title `1`..`54`
- appendix selector `5A`, `11A`, `18A`, `28A`, `50A` (case-insensitive)

#### Full corpus

```bash
us-code-tools transform --all --output <dir> [--group-by chapter]
```

### 2.2 Validation rules

Argument validation must occur before any write.

| Flag / state | Rule | Failure behavior |
|---|---|---|
| `--title` | allowed once | duplicate fails parsing |
| `--all` | allowed once | duplicate fails parsing |
| `--title` + `--all` | mutually exclusive | fail parsing |
| `--output` | required once | missing/duplicate fails parsing |
| `--group-by` | optional | if present, must currently be `chapter` |
| appendix-like invalid values | `0A`, `6A`, `5AA`, `appendix`, empty | fail parsing with accepted appendix selectors named |
| numeric invalid values | `<1`, `>54`, non-integer | fail parsing |

Recommended usage string:

```text
Usage: transform (--title <selector> | --all) --output <dir> [--group-by chapter]
Accepted appendix selectors: 5A, 11A, 18A, 28A, 50A
```

### 2.3 Exit semantics

#### Single selector success
- exit `0` when target produced writable output under existing semantics
- title `53` remains non-successful and follows current reserved-empty behavior

#### `--all` success
- exit `0` when all writable titles/appendices complete and title `53` is reported via reserved-empty diagnostics rather than being silently skipped
- appendix targets are part of success accounting

#### Failure
- parse/usage errors return `1`
- duplicate chapter filename collisions return `1`
- output write failures return `1`
- unsupported selector values return `1`

### 2.4 Stdout JSON contract

#### Single target example

```json
{
  "title": "5A",
  "source_url": "https://uscode.house.gov/.../xml_usc05A@118-200.zip",
  "sections_found": 123,
  "files_written": 7,
  "parse_errors": [],
  "warnings": []
}
```

#### `--all` example

```json
{
  "requested_scope": "all",
  "targets": [
    {
      "title": "1",
      "source_url": "https://uscode.house.gov/.../xml_usc01@118-200.zip",
      "sections_found": 53,
      "files_written": 14,
      "parse_errors": [],
      "warnings": []
    },
    {
      "title": "5A",
      "source_url": "https://uscode.house.gov/.../xml_usc05A@118-200.zip",
      "sections_found": 101,
      "files_written": 9,
      "parse_errors": [],
      "warnings": []
    },
    {
      "title": "53",
      "source_url": "https://uscode.house.gov/.../xml_usc53@118-200.zip",
      "sections_found": 0,
      "files_written": 0,
      "parse_errors": [
        {
          "code": "INVALID_XML",
          "message": "No writable sections found for title 53"
        }
      ],
      "warnings": []
    }
  ]
}
```

Exact JSON field names can stay aligned with the current report style, but the architecture requires:
- stable per-target reports
- canonical title/report identifiers for appendices
- aggregated reporting for `--all`
- no silent omission of supported appendix selectors

### 2.5 Auth, pagination, and rate limits

Not applicable. This is a local CLI, not a network API.

---

## 3. Service boundaries

### 3.1 Single-process module boundary

Keep the implementation inside the existing Node.js CLI. No service split is justified because:
- transform remains synchronous and local
- appendix support is a selector-resolution concern, not a scaling concern
- `--all` is an in-process loop over the same existing transform pipeline
- there is no independent deployment cadence or resource isolation need

### 3.2 Module ownership

#### `src/index.ts`
Owns:
- CLI parsing
- normalization of `--title` vs `--all`
- output directory validation
- orchestration of one-target or many-target transforms
- stdout report assembly
- top-level exit semantics

Required changes:
- replace integer-only `parseTransformArgs()` with selector-aware parsing
- add `--all`
- reject duplicate `--title`, duplicate `--all`, and mixed `--title` + `--all`
- iterate over canonical targets for `--all`
- preserve current reserved-empty title `53` semantics in aggregated results

#### `src/domain/normalize.ts`
Owns:
- descriptive slug normalization
- descriptive chapter filename composition
- selector normalization
- selector-to-directory/cache/report derivation
- chapter ordering helpers where needed

Required changes:
- add one pure selector normalization boundary
- add one pure descriptive chapter filename helper
- keep all path-related logic centralized here rather than scattering it across CLI, OLRC source, and writer modules

#### `src/domain/model.ts`
Owns:
- shared type definitions for report shapes and mode/selector types

Required changes:
- add selector-aware transform target/report types
- keep `TransformGroupBy` unchanged except for reuse in aggregated runs

#### `src/sources/olrc.ts`
Owns:
- cached artifact lookup
- fixture ZIP lookup
- ZIP/XML extraction
- source URL derivation for reports/network fetches
- reserved-empty title handling

Required changes:
- generalize numeric-only title helpers to accept canonical selector metadata
- resolve appendix artifacts from the existing cache/fixture path model
- preserve current fetch/extraction behavior for numeric titles
- preserve title `53` reserved-empty classification only for numeric 53

#### `src/transforms/write-output.ts`
Owns:
- output directory path materialization
- chapter file collision detection before writes
- write execution and write-failure reporting

Required changes:
- derive directory names from canonical selector metadata, not from raw numeric title number only
- use descriptive chapter filenames for categorized chapter buckets
- keep `_title.md` and `_uncategorized.md` filenames fixed
- ensure collision detection keys on the final descriptive filename

#### `src/transforms/markdown.ts`
Owns:
- title/chapter/uncategorized/section markdown rendering
- embedded section content composition

Required changes:
- no new rendering mode beyond allowing link targets and chapter frontmatter context to align with renamed chapter files
- chapter frontmatter remains the source of heading data already emitted by the transform
- section bodies must remain canonically rendered through `renderSectionMarkdown()` composition

### 3.3 Dependency direction

```text
index.ts
  -> domain/normalize.ts
  -> sources/olrc.ts
  -> transforms/uslm-to-ir.ts
  -> transforms/write-output.ts
       -> transforms/markdown.ts
       -> domain/model.ts
       -> domain/normalize.ts
       -> utils/fs.ts
```

Rules:
- `domain/*` remains pure and filesystem-free
- `markdown.ts` must not own path derivation logic
- `write-output.ts` consumes canonical target metadata rather than re-normalizing raw selectors itself
- `index.ts` must orchestrate `--all`; OLRC and writer layers should stay target-at-a-time and reusable

### 3.4 Communication pattern

Pure in-process function calls only. No queues, events, workers, sockets, or subprocess fan-out.

---

## 4. Infrastructure requirements

### 4.1 Runtime requirements

For this project, “production” is a local or CI Node.js execution environment.

Required runtime:
- Node.js 22+
- local writable filesystem
- existing OLRC cache/fixture artifacts
- no additional services

### 4.2 Storage requirements

- **Primary storage:** local filesystem
- **Cache storage:** existing OLRC ZIP/XML cache directories and manifest files
- **Output storage:** `{outputRoot}/uscode/...`
- **No database**
- **No object storage**
- **No Redis / queue / broker**

### 4.3 Network requirements

Transform execution must not introduce new network calls beyond existing OLRC source handling.

Appendix support must reuse:
- existing cached ZIP artifacts
- existing fixture ZIP environment variables
- existing XML extraction path

It must **not** require:
- a second appendix listing source
- a new appendix-only fetch workflow
- a new remote endpoint

### 4.4 Monitoring and logging

Current stderr/stdout conventions are sufficient.

Operational signals:
- stdout JSON report for successful transform summaries
- stderr for usage and fatal command errors
- parse error/warning lists for machine-readable diagnostics

### 4.5 Development and testing requirements

Required local commands:

```bash
npm install
npm run build
npm test
```

Required test coverage additions:
- selector normalization unit tests
- descriptive chapter filename unit tests
- CLI parse tests for `--title 5A`, `--title 5a`, invalid appendix-like values, duplicate flags, and `--all`
- OLRC fixture/cache resolution tests for appendix titles
- chapter-mode integration coverage for appendix targets
- full-corpus `--all --group-by chapter` coverage including title `53`

### 4.6 CI requirements

No new containers, services, or secrets are needed.

CI gates remain:
- TypeScript build
- Vitest suite

### 4.7 Rollback plan

Rollback is a normal git revert of:
- selector-aware CLI parsing
- appendix cache resolution support
- descriptive chapter filename composition
- aggregated `--all` reporting

No migration rollback or data cleanup is needed.

---

## 5. Dependency decisions

No new dependencies should be added for this issue.

| Dependency | Version in repo | Use in this issue | Why this choice | License | Maintenance status |
|---|---:|---|---|---|---|
| `typescript` | `^5.8.0` | implement selector and path types safely | already the repo standard; no extra parser/runtime package needed | Apache-2.0 | actively maintained |
| `vitest` | `^3.0.0` | unit + integration regression coverage | already used; good fit for pure helper and CLI integration tests | MIT | actively maintained |
| `gray-matter` | `^4.0.3` | existing markdown/frontmatter generation | already integrated; no need for frontmatter rewrite | MIT | mature/stable |
| `fast-xml-parser` | `^4.5.0` | unchanged XML parsing path | appendix support does not require parser replacement | MIT | actively maintained |
| `yauzl` | `^3.1.0` | unchanged ZIP extraction path | already handles existing OLRC ZIP access; appendices are just new selector targets | MIT | mature/stable |
| `@types/node` | `^22.0.0` | filesystem/process typings | already required by repo | MIT | maintained |

### 5.1 Explicit non-decisions

- **No CLI parser library** (`commander`, `yargs`, etc.)
  - current argument surface is still small enough for the existing custom parser
  - adding a dependency just to support `--all` and appendix selectors would be unnecessary churn
- **No slugify dependency**
  - the slug contract is explicitly spec-defined and should remain under local control in `src/domain/normalize.ts`
- **No new cache database/index**
  - the existing manifest + filesystem model is sufficient

---

## 6. Integration points

### 6.1 Existing integrations reused

#### CLI → OLRC cache
`src/index.ts` → `src/sources/olrc.ts`
- currently numeric only
- must become selector-aware without changing the basic cache/extract contract

#### OLRC ZIP → XML parse
`src/sources/olrc.ts` → `src/transforms/uslm-to-ir.ts`
- unchanged parser boundary
- appendix targets must flow through the exact same parse step as numeric titles

#### IR → markdown writer
`src/transforms/uslm-to-ir.ts` → `src/transforms/write-output.ts`
- unchanged title/chapter/section IR model
- chapter filename derivation becomes heading-aware
- output directory derivation becomes selector-aware

#### Section renderer reuse
`src/transforms/markdown.ts`
- chapter output must continue to embed canonical section markdown
- cross-reference path updates must resolve to files that exist in the renamed target tree

### 6.2 New integration boundaries introduced by this issue

#### Selector normalization boundary
A single pure function or helper cluster must derive, from raw CLI input:
- canonical selector identity
- report identifier
- cache lookup key
- output directory segment
- source URL identifier

This removes duplicated numeric-vs-appendix branching across modules.

#### Descriptive chapter filename boundary
A single pure helper must derive the final chapter filename from:
- raw chapter identifier
- chapter heading from frontmatter/IR metadata

This helper is shared by:
- `write-output.ts`
- unit tests
- cross-reference/link rewriting logic where file-name lookup is required

### 6.3 Data flow

#### Single target

```text
CLI args
  -> parseTransformArgs()
  -> normalize selector
  -> validate output root
  -> resolve cached ZIP / fixture ZIP
  -> extract XML entries
  -> parseUslmToIr()
  -> merge TitleIR + sections + chapters
  -> writeTitleOutput(targetMetadata, groupBy)
       -> renderTitleMarkdown()
       -> descriptive chapter filename helper
       -> renderChapterMarkdown()
       -> optional _uncategorized.md
  -> emit per-target JSON report
```

#### `--all`

```text
CLI args
  -> parseTransformArgs()
  -> expand canonical target list:
       numeric 1..54
       appendix 5A, 11A, 18A, 28A, 50A
  -> for each target in stable order:
       resolve ZIP
       parse IR
       write output
       collect per-target report
  -> emit aggregated report
  -> overall exit code reflects aggregate success while preserving title 53 reserved-empty diagnostics
```

Stable ordering for `--all`:
1. numeric titles `1..54`
2. appendix titles in canonical numeric order: `5A`, `11A`, `18A`, `28A`, `50A`

This keeps output deterministic and testable.

### 6.4 Cross-reference resolution

The spec explicitly requires relative cross-reference links inside embedded section markdown to resolve to the renamed descriptive chapter filenames.

Architectural requirement:
- any chapter-mode link rewriting must key on the same canonical chapter filename helper used during actual file writes
- there must be no duplicate ad hoc slug logic in renderer code
- link-target lookup should be precomputed per title target before chapter writes begin, so collisions can be caught before writes and links can be rendered against the final stable filename map

### 6.5 External systems

No new external systems are added.

---

## 7. Security considerations

### 7.1 Path safety

Main risk: appendix selectors and chapter headings influence output paths.

Controls:
- raw CLI selectors are normalized through a strict allowlist boundary before they can influence cache lookup or output directory names
- raw chapter headings never become filenames directly
- final output paths still pass `assertSafeOutputPath()` before writing
- `_title.md` and `_uncategorized.md` remain constants

This blocks:
- path traversal via malformed selectors
- unsafe punctuation or Unicode path injection from chapter headings
- accidental divergence between directory derivation and path safety enforcement

### 7.2 Input validation

Controls:
- reject unsupported appendix-like values before output validation/writes
- reject duplicate `--title`, duplicate `--all`, and mixed `--title` + `--all`
- enforce canonical appendix allowlist: `5A`, `11A`, `18A`, `28A`, `50A`
- preserve numeric bound checks for `1..54`

### 7.3 Determinism as a security and operability property

Deterministic output matters because it:
- makes output diffs auditable
- prevents flaky link-target rewrites
- reduces risk of inconsistent artifact trees across repeated runs

Required controls:
- one canonical selector normalizer
- one canonical chapter filename helper
- stable `--all` target ordering
- stable chapter bucket ordering
- stable collision detection keyed on final filenames

### 7.4 Collision handling

Risk: two distinct `(chapter id, heading)` pairs normalize to the same descriptive filename.

Required control:
- detect collisions against the final descriptive filename before any chapter file write begins
- report as `OUTPUT_WRITE_FAILED`
- include the colliding filename in the error message
- return non-zero

### 7.5 Integrity of rendered links

Risk: section markdown bodies continue to render, but internal relative links now point at nonexistent pre-rename chapter filenames.

Required control:
- link rewriting in chapter mode must use the same filename map used for actual writes
- integration tests must verify that emitted relative links resolve to files that exist in the output tree

### 7.6 Sensitive data handling

No new credentials, secrets, or PII are introduced.

### 7.7 Network attack surface

Appendix support must not expand network scope. It must reuse existing OLRC fetch/cache behavior only.

### 7.8 Auth, CORS, encryption in transit

Not applicable. No HTTP service is being introduced.

---

## 8. Concrete implementation plan

### 8.1 `src/domain/normalize.ts`
1. Add `normalizeDescriptiveSlug()` implementing the issue #20 slug contract.
2. Add `descriptiveChapterOutputFilename(chapterId, heading?)`.
3. Add selector normalization helpers for numeric vs appendix targets.
4. Add helper(s) to derive output directory names and cache/source keys from canonical selector metadata.
5. Keep all selector/slug logic pure and unit-testable.

### 8.2 `src/index.ts`
1. Replace integer-only transform arg parsing with selector-aware parsing.
2. Add `--all` with mutual exclusion against `--title`.
3. Expand a stable canonical target list for `--all`.
4. Execute target transforms serially to preserve deterministic output/report order and avoid unnecessary filesystem/cache contention.
5. Emit per-target or aggregated reports while preserving reserved-empty title `53` behavior.

### 8.3 `src/sources/olrc.ts`
1. Generalize numeric-only helper signatures so they accept canonical selector metadata.
2. Support appendix fixture env vars and cached artifact lookup.
3. Resolve appendix source URLs and cached ZIP names consistently with the selector metadata.
4. Keep reserved-empty logic scoped to numeric title `53` only.

### 8.4 `src/transforms/write-output.ts`
1. Accept canonical target metadata instead of deriving output directory names from `titleIr.titleNumber` alone.
2. Build a chapter filename map using descriptive filenames and heading metadata.
3. Reject filename collisions before any chapter-file write.
4. Keep `_title.md` and `_uncategorized.md` unchanged.
5. Reuse the same filename map for link-target resolution where needed.

### 8.5 `src/transforms/markdown.ts`
1. Preserve canonical section rendering via `renderSectionMarkdown()` composition.
2. Update chapter-mode rendering plumbing only as needed to support correct link targets and unchanged frontmatter/body semantics.
3. Keep chapter frontmatter `heading` as the source for descriptive chapter names.

### 8.6 Tests

#### Unit
- descriptive chapter filename examples
- empty-heading fallback
- selector normalization success/failure cases
- output directory derivation for numeric and appendix targets

#### Integration
- `transform --title 5A --group-by chapter`
- case-insensitive `--title 5a`
- invalid appendix-like selectors fail before writes
- descriptive chapter filenames in numeric and appendix outputs
- `--all --group-by chapter` across `1..52`, `54`, and five appendices, with title `53` reserved-empty reporting preserved
- repeated-run determinism

---

## 9. Acceptance mapping

| Spec requirement | Architectural decision |
|---|---|
| Descriptive chapter filenames use issue #20 slug rules | single pure descriptive chapter filename helper in `src/domain/normalize.ts` |
| `_title.md` and `_uncategorized.md` unchanged | keep constant filenames in writer layer |
| `--title 5A` accepted case-insensitively | pure selector normalization boundary with appendix allowlist |
| `--all` transforms all numeric + appendix targets | `index.ts` expands stable canonical target list and serially executes target transforms |
| Appendix outputs land under `title-05a-appendix/` etc. | canonical selector metadata derives output directory segment |
| Cached appendix artifacts resolved without new flow | `src/sources/olrc.ts` generalized from numeric-only lookup to selector-aware lookup |
| Cross-reference links resolve after rename | renderer/writer share one canonical chapter filename map |
| All 53 titles + 5 appendices covered | aggregated `--all` reporting and corpus-wide integration matrix |
| Title 53 remains reserved-empty | reserved-empty logic stays numeric-title specific and is preserved in aggregate reports |

---

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Appendix selectors handled inconsistently across CLI, cache, and writer layers | High | centralize selector normalization and metadata derivation in `src/domain/normalize.ts` |
| Duplicate slug logic causes link/file mismatches | High | one canonical descriptive chapter filename helper reused everywhere |
| Collision detection happens after partial writes | High | precompute final chapter filename map before first chapter write |
| `--all` silently skips appendices or title `53` | High | explicit canonical target expansion plus aggregate report assertions |
| Existing numeric-title behavior regresses | High | additive target metadata layer with current numeric path retained through tests |
| Appendix cache lookup introduces new fetch path | Medium | reuse existing OLRC ZIP/cache/fixture resolution only |
| Non-deterministic aggregate ordering | Medium | fixed numeric-then-appendix target order |

---

## 11. Decision summary

1. **Keep this as a single-process CLI enhancement.** No new service boundary is warranted.
2. **Model titles through a canonical selector metadata layer.** That is the core architectural change needed to make appendix support correct and testable.
3. **Use one pure descriptive chapter filename helper.** It must be the only source of truth for chapter filenames and link targets.
4. **Serialize `--all` target execution.** This keeps output deterministic and avoids needless complexity.
5. **Preserve the existing cache/fetch model.** Appendix support is an extension of target selection, not a new acquisition subsystem.
6. **Treat title `53` as a first-class reported exception, not a skipped target.** That preserves existing business semantics while allowing `--all` to be complete and auditable.
