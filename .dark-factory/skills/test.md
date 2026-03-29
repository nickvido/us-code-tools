# Test Notes

## Test Stack
- Framework: Vitest (`vitest.config.ts`)
- Test include pattern: `tests/**/*.test.ts`
- Setup file: `tests/setup.ts`
- Default suite is intended to run offline; Constitution backfill tests use temp local repos and local bare remotes only.

## Test Layout
- `tests/unit/bootstrap-and-cli.test.ts` — package metadata, strict TS, transform CLI validation.
- `tests/unit/backfill-cli-args.test.ts` — `backfill` flag validation, duplicate/unknown flags, file-target rejection, and transform CLI non-regression.
- `tests/unit/backfill-dataset.test.ts` — 7 articles / 27 amendments completeness, date/source validation, deterministic author identities.
- `tests/unit/backfill-renderer.test.ts` — frontmatter validation, deterministic article/amendment markdown, snapshots.
- `tests/unit/backfill-messages.test.ts` — exact Constitution and Amendment XIV commit-message formatting + snapshots.
- `tests/unit/backfill-planner.test.ts` — 28-event chronology, stable Bill of Rights ordering, suffix/resume expectations.
- `tests/unit/backfill-git-env.test.ts` — exact UTC-midnight git env strings and malformed-date rejection.
- `tests/cli/fetch.test.ts` — fetch CLI validation, `--status`, source ordering, bulk scope behavior.
- `tests/utils/fetch-config.test.ts` — current Congress override/live/fallback behavior.
- `tests/utils/manifest.test.ts` — manifest normalization/defaulting and atomic write expectations.
- `tests/utils/rate-limit.test.ts` — limiter arithmetic and exhaustion timing for the shared helper primitives.
- `tests/unit/sources/olrc.test.ts` — OLRC source/cache behavior, cookie bootstrap, `download.shtml` discovery, Title 42 extraction ceiling, Title 53 reserved-empty classification, and selected-vintage cache regressions.
- `tests/unit/transforms/uslm-to-ir.test.ts` — legacy `uslm` fixtures plus current namespace-qualified `uscDoc` fixture coverage, canonical `<num @value>` precedence, empty-attribute fallback, disagreement cases, mixed punctuation cleanup, and structural XSD-shape assertions.
- `tests/unit/transforms/issue12-recursive-metadata.test.ts` — real-fixture regression suite for recursive hierarchy walking, hierarchy frontmatter, singular `source_credit`, statutory notes, preserved `noteType`, relative USC ref rendering, canonical ordering, mixed-case suffix ordering, and zero-padded filename derivation.
- `tests/integration/transform-cli.test.ts` — built transform CLI against committed Title 1 fixtures, selected-vintage cache lookup, path-safe output assertions, and derived current-format title matrix coverage for titles `1..52` and `54` with reserved-empty `53`.
- `tests/integration/issue12-transform-cli.test.ts` — fixture-backed CLI coverage for titles 5/10/26, slash-separated USC ref links, and zero-padded filesystem output ordering.
- `tests/integration/backfill-constitution.test.ts` — fresh repo, idempotent rerun, contiguous-prefix resume, empty-dir bootstrap, dirty-repo rejection, populated-non-git rejection, unrelated-history rejection.
- `tests/adversary-round1-issue3.test.ts` — configured remote without upstream must still push current branch explicitly.
- `tests/adversary-round1-issue5.test.ts` … `tests/adversary-round9-issue5.test.ts` — issue #5 regressions across fetch, cache, manifest, GovInfo/Congress behavior, and legislators crosswalk cleanup.
- `tests/repo/data-acquisition-layout.test.ts` — repo hygiene/layout expectations for issue #5.

## Fixtures / Test Data
- Constitution backfill uses production static data in `src/backfill/constitution/dataset.ts`; there is no separate fixture copy.
- Transform tests still use:
  - `tests/fixtures/title-01/manifest.json`
  - `tests/fixtures/title-01/title-01.zip`
  - `tests/fixtures/xml/title-01/*.xml`
  - notably `tests/fixtures/xml/title-01/04-current-uscdoc.xml` for current OLRC `uscDoc` coverage with XSD-shaped `meta + main`, canonical `@value`, decorated display text, one chapter, and 53 sections
  - issue #12 recursive hierarchy fixtures:
    - `tests/fixtures/xml/title-05/05-part-chapter-sections.xml`
    - `tests/fixtures/xml/title-10/10-subtitle-part-chapter-sections.xml`
    - `tests/fixtures/xml/title-26/26-deep-hierarchy-sections.xml`
- `tests/utils/module-helpers.ts` provides safe dynamic imports for source-module unit tests.

## Patterns to Follow
- For pure backfill modules, import source files directly and assert behavior without shelling out where possible.
- For fetch utilities/sources, prefer fixture-backed unit tests over live requests; default `npm test` remains offline.
- When touching OLRC fetch logic, isolate `US_CODE_TOOLS_DATA_DIR` in tests that depend on uncached fetch behavior so ambient `data/` state cannot suppress the request path.
- For CLI tests, build first and run `dist/index.js` with `spawnSync`.
- For git behavior, prefer temp repos created in the test rather than mocks when validating actual history semantics.
- Preserve adversary regression files once added; issue #3 and issue #5 both rely on explicit regression chains.
- Snapshot only stable text contracts:
  - Article I markdown
  - Amendment I markdown
  - Constitution commit message
  - Amendment XIV commit message
- When changing legislators cross-reference behavior, keep skip-path tests verifying both manifest state and on-disk crosswalk absence.

