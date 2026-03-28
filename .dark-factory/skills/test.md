# Test Notes

## Test Stack
- Framework: Vitest (`vitest.config.ts`)
- Test include pattern: `tests/**/*.test.ts`
- Setup file: `tests/setup.ts`
- Default suite is intended to run without outbound network access.

## Test Layout
- `tests/unit/bootstrap-and-cli.test.ts` — package metadata, strict TS, CLI usage/validation.
- `tests/unit/sources/olrc.test.ts` — URL resolution, ZIP lexical ordering, archive hardening, retry behavior, cache semantics.
- `tests/unit/transforms/uslm-to-ir.test.ts` — IR extraction, array normalization, string section ids, parse errors.
- `tests/unit/transforms/markdown.test.ts` — frontmatter contract, hierarchy rendering, note preservation, snapshots.
- `tests/unit/transforms/write-output.test.ts` — output path derivation.
- `tests/integration/transform-cli.test.ts` — built CLI against committed Title 1 fixture ZIP assembled from fixture XML.
- `tests/adversary-round1-issue1.test.ts` — chapter-contained sections + symlinked output regression coverage.
- `tests/adversary-round2-issue1.test.ts` — early `--output` validation + cache-manifest/SHA validation regressions.
- `tests/adversary-round3-issue1.test.ts` — source-credit separation + oversized-field parse-bound regressions.
- No adversary-round4 regression tests exist yet for the current open findings (duplicate section merge handling, `_title.md` write-failure report preservation).
  - `tests/unit/transforms/write-output.test.ts` currently covers only path derivation, so the `_title.md` failure case still needs either a new writer-unit test with mocked `atomicWriteFile()`/`assertSafeOutputPath()` or an adversary regression test that exercises structured-report preservation through `src/index.ts`.
  - duplicate-merge coverage should target `src/index.ts` multi-XML aggregation, asserting duplicate `sectionNumber` values add an `INVALID_XML` parse error and do not overwrite earlier section output.

## Fixtures
- `tests/fixtures/title-01/manifest.json` — expected output filenames / parse-error codes for integration assertions.
- `tests/fixtures/title-01/title-01.zip` — committed ZIP used by unit tests.
- `tests/fixtures/xml/title-01/*.xml` — XML snippets used to build the integration ZIP and unit parser fixtures.

## Patterns to Follow
- For module tests, import source files directly from `src/` using helper utilities in `tests/utils/module-helpers.ts`.
- For CLI tests, run `dist/index.js` with `spawnSync` after building.
- Preserve network-free defaults by using fixtures, env overrides, or mocked `globalThis.fetch`.
- Prefer adversary regression tests for every bug fixed from review comments.
- Snapshot tests already exist for three representative section shapes:
  - nested hierarchy
  - flat section
  - cross-reference/editorial note retention

## What Good Coverage Looks Like Here
- Parser changes: add fixture XML and assert `TitleIR` / `SectionIR` shape + `ParseError[]` behavior.
- Renderer changes: assert frontmatter with `gray-matter` and snapshot the body.
- ZIP/cache changes: test explicit rejection paths (duplicate destinations, symlinks, oversize entries, invalid sidecars).
- CLI changes: assert stderr usage text, exit code, and absence/presence of output files.

## Known Test Helpers / Behaviors
- `transform-cli.test.ts` builds a temporary ZIP from committed XML files using `zip` CLI during the test.
- `olrc.test.ts` can monkeypatch `globalThis.fetch` to verify retry counts and cache invalidation.
- Integration test parses frontmatter with `gray-matter` to verify emitted files remain parseable.

## Phase 1 Scope (Current)
- What's implemented:
  - unit coverage across CLI/source/parser/renderer/writer
  - fixture-backed integration run for Title 1
  - adversary regression suites for all prior review cycles
  - snapshot coverage for representative markdown shapes
- What's intentionally deferred:
  - live OLRC verification in default CI
  - end-to-end tests for future sync/backfill/git workflows
- What's a test double vs production:
  - mocked fetch and fixture ZIP/XML artifacts are intentional test doubles
  - they should not be flagged as missing production integration; they enforce deterministic CI
