# Architecture — Issue #20: Descriptive title directory names for transform output

## Status
Approved spec input: `docs/specs/20-spec.md`

## Inputs Reviewed
- `docs/specs/20-spec.md`
- GitHub issue #20 and approved review thread
- `package.json`
- `src/domain/model.ts`
- `src/domain/normalize.ts`
- `src/transforms/write-output.ts`
- `src/transforms/markdown.ts`
- `tests/unit/transforms/write-output.test.ts`
- `tests/unit/transforms/markdown.test.ts`
- `tests/unit/issue16-chapter-mode.test.ts`
- `tests/integration/transform-cli.test.ts`
- Existing architecture documents: `docs/architecture/12-architecture.md`, `docs/architecture/16-architecture.md`

## Constraints and Operating Assumptions
- No repo-root `.dark-factory.yml` is present in this worktree. Effective constraints therefore come from the approved spec, the existing TypeScript/Vitest CLI codebase, and the already-established architecture documents in `docs/architecture/`.
- This issue remains inside the existing single-process Node.js CLI. It does **not** introduce a database, HTTP API, queue, worker, daemon, or background job.
- The production persistence model remains the generated filesystem tree under the caller-supplied output root plus the existing OLRC cache inputs. This issue changes only the **derived title directory segment** beneath `uscode/`.
- The implementation must stay deterministic and fixture-backed. No live OLRC access, no non-fixture network dependencies, and no non-deterministic slug generation rules are allowed.
- The path derivation contract must be centralized so section mode, chapter mode, `_title.md`, `_uncategorized.md`, and any cross-title relative link generation cannot drift.
- No `[security-architect]` or `[arch-reviewer]` return-to-architect comment is present on the issue at architecture time. This document therefore addresses the approved spec directly and proactively folds in the obvious XML-derived path-safety concerns.

---

## 1. Data Model

### 1.1 Architectural decision
This issue introduces **no database schema, no manifest schema, and no cache-layout change**.

That is the correct production decision because the defect is a deterministic path-derivation problem in the transform layer, not a persistence or acquisition problem. The production data model affected by this issue is therefore:
1. existing `TitleIR` heading data already parsed from XML
2. one new shared normalization contract for title-directory names
3. existing markdown output files written under a renamed parent directory
4. any relative link targets that must point into the same directory layout

### 1.2 Canonical runtime model
Owner: `src/domain/model.ts` (existing types) and `src/domain/normalize.ts` (new helper boundary)

No new fields are required in `TitleIR`; the issue deliberately reuses data that already exists:

```ts
export interface TitleIR {
  titleNumber: number;
  heading: string;
  positiveLaw: boolean | null;
  chapters: ChapterIR[];
  sections: SectionIR[];
  sourceUrlTemplate: string;
}
```

The architecture adds a pure derived model for title-directory naming:

```ts
export interface TitleDirectoryInput {
  titleNumber: number;
  heading?: string | null;
}

export interface TitleDirectoryResult {
  paddedTitleNumber: string;     // e.g. "01"
  headingSlug: string | null;    // e.g. "general-provisions"
  directoryName: string;         // e.g. "title-01-general-provisions" or "title-01"
}
```

This may remain internal and unexported if the implementation prefers a smaller surface, but the behavior must be representable by one shared pure helper.

### 1.3 Canonical slug normalization contract
Owner: `src/domain/normalize.ts`

Add exactly one production helper family for title directory derivation:

```ts
export function slugifyTitleHeading(heading: string | undefined | null): string | null;
export function titleDirectoryName(input: TitleDirectoryInput): string;
```

Required behavior:
1. Start from `normalizeWhitespace(heading)`.
2. Lowercase the result.
3. Strip apostrophes and quote characters entirely rather than converting them into separators.
   - Must include straight apostrophe `'`
   - Must include straight quote `"`
   - Must include curly apostrophes/quotes such as `’`, `‘`, `“`, `”`
4. Replace every maximal run of other non-alphanumeric characters with a single hyphen.
5. Collapse repeated hyphens.
6. Trim leading/trailing hyphens.
7. If the slug is empty after normalization, treat it as missing.
8. Directory result is:
   - `title-{NN}-{slug}` when slug is non-empty
   - `title-{NN}` when slug is empty/missing

Examples that must be mechanically tested:

