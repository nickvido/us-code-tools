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
- `tests/cli/issue21-historical-olrc.test.ts` — historical OLRC CLI contract coverage for duplicate `--vintage`, side-effect-free `--list-vintages`, `unknown_vintage`, `--all-vintages` fail-open behavior, and sparse historical vintage discovery reuse.
- `tests/utils/fetch-config.test.ts` — current Congress override/live/fallback behavior.
- `tests/utils/manifest.test.ts` — manifest normalization/defaulting and atomic write expectations.
- `tests/utils/issue21-manifest-historical.test.ts` — pre-feature OLRC manifest compatibility for additive `vintages` / `available_vintages` normalization.
- `tests/utils/rate-limit.test.ts` — limiter arithmetic and exhaustion timing for the shared helper primitives.
- `tests/unit/sources/olrc.test.ts` — OLRC source/cache behavior, cookie bootstrap, `download.shtml` discovery, Title 42 extraction ceiling, Title 53 reserved-empty classification, selected-vintage cache regressions, and the source-level seams historical-vintage behavior builds on.
- `tests/unit/transforms/uslm-to-ir.test.ts` — legacy `uslm` fixtures plus current namespace-qualified `uscDoc` fixture coverage, canonical `<num @value>` precedence, empty-attribute fallback, disagreement cases, mixed punctuation cleanup, structural XSD-shape assertions, and issue #14 fixture regressions for section `chapeau`, paragraph body text, subsection body text, nested subclause bodies, and parent-level continuation text.
- `tests/unit/transforms/issue12-recursive-metadata.test.ts` — real-fixture regression suite for recursive hierarchy walking, hierarchy frontmatter, singular `source_credit`, statutory notes, preserved `noteType`, relative USC ref rendering, canonical ordering, mixed-case suffix ordering, and zero-padded filename derivation.
- `tests/unit/transforms/markdown.test.ts` — markdown rendering contracts, including issue #14 regression coverage for Title 42 § 10307 paragraph completeness, parenthesized label normalization, deterministic deep-hierarchy indentation/order, continuation placement after nested children, and issue #20 coverage for slugged cross-title links on both helper and real parser/render paths.
- `tests/unit/issue16-chapter-mode.test.ts` — chapter-mode unit contracts for shared chapter filename normalization examples, exact fallback frontmatter (`heading: Chapter {chapter}`), and byte-identical section embedding through `renderChapterMarkdown()`.
- `tests/unit/domain/normalize-title-directory.test.ts` — issue #20 slug contract coverage for lowercase/hyphenation, quote stripping, punctuation-only fallback, and `title-NN` vs `title-NN-slug` directory derivation.
- `tests/integration/transform-cli.test.ts` — built transform CLI against committed Title 1 fixtures, selected-vintage cache lookup, path-safe output assertions, and derived current-format title matrix coverage for titles `1..52` and `54` with reserved-empty `53`; issue #20 updates this matrix to assert slugged title directories across all successful numeric titles.
- `tests/integration/issue12-transform-cli.test.ts` — fixture-backed CLI coverage for titles 5/10/26, slash-separated USC ref links, and zero-padded filesystem output ordering.
- `tests/integration/issue16-transform-cli.test.ts` — chapter-mode CLI coverage for `--group-by` validation, fewer-files-than-section-mode output, required chapter frontmatter/order, normalized chapter filename collision rejection, and non-zero exit on partial chapter write failures.
- `tests/chapter-rendering-qa.test.ts` — issue #29 regression suite for chapter-mode heading levels, canonical chapter/title `source` URLs, mapped vs unmapped xref rewriting, slash-bearing parse-output link recovery, deterministic embedded anchors, nested labeled-content formatting, `_title.md` section-list removal, and Title 51-style heading preservation.
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
  - issue #14 completeness fixtures:
    - `tests/fixtures/xml/title-42/42-section-10307.xml`
    - `tests/fixtures/xml/title-26/26-deep-hierarchy-sections.xml`