## What Good Coverage Looks Like Here
- Dataset changes: verify counts, numbering, dates, official URLs, and representative author mappings.
- Renderer changes: parse with `gray-matter`, assert key order/content behavior, snapshot representative outputs.
- Planner changes: assert exactly 28 events, non-decreasing dates, stable `1791-12-15` ordering, and suffix behavior after slicing a prefix.
- Git/repo changes: cover empty-dir bootstrap, populated-dir rejection, dirty-tree rejection, unrelated-history rejection, prefix resume, idempotent rerun, and explicit remote push semantics.
- CLI changes: assert usage/error text and no-side-effect behavior for bad invocations.
- OLRC issue #8 changes: cover homepage cookie bootstrap, authenticated follow-on requests, `download.shtml` parsing, current `uscDoc` parsing, selected-vintage transform lookup, Title 42 large-entry acceptance, and Title 53 reserved-empty handling without live outbound access.
- Issue #10 parser changes: assert `@value` beats display text for title/chapter/section nodes, whitespace-only attributes fall back cleanly, mixed trailing `.—` decoration is removed in fallback mode, Title 1 current-format fixture yields `titleIr.chapters.length === 1` + 53 canonical section numbers, and output paths never contain decorated `<num>` text.
- Issue #12 transform changes: assert fixture `<section>` count equality for Titles 1/5/10/26, rendered hierarchy frontmatter for sampled deep-nesting sections, `source_credit` presence when `<sourceCredit>` exists, `## Statutory Notes` rendering when `<notes>` exists, preserved `noteType: 'uscNote'`, relative markdown links for transformable USC refs, canonical slash-ref mapping (`/us/usc/t10/s125/d` → `../title-10/section-00125d.md`), zero-padded filenames, canonical mixed-width/mixed-case section ordering (`106`, `106A`, `106a`, `106b`), and normalized mixed-content source-credit/note text retention (`Aug. 10, 1956, ch. 1041`, `70A Stat. 3`).
- Current branch warning: branch commit `07b954e` fixed the slash-ref target and mixed-case suffix-order regressions, but `tests/unit/transforms/issue12-recursive-metadata.test.ts` still fails on the latest adversary seam because `readRawText()` reconstructs mixed-content XML out of document order.

## Known Test Behaviors
- `tests/integration/backfill-constitution.test.ts` sets explicit author/committer env vars for reproducible local commits while the historical author lines still come from the planned events.
- Integration tests inspect commits using `git cat-file -p` / `git rev-list`, not just `git log`, to avoid locale/time-format drift.
- Backfill integration verifies the working tree is clean at the end of the run.
- The adversary regression creates a local bare remote and confirms remote HEAD matches the local branch after `git push --set-upstream <remote> <branch>`.
- Issue #5 tests assume offline-by-default behavior; `src/commands/fetch.ts` has a VITEST/live-test shortcut path for `--all` CLI tests.
- The round-9 adversary regression asserts that a later skipped legislators run must remove any pre-existing `data/cache/legislators/bioguide-crosswalk.json` rather than only updating manifest state.
- `tests/adversary-round2-issue5.test.ts` now mocks `src/utils/rate-limit.ts` at the shared-module seam and verifies Congress stops immediately with `rate_limit_exhausted` when the shared limiter reports zero remaining budget.
- There is still no dedicated regression that forces a real upstream `429 Retry-After` response through Congress/GovInfo end-to-end; current confidence comes from the source implementations plus the targeted adversary regressions that now pass locally.
- Full suite still depends on a built `dist/index.js` because transform/backfill/fetch CLI tests execute the compiled entrypoint.
- `tests/unit/transforms/uslm-to-ir.test.ts` asserts that raw namespace-qualified `uscDoc` XML parses directly; callers should not strip namespaces before invoking `parseUslmToIr()`.
- `tests/integration/transform-cli.test.ts` generates the current-format title matrix inside `buildCurrentFormatFixtureZip(...)` by deterministic string substitution from the committed Title 1 fixture; do not add live OLRC downloads or a pile of per-title committed XML fixtures for this coverage.
- `tests/integration/transform-cli.test.ts` now seeds a canonical `data/manifest.json` for selected-vintage OLRC cache resolution instead of relying only on the fixture env override.
- `tests/integration/issue12-transform-cli.test.ts` seeds a selected-vintage OLRC cache with real nested fixtures and then shells out to `dist/index.js transform`; keep that pattern for future end-to-end transform regressions instead of introducing live fetches.

## Phase 1 Scope (Current)
- What's implemented:
  - unit coverage for backfill args, dataset, renderer, messages, planner, and commit env
  - end-to-end temp-repo Constitution backfill integration coverage
  - adversary regression for configured remote without upstream
  - issue #5 CLI/utils/adversary coverage for fetch/cache/manifest/crosswalk behavior
  - issue #8 OLRC regression coverage for cookie bootstrap, listing parsing, `uscDoc` parsing, selected-vintage transform lookup, Title 42 extraction, and Title 53 reserved-empty behavior
  - issue #10 transform regression coverage for canonical `@value` extraction, fallback decoration cleanup, Title 1 chapter/section equality against source fixture values, path-safe output names, and derived multi-title current-format fixtures
  - issue #12 regression coverage for recursive hierarchy fixtures, hierarchy markdown frontmatter, `source_credit`, statutory note wrapper metadata, relative USC refs, and zero-padded section filenames
  - existing transform regression coverage remains intact
- What's intentionally deferred:
  - live external Constitution-source verification during tests
  - force-push / repair-history failure-mode suites beyond current spec
  - downstream `us-code` GitHub automation tests
  - always-on live upstream fetch tests; they stay opt-in via env flag
- What's a test double vs production:
  - temp repos and bare remotes are intentional doubles for downstream repositories/remotes
  - static Constitution dataset is production content used directly in tests
  - issue #5 upstream payload fixtures are doubles; manifest/cache/source state transitions are production logic