```ts
slugifyTitleHeading('General Provisions')
// => 'general-provisions'

slugifyTitleHeading('Crimes and Criminal Procedure')
// => 'crimes-and-criminal-procedure'

slugifyTitleHeading('The Public Health and Welfare')
// => 'the-public-health-and-welfare'

slugifyTitleHeading('"Patriotic Societies and Observances"')
// => 'patriotic-societies-and-observances'

slugifyTitleHeading("  '  ")
// => null

titleDirectoryName({ titleNumber: 4, heading: '' })
// => 'title-04'
```

### 1.4 Filesystem output contract
The persisted output tree changes only at the title-directory segment.

#### Previous layout
```text
<output>/
└── uscode/
    └── title-18/
        ├── _title.md
        └── section-00001.md
```

#### New layout when heading slug exists
```text
<output>/
└── uscode/
    └── title-18-crimes-and-criminal-procedure/
        ├── _title.md
        └── section-00001.md
```

#### Fallback layout when heading is missing/empty after normalization
```text
<output>/
└── uscode/
    └── title-04/
        ├── _title.md
        └── section-00001.md
```

Rules:
- Section filenames remain `section-${sectionFileSafeId(sectionNumber)}.md`.
- Chapter filenames remain `chapter-${chapterFileSafeId(chapter)}.md`.
- Only the parent title-directory segment changes.
- `_title.md` must live under the exact same derived title directory as all sibling outputs for that title.
- In chapter mode, `_uncategorized.md` must live under that exact same title directory as well.

### 1.5 Cross-title link target model
Owner: `src/transforms/markdown.ts` and/or shared path helpers used by markdown rendering

This issue hardens a broader invariant:

```ts
export function sectionFilePath(titleNumber: number, sectionId: string, titleHeading?: string | null): string;
export function titleOutputDirectory(titleNumber: number, titleHeading?: string | null): string;
```

Any current or future production path that needs to point at another title’s section file must route through the **same** title-directory helper used by `write-output.ts`.

That means the canonical relative-link target is derived from:
1. `titleDirectoryName({ titleNumber, heading })`
2. existing section filename helpers
3. `path.relative(...)` or equivalent safe relative-link calculation

No code path may hard-code `title-${padTitleNumber(titleNumber)}` once this issue lands.

### 1.6 Persistence / migration impact
No SQL migrations, manifest migrations, or cache migrations are required.

Operationally, this is a **generated-output layout migration** only:
- rerunning the transform against a clean output root yields the new slugged directory names
- rerunning the transform against an already-populated output root may leave old `title-{NN}` directories beside new ones if the caller does not clean the root first
- this architecture intentionally does **not** add cleanup or rename-in-place behavior; callers remain responsible for target-directory hygiene, consistent with current transform behavior

### 1.7 Seed data / fixture impact
The committed fixture suite is the seed-equivalent dataset for this issue.

Required fixture/test updates:
- Unit tests for `slugifyTitleHeading()` and `titleDirectoryName()`.
- `tests/unit/transforms/write-output.test.ts` updated to assert `title-01-general-provisions` instead of `title-01` when a heading exists.
- `tests/unit/issue16-chapter-mode.test.ts` updated or extended to assert chapter-mode outputs live under the same slugged title directory.
- `tests/unit/transforms/markdown.test.ts` updated or extended to cover cross-title path generation through the shared helper.
- `tests/integration/transform-cli.test.ts` updated to assert slugged directories for successful titles `1..52` and `54`, with `53` retaining its reserved-empty behavior.

### 1.8 Equivalent index / invariant strategy
There are no database indexes in scope.

The equivalent production invariants that replace relational constraints are:
1. **Single source of truth:** exactly one helper family generates title-directory names.
2. **Directory consistency:** all files for a given title and mode share the same parent title directory.
3. **Filesystem safety:** derived directory names contain only lowercase ASCII letters, digits, and hyphens beyond the `title-{NN}` prefix.
4. **Fallback safety:** missing/empty headings always map to exactly `title-{NN}` with no trailing hyphen.
5. **Determinism:** same input title number + heading always yields the same directory segment.

---

## 2. Interface Contract

This repository exposes a CLI and pure transform/render helpers, not an HTTP API. Therefore **no OpenAPI surface is introduced** for this issue.

The external contract in scope is the existing transform CLI plus the generated output tree shape.

### 2.1 CLI command contract
Command remains unchanged:

```bash
us-code-tools transform --title <number> --output <dir> [--group-by chapter]
```

