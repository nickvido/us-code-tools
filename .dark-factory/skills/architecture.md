# Architecture

## Current System
- Single-package Node.js CLI transformer for OLRC USLM XML → markdown.
- Runtime contract lives in `src/index.ts` via `main(argv?: string[]): Promise<number>`.
- No database, HTTP API, queue, or background worker in this phase.
- Core data flow:
  1. CLI validates `transform --title <number> --output <dir>`
  2. `src/sources/olrc.ts` resolves/downloads/caches the title ZIP
  3. `extractXmlEntriesFromZip()` enumerates accepted `.xml` entries in lexical order
  4. `src/transforms/uslm-to-ir.ts` parses XML into `TitleIR`
  5. `src/transforms/markdown.ts` renders markdown strings
  6. `src/transforms/write-output.ts` writes `_title.md` + per-section files atomically

## Codebase Map
- `src/index.ts` — CLI entrypoint, arg validation, report printing, exit code policy.
- `src/domain/model.ts` — IR contracts: `TitleIR`, `SectionIR`, `ContentNode`, `ParseError`, `XmlEntry`.
- `src/domain/normalize.ts` — shared normalization helpers (`asArray`, whitespace normalization, title padding, section filename safety).
- `src/sources/olrc.ts` — OLRC URL resolution, cache validation, ZIP download, retry/timeout behavior, XML extraction hardening.
- `src/transforms/uslm-to-ir.ts` — XML parser and section/chapter/title extraction.
- `src/transforms/markdown.ts` — section/title markdown + gray-matter frontmatter rendering.
- `src/transforms/write-output.ts` — deterministic output path derivation and writes.
- `src/utils/fs.ts` — atomic file writes + output-root/symlink safety checks.
- `src/types/yauzl.d.ts` — local type augmentation for `yauzl` entry metadata used by hardening logic.

## Data Model
- `TitleIR` in `src/domain/model.ts`
  - `titleNumber: number`
  - `heading: string`
  - `positiveLaw: boolean | null`
  - `chapters: ChapterIR[]`
  - `sections: SectionIR[]`
  - `sourceUrlTemplate: string`
- `SectionIR` in `src/domain/model.ts`
  - preserves `sectionNumber` as `string`
  - metadata fields: `heading`, `status`, `source`, `enacted`, `publicLaw`, `lastAmended`, `lastAmendedBy`
  - note separation: `sourceCredits?: string[]`, `editorialNotes?: NoteIR[]`
  - body tree: `content: ContentNode[]`
- `ContentNode` shape covers `subsection`, `paragraph`, `subparagraph`, `clause`, `item`, and text blocks.

## Parsing / Rendering Patterns
- `parseUslmToIr(xml, xmlPath?)` returns `{ titleIr, parseErrors }` instead of throwing for section-local problems.
- Parser collects `<section>` from both title-level and chapter-level locations with `collectSectionNodes()`.
- Parser uses explicit `fast-xml-parser` safety settings and a 1 MiB normalized-field cap (`MAX_NORMALIZED_FIELD_LENGTH`).
- Oversize or malformed section-local structures become bounded `ParseError`s and are skipped.
- Source-credit notes are stored separately from `editorialNotes`.
- Markdown renderer uses `gray-matter` for parseable YAML frontmatter.
- Section body formatting is depth-driven by node type, not by source indentation.
- Current merge behavior in `src/index.ts` still appends `result.titleIr.sections` across XML entries without `sectionNumber` de-duplication; latest adversary review requires duplicate detection and omission with an `INVALID_XML` parse error.

## Output Contract
- Section files: `uscode/title-{NN}/section-{sectionId}.md`
- Title metadata file: `uscode/title-{NN}/_title.md`
- File normalization is intentionally minimal: `sectionFileSafeId()` only replaces `/` → `-`.
- `files_written` includes `_title.md`.
- Current gap: `writeTitleOutput()` catches section write failures, but `_title.md` is still written outside a local error boundary. If the title metadata write fails after some section writes, `src/index.ts` falls into the top-level catch and loses structured JSON report emission; latest adversary review requires `_title.md` failures to be converted into `OUTPUT_WRITE_FAILED` parse errors and preserved in the final report.

## Security-Relevant Architecture Notes
- ZIP intake is hardened in `src/sources/olrc.ts`:
  - rejects non-regular entries
  - rejects unsafe/aliased normalized paths
  - enforces 64 MiB per-entry and 256 MiB total XML extraction caps
  - retries transient download failures exactly once with 30s timeout
- Output path safety is enforced in `src/utils/fs.ts`:
  - resolved target must stay under output root
  - symlinked intermediate directories are rejected
  - writes are atomic via temp file + rename

## Phase 1 Scope (Current)
- What's implemented:
  - one-command CLI transform flow
  - single-title OLRC ZIP resolution/download/cache
  - USLM XML → IR parsing for title/chapter/section hierarchy
  - markdown generation with YAML frontmatter
  - deterministic file emission
  - unit, snapshot, adversary-regression, and fixture-backed integration tests
- What's intentionally deferred:
  - multi-title orchestration
  - GovInfo / Congress.gov / VoteView ingestion
  - git commit / PR creation
  - diffing snapshots or historical backfill workflows
  - database persistence and HTTP API surface
- What's a test double vs production:
  - Title 1 integration uses committed fixtures / env-provided ZIP path in tests
  - live OLRC fetch path is production code; default tests stay network-free by design