- `tests/utils/module-helpers.ts` provides safe dynamic imports for source-module unit tests.
- Issue #21 CLI tests use a process-level `--import` hook (`createMockOlrcImport(...)`) to replace `globalThis.fetch` with an OLRC fixture responder; preserve that approach for end-to-end fetch selector coverage instead of introducing live OLRC requests.

## Patterns to Follow
- For pure backfill modules, import source files directly and assert behavior without shelling out where possible.
- For fetch utilities/sources, prefer fixture-backed unit tests over live requests; default `npm test` remains offline.
- For historical OLRC fetch modes, keep fixtures capable of expressing sparse vintages where a requested vintage advertises only a subset of title ZIPs; that is how the branch locks in the “missing_titles, not fabricated 404 failures” contract.
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
- Issue #21 historical OLRC changes: cover duplicate `--vintage` pre-discovery rejection, side-effect-free `--list-vintages`, unknown-vintage no-mutation behavior, `--all-vintages` fail-open aggregation, sparse-vintage discovered-link reuse, and pre-feature manifest normalization to `vintages: {}` / `available_vintages: null`.
- Issue #29 chapter-rendering changes: cover embedded heading-level separation (`#` standalone vs `##` embedded), concrete chapter/title `source` frontmatter, mapped local/cross-title chapter-anchor rewriting, exact canonical fallback URLs, real parse-output slash-bearing link recovery via `#ref=` fragments, deterministic anchors (`411`, `125d`, `301-1`, `125/d`), `_title.md` without `## Sections`, nested labeled-node indentation/blank-line rules, and ordered/non-ordered `SectionIR.heading` parity.
- Issue #10 parser changes: assert `@value` beats display text for title/chapter/section nodes, whitespace-only attributes fall back cleanly, mixed trailing `.—` decoration is removed in fallback mode, Title 1 current-format fixture yields `titleIr.chapters.length === 1` + 53 canonical section numbers, and output paths never contain decorated `<num>` text.
- Issue #12 transform changes: assert fixture `<section>` count equality for Titles 1/5/10/26, rendered hierarchy frontmatter for sampled deep-nesting sections, `source_credit` presence when `<sourceCredit>` exists, `## Statutory Notes` rendering when `<notes>` exists, preserved `noteType: 'uscNote'`, relative markdown links for transformable USC refs, canonical slash-ref mapping (`/us/usc/t10/s125/d` → `../title-10/section-00125d.md`), zero-padded filenames, canonical mixed-width/mixed-case section ordering (`106`, `106A`, `106a`, `106b`), and normalized mixed-content source-credit/note text retention (`Aug. 10, 1956, ch. 1041`, `70A Stat. 3`).
- Issue #14 transform changes: assert Title 42 § 10307 preserves section `chapeau` plus all ten numbered paragraph bodies, Title 26 § 2 preserves subsection body text + nested subclause text + parent continuation text, rendered labels are parenthesized exactly once, and repeated renders are byte-identical for fixture-backed sections.
- Issue #16 chapter-mode changes: assert numeric and non-numeric chapter filename normalization (`1` -> `chapter-001.md`, `IV` -> `chapter-iv.md`, `***` -> `chapter-unnamed.md`), exact fallback `heading: Chapter {chapter}`, `_title.md` retention in chapter mode, chapter bodies that contain standalone section markdown after frontmatter stripping, normalized chapter filename collision rejection before any chapter write, and non-zero exit when any chapter file write fails after another succeeds.
- Issue #20 title-directory changes: assert heading slug normalization (`General Provisions` -> `title-01-general-provisions`, `Veterans' Benefits` -> `title-38-veterans-benefits`), exact fallback to `title-NN` on empty/punctuation-only headings, default and chapter-mode output under slugged title directories, numeric-title matrix coverage for titles `1..52` and `54`, and real parser-path cross-title links like `../title-18-crimes-and-criminal-procedure/section-04041.md`.
- Latest issue #12 branch state at head `2fb5c52`: the earlier slash-ref / mixed-case-suffix regressions and the final mixed-content ordering seam are all covered and currently passing.
- Latest issue #14 branch state at head `fa568ae`: the QA red regressions for missing paragraph/subsection bodies, bare labels, and dropped continuation text are all covered in `tests/unit/transforms/uslm-to-ir.test.ts` + `tests/unit/transforms/markdown.test.ts` and currently passing.
- Latest issue #16 branch state at head `3c6f834`: the earlier collision-overwrite path and the final partial-chapter-write exit-code path are both covered in `tests/integration/issue16-transform-cli.test.ts` and currently passing.
- Latest issue #20 branch state at head `787674b`: the adversary parser-path link regression is covered in `tests/unit/transforms/markdown.test.ts`, slug normalization lives in `tests/unit/domain/normalize-title-directory.test.ts`, and issue #12 legacy expectations were updated to the slugged-directory contract.
- Latest issue #21 branch state at head `051ce97`: the original historical-mode contract tests plus the sparse-vintage adversary regression in `tests/cli/issue21-historical-olrc.test.ts` all pass; `tests/utils/issue21-manifest-historical.test.ts` covers additive manifest normalization for old OLRC manifests.
- Latest issue #29 branch state at head `67d7f86`: `tests/chapter-rendering-qa.test.ts` covers the adversary-identified ordered-xref regressions, `tests/unit/issue16-chapter-mode.test.ts` was updated to assert H2 embedded headings/anchors, and the targeted slash-bearing mapped/fallback cases now pass.
- Fastest focused verification for issue #12 now is:
  - `rtk test npx vitest run tests/unit/transforms/issue12-recursive-metadata.test.ts tests/integration/issue12-transform-cli.test.ts tests/unit/transforms/write-output.test.ts`
  - expected result at current head: all tests pass, including the Title 10 assertions that require `Aug. 10, 1956, ch. 1041` and `70A Stat. 3` to survive around inline refs.