No new flags are added.

Behavioral changes:
- default section mode now writes under `out/uscode/title-{NN}-{slug}/` when heading data exists
- chapter mode now writes under the same `out/uscode/title-{NN}-{slug}/`
- fallback remains `out/uscode/title-{NN}/` when heading is missing or normalizes to empty

### 2.2 Observable success contract
#### Section mode
Successful output for Title 1 current-format fixture:

```text
out/uscode/title-01-general-provisions/
  _title.md
  section-00001.md
  section-00002.md
  ...
```

#### Chapter mode
Successful output for a chapter-grouped title:

```text
out/uscode/title-42-the-public-health-and-welfare/
  _title.md
  chapter-001.md
  chapter-iv.md
  _uncategorized.md   # only when needed
```

### 2.3 Error and fallback semantics
No new CLI exit codes are introduced.

Required behavior:
- Missing/empty headings are **not** errors.
- Punctuation-only headings that normalize to empty are **not** errors.
- Title 53 reserved-empty behavior remains unchanged.
- Any filesystem write failure still reports `OUTPUT_WRITE_FAILED` via the existing report/failure path.

### 2.4 Determinism contract
For the same fixture corpus and clean output root:
- directory names are byte-for-byte identical across repeated runs
- generated markdown content remains byte-for-byte identical except for any relative-link path segments intentionally changed by the new directory naming contract
- no timestamp, randomness, locale dependence, or host-dependent slug behavior is allowed

### 2.5 Relative-link contract
If a production renderer emits a filesystem-relative markdown link to another title’s section file, the href must resolve through the same helper used by output writes.

Required examples:
- target heading present: `../title-18-crimes-and-criminal-procedure/section-00001.md`
- target heading missing: `../title-04/section-00001.md`

If current rendering coverage is still partial, the implementation must nonetheless centralize the path helper now and add a targeted contract test so future link rendering cannot drift back to `title-{NN}` hard-coding.

---

## 3. Service Boundaries

### 3.1 Monolith / module decision
Remain a single-process CLI monolith. No service split.

Rationale:
- The change is a pure transform/output concern.
- There is no asynchronous workload, no independent scaling dimension, and no cross-process communication need.
- Splitting slug normalization into a service would be unjustified architecture inflation.

### 3.2 Module ownership

#### `src/domain/normalize.ts`
Owns:
- whitespace normalization reuse
- title-heading slugification
- title-directory derivation
- existing `padTitleNumber()` reuse
- chapter and section filename normalization (already present)

Required architectural rule:
- This module is the **only** place allowed to convert XML-derived title heading text into a filesystem-safe title directory segment.

#### `src/transforms/write-output.ts`
Owns:
- all filesystem write paths for section mode and chapter mode
- use of `assertSafeOutputPath()` and `atomicWriteFile()`
- shared title-directory helper consumption

Required architectural rule:
- No string literal of the form `` `title-${padTitleNumber(...)}` `` may remain in output path assembly once the issue is implemented, except inside the shared helper itself.

#### `src/transforms/markdown.ts`
Owns:
- markdown document rendering
- any relative-link generation needed for cross-title references
- consumption of shared title-directory and section-path helpers where links require filesystem targets

Required architectural rule:
- Renderer code may not derive title directory names independently.

#### `tests/unit/**` and `tests/integration/**`
Own:
- mechanical proof that helper behavior, writer behavior, and CLI behavior all agree on the same contract

### 3.3 Dependency direction
Required dependency flow:

```text
src/domain/normalize.ts
        ↓
src/transforms/write-output.ts   src/transforms/markdown.ts
        ↓                           ↓
        tests/unit + tests/integration
```

Rules:
- `normalize.ts` stays pure and has no filesystem dependency.
- `write-output.ts` depends on normalization helpers, not vice versa.
- `markdown.ts` depends on normalization/path helpers, not vice versa.
- Tests may verify any layer, but production code must not duplicate normalization logic in test-only wrappers.

### 3.4 Communication pattern
All communication stays in-process by direct function call. No queues, events, RPC, subprocesses, or network listeners are introduced.

---

## 4. Infrastructure Requirements

### 4.1 Production/runtime requirements
This feature runs in the repository’s existing CLI environment.

Required runtime:
- Node.js as already used by the repo
- TypeScript-compiled CLI entry under `dist/`
- local filesystem write access to the operator-supplied output root

