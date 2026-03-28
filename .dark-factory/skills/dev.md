# Dev Notes

## Build / Run / Test
- Install: `npm install`
- Typecheck: `npx tsc --noEmit`
- Build CLI: `npm run build`
- Test suite: `npm test`
- Run transformer after build: `node dist/index.js transform --title 1 --output ./out`
- Public CLI entry in `package.json`: `us-code-tools -> ./dist/index.js`
- CI must run `npm run build` before `npx vitest run` because `tests/integration/transform-cli.test.ts` shells out to `dist/index.js`; `npx tsc --noEmit` alone is not sufficient.

## Tech Stack
- Runtime: Node.js 22+
- Package manager: npm
- Language: TypeScript (`strict: true` in `tsconfig.json`)
- XML parsing: `fast-xml-parser`
- Frontmatter: `gray-matter`
- ZIP handling: `yauzl`
- Tests: Vitest

## File Layout
- `src/index.ts` — CLI orchestration
- `src/domain/` — IR types and normalization helpers
- `src/sources/` — OLRC acquisition + ZIP extraction
- `src/transforms/` — XML parsing, markdown rendering, output writing
- `src/utils/` — filesystem safety helpers
- `tests/unit/` — unit coverage by module area
- `tests/integration/` — CLI integration flow
- `tests/fixtures/` — committed fixture manifests / XML / ZIPs
- `docs/specs/1-spec.md` — canonical feature spec
- `docs/architecture/1-architecture.md` — architecture + security constraints

## Module Dependency Graph

### If you're modifying... → Read these first:
- `src/index.ts` → `src/sources/olrc.ts`, `src/transforms/uslm-to-ir.ts`, `src/transforms/write-output.ts`, `src/domain/model.ts`, `docs/architecture/1-architecture.md §4.2/§6.4`
- `src/sources/olrc.ts` → `src/domain/model.ts`, `src/domain/normalize.ts`, `src/types/yauzl.d.ts`, `docs/architecture/1-architecture.md`
- `src/transforms/uslm-to-ir.ts` → `src/domain/model.ts`, `src/domain/normalize.ts`, `docs/specs/1-spec.md`
- `src/transforms/markdown.ts` → `src/domain/model.ts`, `SPEC.md`
- `src/transforms/write-output.ts` → `src/transforms/markdown.ts`, `src/domain/normalize.ts`, `src/utils/fs.ts`, `src/domain/model.ts`
- `src/utils/fs.ts` → `docs/architecture/1-architecture.md` (symlink/output-root policy)
- `src/domain/model.ts` → every transform and writer module (contract file)

### Call Chain: Entry Point → Your Code
```text
src/index.ts (main)
  → parseArgs()
  → validateOutputDirectory()
  → getTitleZipPath()
    → getOrCreateZipPath()
    → fetchWithRetry()
  → extractXmlEntriesFromZip()
  → parseUslmToIr()
    → collectSectionNodes()
    → parseSection()
    → parseContent()
  → writeTitleOutput()
    → writeSection()
    → atomicWriteFile()
  → stdout JSON report
```

### Key Interfaces (the contracts)
- `TitleIR` in `src/domain/model.ts` — merged title-level parse result handed to renderer/writer
- `SectionIR` in `src/domain/model.ts` — per-section metadata + content tree
- `ContentNode` in `src/domain/model.ts` — legal hierarchy contract for markdown rendering
- `ParseError` in `src/domain/model.ts` — bounded failure surface propagated to final CLI report
- `XmlEntry` in `src/domain/model.ts` — ZIP extraction handoff to parser

## Conventions / Patterns
- Prefer pure functions in parser/renderer modules; keep I/O in source/writer layers.
- Preserve section identifiers as strings end-to-end; do not coerce values like `36B`.
- Keep filename normalization minimal: only `/` → `-`.
- New parser hardening should report `ParseError`s instead of crashing the process.
- If a change affects CLI output shape, update integration assertions and fixture manifest together.
- If a change touches ZIP handling or output safety, add adversary-style regression tests.

## Practical Notes
- `README.md` is broader product vision and is ahead of current implementation; follow `docs/specs/1-spec.md` + actual code for this feature.
- `tsconfig.json` uses `rootDir: "src"`; tests are not compiled into `dist`.
- `src/index.ts` now tracks `seenSectionNumbers` across all extracted XML entries; duplicate merged `sectionNumber` values add an `INVALID_XML` parse error, omit the colliding section from output, and force exit code `1` even if other sections were written.
- `src/index.ts` computes success from section-file writes, not just total `files_written`; if `_title.md` fails but one or more section files are written, the CLI still emits the final JSON report and exits `0`.
- `resolveTitleUrl()` currently hardcodes the OLRC `118/200` releasepoint URL pattern.
- `src/transforms/write-output.ts` now wraps `_title.md` writes in the same partial-failure pattern as section writes, returning `OUTPUT_WRITE_FAILED` with `sectionHint: '_title.md'` instead of throwing past the structured report path.
- `src/sources/olrc.ts` validates ZIP openability with `yauzl` both when reusing cache and after download; ZIP magic bytes alone are intentionally insufficient.

## Phase 1 Scope (Current)
- What's implemented:
  - CLI bootstrap and transform command
  - fixture-aware / cached OLRC title ZIP acquisition
  - safe XML extraction and parsing
  - markdown generation and disk writes
  - CI pipeline running typecheck + Vitest on Node 22
- What's intentionally deferred:
  - other subcommands (`sync`, `backfill`, `status`, etc. from README vision)
  - shared cache utility/logger modules described in architecture as future slices
  - live-network default tests
- What's a test double vs production:
  - `US_CODE_TOOLS_TITLE_01_FIXTURE_ZIP` env var short-circuits downloads in tests
  - committed fixtures stand in for live Title 1 network responses during CI