- Fastest focused verification for issue #14 now is:
  - `rtk test npx vitest run tests/unit/transforms/uslm-to-ir.test.ts tests/unit/transforms/markdown.test.ts`
  - expected result at current head: all tests pass, including the Title 42 § 10307 completeness spot-check and the Title 26 § 2 continuation-order assertions.
- Fastest focused verification for issue #16 now is:
  - `rtk test npx vitest run tests/unit/issue16-chapter-mode.test.ts tests/integration/issue16-transform-cli.test.ts`
  - expected result at current head: all tests pass, including the normalized filename collision regression and the partial chapter write non-zero exit regression.
- Fastest focused verification for issue #29 now is:
  - `rtk test npx vitest run tests/chapter-rendering-qa.test.ts tests/unit/issue16-chapter-mode.test.ts`
  - expected result at current head: all tests pass, including ordered xref-only paragraph preservation and slash-bearing `125/d` mapped/fallback chapter-mode rewrites.

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

## Milestones / Releases Test Notes (Issue #18)
- Milestones coverage currently lives in:
  - `tests/cli/milestones.test.ts` — command usage, deterministic plan output, same-year inauguration skip semantics, committed metadata smoke check
  - `tests/integration/milestones-workflow.test.ts` — build-first full workflow coverage for `plan`, `apply`, and `release`
- The integration suite uses real temp git repos plus fake `gh` binaries instead of mocking internal modules for most end-to-end assertions.
- Important workflow assertions already covered:
  - `apply` creates `annual/*`, paired one-per-row `pl/*`, boundary-only `congress/*`, and manifest rows deterministically
  - unchanged reruns leave tags stable and manifest bytes identical
  - dirty working tree rejects before tag/manifest mutation
  - detached HEAD rejects with `detached_head` and not `repo_dirty`
  - duplicate metadata fails during planning before side effects
  - release refuses missing/stale manifest state before any `gh` write
  - release create/update is keyed by tag name (`gh release view/create/edit` path)
  - `pl/*` SHA drift alone is enough to fail manifest freshness
  - `git_cli_unavailable` and `github_cli_unavailable` both fail closed before mutation
  - lock conflicts echo `pid`, `hostname`, `command`, and `timestamp` and leave the lock file untouched