No additional production infrastructure is required:
- no Postgres
- no Redis
- no S3
- no DNS/certificates
- no background workers
- no external secrets

### 4.2 Development requirements
- Existing npm toolchain from `package.json`
- `typescript ^5.8.0`
- `vitest ^3.0.0`
- existing test fixtures under `tests/fixtures/`

### 4.3 CI requirements
CI for this issue should continue running the existing deterministic local suite:

```bash
npm run build
npm test
```

Minimum implementation-verification expectations:
1. build passes with no type errors
2. unit tests cover helper edge cases and path consumers
3. integration tests cover default mode, chapter mode, numeric-title matrix, fallback, and deterministic rerun behavior

### 4.4 Filesystem and operator considerations
Because the output parent directory name changes, operators should treat this as a path-contract change:
- downstream consumers that hard-code `title-{NN}` directory names must be updated separately
- transforms into a non-clean output root may leave both old and new title directories side by side
- the transform should not silently delete or rename existing directories as part of this issue

### 4.5 Monitoring / logging
No new monitoring stack is required.

Implementation should preserve current diagnostic discipline:
- structured transform report to stdout
- bounded error messages only
- no logging of raw XML blobs
- if a path write fails, include the failing file hint and error class, not an unbounded dump of derived content

---

## 5. Dependency Decisions

This issue should add **no new runtime dependency**.

### 5.1 Existing dependencies retained

#### `typescript` `^5.8.0`
- **Why:** existing compiler/tooling baseline for the repo
- **License:** Apache-2.0
- **Maintenance:** actively maintained and already adopted in the project
- **Decision:** retain; no reason to introduce a slug library for a small deterministic normalization rule

#### `vitest` `^3.0.0`
- **Why:** existing unit/integration test runner; sufficient for helper and fixture coverage
- **License:** MIT
- **Maintenance:** actively maintained
- **Decision:** retain; use for mechanical regression coverage of the new naming contract

#### `gray-matter` `^4.0.3`
- **Why:** existing markdown/frontmatter serializer; unaffected by this issue
- **License:** MIT
- **Maintenance:** mature and widely used
- **Decision:** retain; no architecture change required

#### `fast-xml-parser` `^4.5.0`
- **Why:** existing parser that already provides `TitleIR.heading`; no parser-library change is needed
- **License:** MIT
- **Maintenance:** active
- **Decision:** retain; consume existing heading data instead of adding a new parser stage

### 5.2 Rejected dependency option: third-party slug library
Rejected examples: `slugify`, `speakingurl`, or similar

Reason for rejection:
- the required normalization contract is small, testable, and more specific than generic slug packages
- generic libraries can introduce locale-dependent or transliteration behavior not requested by the spec
- the project already has a natural home for pure deterministic normalization logic in `src/domain/normalize.ts`
- avoiding a new dependency reduces supply-chain and maintenance surface

---

## 6. Integration Points

### 6.1 Existing in-repo integrations

#### Parser → IR integration
`parseUslmToIr()` already populates `TitleIR.heading`.

This issue depends on that field being present and normalized only for whitespace at the slugification layer, not by changing parser behavior.

#### Output writer integration
`writeTitleOutput()` currently assembles paths for:
- section files
- chapter files
- `_uncategorized.md`
- `_title.md`

All of those path constructions must be rewritten to depend on the shared title-directory helper.

#### Markdown integration
Any current or future logic that generates relative markdown links to generated section files must consume the same helper family used by the writer.

### 6.2 Data flow
Canonical flow after implementation:

```text
XML fixture / cached XML
    ↓
parseUslmToIr()
    ↓
TitleIR { titleNumber, heading, ... }
    ↓
normalize.titleDirectoryName({ titleNumber, heading })
    ↓
write-output.ts and markdown.ts consume same derived directory name
    ↓
filesystem output + relative links agree
```

### 6.3 Test integration points
Required test coverage map:
- `tests/unit/transforms/write-output.test.ts`
  - title directory naming in section-path derivation
  - fallback behavior
- `tests/unit/issue16-chapter-mode.test.ts`
  - chapter mode uses same slugged title directory
- `tests/unit/transforms/markdown.test.ts`
  - cross-title path/link helper uses slugged target directories and fallback rules
- `tests/integration/transform-cli.test.ts`
  - default mode output tree
  - chapter mode output tree
  - numeric-title matrix safety rules
  - title 53 unchanged reserved-empty failure path
  - deterministic rerun equivalence

### 6.4 Out-of-scope integrations
This issue does **not** include:
- downstream content migration tooling
- symlink cleanup of old output trees
- updates to external consumers of the generated directory layout
- new grouping modes
- renaming section or chapter filenames

---

## 7. Security Considerations

### 7.1 Trust boundary
Primary trust boundary: XML-derived `TitleIR.heading` values flowing into filesystem paths and possibly relative markdown hrefs.

Although the source content is public legal text, it is still untrusted input for path derivation purposes. Therefore the title-heading slug helper is a **security boundary**, not just a cosmetic formatter.

### 7.2 Path-safety requirements
Required controls:
1. Only `titleDirectoryName()` may convert a title heading into a directory segment.
2. That helper must emit only lowercase ASCII letters, digits, and hyphens in the slug portion.
3. Quote characters must be stripped, not preserved.
4. Path separators, control characters, spaces, and repeated hyphens must not survive normalization.
5. Empty results must fall back to `title-{NN}` rather than emitting `title-{NN}-` or `title-{NN}--...`.
6. `write-output.ts` must continue using `assertSafeOutputPath()` on the final resolved path before any write.

### 7.3 Output-integrity requirements
- All files for a given title must land in one and only one derived title directory for a given run/mode.
- Cross-title links must target that same directory contract.
- There must be no drift where files are written under `title-18-crimes-and-criminal-procedure/` but links still point to `title-18/`.

### 7.4 Denial-of-service and resource considerations
This issue does not materially expand resource usage. The main risk is correctness drift, not resource exhaustion.

Still-required implementation discipline:
- keep slug generation pure and linear in input length
- avoid repeated recomputation in tight loops when a precomputed title directory can be reused per title
- preserve existing fixture-backed tests instead of introducing live corpus fetches

### 7.5 Sensitive-data handling
No PII, credentials, or new secrets are introduced.

Data classes for this issue:
- **Public:** title headings, generated markdown paths, fixture content
- **Internal:** local filesystem roots, test logs, parse/write diagnostics
- **Secrets:** none introduced by this issue

### 7.6 Logging and error handling
- Do not log raw XML documents or arbitrary unsanitized heading strings in bulk.
- If normalization or writing fails, emit a bounded structured diagnostic tied to the failing title/file path.
- Do not silently fall back from a slugged path to a different directory because of a write error; preserve the existing `OUTPUT_WRITE_FAILED` path.

### 7.7 Compliance / auth / CORS
Not applicable for this feature:
- no auth model is added
- no user roles or sessions exist
- no HTTP API exists
- no CORS policy exists
- no regulated personal data is introduced

---

## Implementation Plan Summary

1. Add `slugifyTitleHeading()` and `titleDirectoryName()` to `src/domain/normalize.ts`.
2. Add a shared title-output path helper in `src/transforms/write-output.ts` or a nearby shared module that composes `titleDirectoryName()` with existing section/chapter filename helpers.
3. Replace all hard-coded `title-${padTitleNumber(...)}` path segments in section mode, chapter mode, `_uncategorized.md`, and `_title.md` writes.
4. Update any cross-title path/link rendering to consume the same title-directory helper.
5. Add/extend unit tests for slug mechanics, fallback behavior, and shared helper usage.
6. Update integration tests to assert slugged directories across normal fixtures and numeric-title matrix coverage.
7. Verify deterministic repeated-run output.

## Acceptance Mapping

- **Shared helper:** `slugifyTitleHeading()` + `titleDirectoryName()` centralized in `src/domain/normalize.ts`
- **Default section output:** section paths and `_title.md` consume the same helper
- **Chapter mode:** chapter files, `_uncategorized.md`, and `_title.md` consume the same helper
- **All 53 successful titles safe:** integration matrix asserts clean slugged basenames for titles `1..52` and `54`
- **Cross-title links correct:** markdown/path helper tests assert slugged target directories and fallback-only behavior

## Recommended Verification Commands

```bash
npm run build
npm test
```

For focused implementation work, these suites should be green at minimum:

```bash
npx vitest run tests/unit/transforms/write-output.test.ts
npx vitest run tests/unit/transforms/markdown.test.ts
npx vitest run tests/unit/issue16-chapter-mode.test.ts
npx vitest run tests/integration/transform-cli.test.ts
```