- Fake-CLI helpers worth reusing instead of reinventing:
  - `createFakeGhBin(...)` in `tests/integration/milestones-workflow.test.ts` for release create/edit/view logging and state persistence
  - `createGitOnlyBin(...)` for PATH-based `gh` absence scenarios
- Current milestone tests are build-coupled: both CLI and integration suites shell out to `dist/index.js`, so `npm run build` remains a prerequisite for green Vitest runs on those files.

## What Good Coverage Looks Like Here
- Metadata changes: assert both positive plan shape and pre-mutation validation failures (`metadata_invalid`, duplicate tags/dates/slugs, malformed release points, scope mismatch).
- Repo-state changes: assert no tags and no `.us-code-tools/milestones.json` on dirty-tree, detached-HEAD, lock-conflict, or binary-resolution failures.
- Freshness changes: assert `release` fails on digest drift, missing manifest, missing tags, or per-tag SHA drift before any fake-`gh` state/log file appears.
- Release-body changes: assert exact ordered sections `## Diff Stat`, `## Summary`, `## Notable Laws`, `## Narrative`; baseline release must render the exact fixed sentence when `previous_tag` is null.
- Binary-resolution changes: assert PATH isolation via fake bins and that failure occurs before any mutation.
- Concurrency changes: preserve the repo-local lock test that verifies both surfaced diagnostics and unchanged on-disk lock payload.

## Known Test Behaviors
- `tests/integration/milestones-workflow.test.ts` calls `npm run build` once in `beforeAll()` and then shells out to `process.execPath dist/index.js ...`.
- Fake `gh` binaries persist both a JSONL command log and a JSON state file so tests can prove create-vs-edit idempotency without GitHub network access.
- Milestone temp repos commit dated snapshot files directly with shell `git add && git commit` commands; commit SHAs are then embedded into metadata JSON written inside the test sandbox.
- The detached-HEAD regression uses `git checkout --detach <sha>` and then asserts both the deterministic code path and absence of manifest/tag side effects.
- Binary-unavailable tests use PATH replacement rather than monkeypatching internal resolution helpers, so they exercise the real absolute-path resolver contract.

## Phase 1 Scope (Current)
- What's implemented:
  - unit coverage for backfill args, dataset, renderer, messages, planner, and commit env
  - end-to-end temp-repo Constitution backfill integration coverage
  - adversary regression for configured remote without upstream
  - issue #5 CLI/utils/adversary coverage for fetch/cache/manifest/crosswalk behavior
  - issue #8 OLRC regression coverage for cookie bootstrap, listing parsing, `uscDoc` parsing, selected-vintage transform lookup, Title 42 extraction, and Title 53 reserved-empty behavior
  - issue #10 transform regression coverage for canonical `@value` extraction, fallback decoration cleanup, Title 1 chapter/section equality against source fixture values, path-safe output names, and derived multi-title current-format fixtures
  - issue #12 regression coverage for recursive hierarchy fixtures, hierarchy markdown frontmatter, `source_credit`, statutory note wrapper metadata, relative USC refs, and zero-padded section filenames
  - issue #16 regression coverage for additive chapter-mode CLI validation, chapter frontmatter/embedding contracts, filename normalization, collision rejection, and partial write exit semantics
  - issue #20 regression coverage for title-directory slug normalization, slugged default/chapter output roots, numeric-title matrix safety, and real parser-path cross-title links
  - issue #21 regression coverage for historical OLRC selector validation, discovery-only listing mode, unknown-vintage handling, fail-open all-vintages execution, sparse-vintage discovered-link reuse, and additive manifest compatibility
  - issue #29 regression coverage for chapter heading hierarchy, chapter/title source URL concreteness, chapter-anchor xref rewriting, slash-bearing parse-output link recovery, title-index simplification, structured nested subsection formatting, and Title 51 heading retention
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
