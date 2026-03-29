# Dev Notes

## Build / Run / Test
- Install: `npm install`
- Typecheck: `npx tsc --noEmit`
- Build CLI: `npm run build`
- Full test suite: `npm test`
- Focused issue #3 tests:
  - `npx vitest run tests/unit/backfill-cli-args.test.ts`
  - `npx vitest run tests/integration/backfill-constitution.test.ts`
  - `npx vitest run tests/adversary-round1-issue3.test.ts`
- Focused issue #5 tests:
  - `npx vitest run tests/cli/fetch.test.ts`
  - `npx vitest run tests/utils/fetch-config.test.ts tests/utils/manifest.test.ts tests/utils/rate-limit.test.ts`
  - `npx vitest run tests/adversary-round9-issue5.test.ts`
- Focused issue #8 tests:
  - `npx vitest run tests/unit/sources/olrc.test.ts`
  - `npx vitest run tests/unit/transforms/uslm-to-ir.test.ts`
  - `npx vitest run tests/integration/transform-cli.test.ts`
- Focused issue #10 tests:
  - `npx vitest run tests/unit/transforms/uslm-to-ir.test.ts`
  - `npx vitest run tests/integration/transform-cli.test.ts`
- Focused issue #12 tests:
  - `npx vitest run tests/unit/transforms/issue12-recursive-metadata.test.ts`
  - `npx vitest run tests/unit/transforms/write-output.test.ts`
  - `npx vitest run tests/integration/issue12-transform-cli.test.ts`
- Focused issue #14 tests:
  - `npx vitest run tests/unit/transforms/uslm-to-ir.test.ts tests/unit/transforms/markdown.test.ts`
  - spot-check fixture sections: Title 42 § 10307 and Title 26 § 2
- Focused issue #16 tests:
  - `npx vitest run tests/unit/issue16-chapter-mode.test.ts tests/integration/issue16-transform-cli.test.ts`
  - spot-checks: chapter filename normalization examples, `heading: Chapter {chapter}` fallback, collision rejection, and partial chapter write failure exit semantics
- Focused issue #21 tests:
  - `npx vitest run tests/cli/issue21-historical-olrc.test.ts tests/utils/issue21-manifest-historical.test.ts`
  - full regression proof from dev handoff: `npm test` (`166/166` passing at commit `051ce97`)
- Run backfill after build:
  - `node dist/index.js backfill --phase constitution --target ./test-repo`
- Run transform after build:
  - `node dist/index.js transform --title 1 --output ./out`
- Run fetch after build:
  - `node dist/index.js fetch --status`
  - `node dist/index.js fetch --source=congress --congress=119`
  - `node dist/index.js fetch --all --congress=119`
- Public CLI entry in `package.json`: `us-code-tools -> ./dist/index.js`
- CI/build note: integration/CLI tests shell out to `dist/index.js`, so `npm run build` must happen before Vitest when validating compiled CLI behavior.

## Tech Stack
- Runtime: Node.js 22+
- Package manager: npm
- Language: TypeScript (`strict: true`)
- XML parsing: `fast-xml-parser`
- Frontmatter: `gray-matter`
- ZIP handling: `yauzl`
- HTTP: native `fetch`
- Testing: Vitest
- Git integration: system `git` CLI via `child_process`
- No YAML/CSV parser dependency yet for issue #5; `src/sources/unitedstates.ts` and `src/sources/voteview.ts` currently use lightweight ad hoc parsing helpers

## File Layout
- `src/index.ts` — dispatches `transform`, `backfill`, `fetch`, and milestone flows
- `src/commands/fetch.ts` — fetch CLI parsing/dispatch/status output, including OLRC historical selector validation (`--list-vintages`, `--vintage`, `--all-vintages`)
- `src/backfill/constitution/dataset.ts` — static Constitution records + author metadata
- `src/backfill/renderer.ts` — Constitution markdown/frontmatter renderer
- `src/backfill/messages.ts` — exact historical commit-message templates
- `src/backfill/planner.ts` — 28-event plan builder
- `src/backfill/target-repo.ts` — repo prep / preflight / prefix detection / remote resolution
- `src/backfill/git-adapter.ts` — git wrapper + fast-import commit creation
- `src/backfill/orchestrator.ts` — applies missing suffix events and pushes current branch
- `src/sources/olrc.ts` — OLRC homepage bootstrap/cookie handling, `download.shtml` vintage discovery, list/single/all-vintage orchestration, ZIP acquisition + extraction, reserved-empty Title 53 classification, sparse-vintage discovered-link reuse, and selected-vintage cache resolution
- `src/sources/congress.ts` — Congress fetch orchestration
- `src/sources/congress-member-snapshot.ts` — member snapshot freshness contract
- `src/sources/govinfo.ts` — GovInfo collection walk/checkpointing
- `src/sources/voteview.ts` — VoteView file download/index helpers
- `src/sources/unitedstates.ts` — legislators download/parsing/crosswalk
- `src/utils/cache.ts`, `manifest.ts`, `fetch-config.ts`, `logger.ts`, `rate-limit.ts`, `retry.ts` — acquisition infrastructure
- `tests/cli/` — fetch CLI contract coverage
- `tests/unit/` — pure-module coverage
- `tests/integration/` — built CLI end-to-end coverage
- `tests/adversary-round1-issue3.test.ts` — remote-push regression for issue #3
- `tests/adversary-round1-issue5.test.ts` … `tests/adversary-round9-issue5.test.ts` — issue #5 regression chain

## Module Dependency Graph

### If you're modifying... → Read these first:
- `src/index.ts` → `src/commands/fetch.ts`, `src/backfill/orchestrator.ts`, `src/sources/olrc.ts`, `src/transforms/uslm-to-ir.ts`, `src/transforms/write-output.ts` (issue #8/#16: `transform` now resolves OLRC ZIPs via manifest-backed selected-vintage cache state instead of the legacy `.cache/olrc/title-XX` layout, parses `--group-by chapter`, surfaces additive `warnings`, and must return non-zero on any `OUTPUT_WRITE_FAILED` from chapter-mode writes)
- `src/commands/fetch.ts` → `src/utils/manifest.ts`, `src/utils/fetch-config.ts`, every `src/sources/*.ts` fetch entrypoint (this file owns CLI contract + deterministic `--all` ordering; issue #21 also makes it the pre-discovery validation boundary for duplicate/malformed `--vintage` and invalid OLRC historical selector combinations)
- `src/sources/congress.ts` → `src/utils/cache.ts`, `src/utils/manifest.ts`, `src/utils/rate-limit.ts`, `src/utils/retry.ts`, `src/utils/logger.ts`, `src/sources/congress-member-snapshot.ts` (this source uses `getSharedApiDataGovLimiter()` and throws numeric `nextRequestAt` values that `normalizeError()` serializes into the public `next_request_at` field)
- `src/sources/congress-member-snapshot.ts` → `src/utils/manifest.ts` (freshness derives from manifest snapshot metadata + artifact existence)
- `src/sources/govinfo.ts` → `src/utils/cache.ts`, `src/utils/manifest.ts`, `src/utils/rate-limit.ts`, `src/utils/retry.ts`, `src/utils/logger.ts` (this source also uses `getSharedApiDataGovLimiter()` and preserves numeric `nextRequestAt` through `normalizeError()`)
- `src/sources/unitedstates.ts` → `src/utils/manifest.ts`, `src/sources/congress-member-snapshot.ts`, current Congress cache layout in `src/sources/congress.ts`
- `src/sources/voteview.ts` → `src/utils/manifest.ts` and its in-memory index cache (`inMemoryIndexes`)
- `src/sources/olrc.ts` → `src/domain/model.ts`, `src/domain/normalize.ts`, `src/types/yauzl.d.ts`, `src/utils/manifest.ts`, `src/utils/logger.ts` (issue #8/#21: this module owns OLRC homepage bootstrap, in-memory cookie forwarding, `download.shtml` parsing, descending/deduped vintage discovery, discovered per-vintage title URL maps, Title 53 `reserved_empty` classification, the 128 MiB large-title entry cap, aggregate `--all-vintages` execution, and `resolveCachedOlrcTitleZipPath()`)
- `src/utils/cache.ts` → `src/utils/manifest.ts` consumers in Congress/GovInfo; cache key normalization strips `api_key`
- `src/utils/manifest.ts` → all fetch sources + `src/commands/fetch.ts` (manifest shape is the contract; issue #8 hardened `sources.olrc.titles[title]` into concrete `downloaded` vs `reserved_empty` states, and issue #21 adds additive `sources.olrc.vintages` + `available_vintages` while preserving latest-mode compatibility fields)
- `src/backfill/orchestrator.ts` → `src/backfill/planner.ts`, `src/backfill/constitution/dataset.ts`, `src/backfill/target-repo.ts`, `src/backfill/git-adapter.ts`
- `src/backfill/target-repo.ts` → `src/backfill/planner.ts`, `src/backfill/git-adapter.ts` (prefix checks depend on planned commit metadata and git inspection)
- `src/backfill/git-adapter.ts` → `src/backfill/planner.ts` (commit creation consumes `HistoricalEvent`)
- `src/backfill/planner.ts` → `src/backfill/constitution/dataset.ts`, `src/backfill/renderer.ts`, `src/backfill/messages.ts`
- `src/backfill/renderer.ts` → `src/backfill/constitution/dataset.ts`, `gray-matter`
- `src/backfill/messages.ts` → no downstream state; keep pure and template-exact
- `src/transforms/uslm-to-ir.ts` → `src/domain/model.ts`, `src/domain/normalize.ts`, `fast-xml-parser` (issue #8/#10/#12/#14: parser config uses `removeNSPrefix: true`, root discovery falls back from `uscDoc.main.title` to `uslm.title`, canonical title/chapter/section numbers flow through `readCanonicalNumText(...)`, recursive traversal accumulates `subtitle`/`part`/`subpart`/`chapter`/`subchapter`, `parseNotes()` emits `sourceCredit` + `statutoryNotes`, and ordered-body helpers now preserve `chapeau`, inline body text, nested descendants, and `continuation` across `subsection -> ... -> subitem`)
- `src/transforms/markdown.ts` → `src/domain/model.ts`, `src/domain/normalize.ts`, `gray-matter` (issue #12/#14/#16: section frontmatter now serializes hierarchy keys + `source_credit`, `_title.md` must use `sortSections()`, section prose may contain relative USC links generated from sanitized section ids, labeled body rendering normalizes bare labels like `1` to `(1)` while keeping deterministic indentation, and chapter-mode renderers must embed `renderSectionMarkdown()` output rather than re-render section bodies)
- `src/transforms/write-output.ts` → `src/transforms/markdown.ts`, `src/utils/fs.ts`, `src/domain/model.ts`, `src/domain/normalize.ts` (issue #12/#16: all section file paths must use zero-padded `sectionFileSafeId()` output, chapter bucketing must use `section.hierarchy.chapter`, and collision detection must happen on `chapterOutputFilename()` before any chapter writes)

### Call Chain: Entry Point → Your Code
```text
src/index.ts (main)
  → runFetchCommand()
    → parseFetchArgs()
    → runAllSources() | runSingleSource()
      → listOlrcVintages() | fetchSpecificOlrcVintage() | fetchAllOlrcVintages() | fetchOlrcSource()
        → fetchOlrcVintagePlan()
          → fetchPreferredOlrcListing()
          → extractReleasepointLinks()
          → compareVintageDescending()
        → selectVintagePlan()
          → reuse discovery-retained titleUrlsByVintage (issue #21 sparse-vintage contract)
        → fetchDiscoveredOlrcVintage()
          → getOrCreateZipPath()
            → fetchWithRetry()
              → fetchWithOlrcCookies()
                → bootstrapOlrcSession()
            → classifyReservedEmptyPayload() / classifyReservedEmptyError()
          → extractXmlEntriesFromZip()
          → buildVintageManifestState() / buildAvailableVintagesState()
          → writeManifest()
      → fetchCongressSource()
        → resolveCurrentCongressScope()
        → ensureMemberSnapshot()
          → evaluateCongressMemberSnapshotFreshness()
        → fetchSingleCongress()
          → fetchCongressResponse()
            → readFreshRawResponseCache() / writeRawResponseCache()
            → getSharedApiDataGovLimiter()
            → isRateLimitExhausted() / markRateLimitUse()
            → parseRetryAfter() on HTTP 429, then throw numeric `nextRequestAt` for `normalizeError()` to serialize
        → writeManifest()
      → fetchGovInfoSource()
        → fetchGovInfoResponse()
          → readFreshRawResponseCache() / writeRawResponseCache()
          → getSharedApiDataGovLimiter()
          → isRateLimitExhausted() / markRateLimitUse()
          → parseRetryAfter() on HTTP 429, then throw numeric `nextRequestAt` for `normalizeError()` to serialize
        → writeManifest()
      → fetchVoteViewSource()
        → fetchWithTimeout()
        → writeManifest()
      → fetchUnitedStatesSource()
        → buildCrossReferenceState()
          → evaluateCongressMemberSnapshotFreshness()
          → loadCongressSnapshotBioguideIds()
        → removeCrosswalkArtifact() when cross-reference is skipped
        → writeManifest()

src/index.ts (main)
  → runTransformCommand()
    → resolveCachedOlrcTitleZipPath()
    → extractXmlEntriesFromZip()
    → parseUslmToIr()
      → readCanonicalNumText()
        → normalizeWhitespace(value['@_value']) OR cleanDecoratedNumText(readNormalizedText(...))
    → writeTitleOutput()

src/index.ts (main)
  → runBackfillCommand()
    → runConstitutionBackfill()
      → buildConstitutionPlan(constitutionDataset)
      → prepareTargetRepo()
      → commitHistoricalEvent()
```

### Key Interfaces (the contracts)
- `FetchArgs` in `src/commands/fetch.ts` — normalized CLI request for `fetch`, including issue #21 `listVintages`, `vintage`, and `allVintages`
- `FetchManifest` in `src/utils/manifest.ts` — persisted acquisition state contract
- `OlrcTitleState` / `OlrcTitleReservedEmptyState` in `src/utils/manifest.ts` — per-title OLRC cache/result contract for issues #8/#21
- `OlrcVintageState` / `OlrcAvailableVintagesState` / `OlrcManifestState` in `src/utils/manifest.ts` — historical OLRC manifest contract and latest-mode compatibility mirror
- `CongressMemberSnapshotState` / `CongressRunState` / `GovInfoCheckpointState` / `LegislatorsCrossReferenceState` in `src/utils/manifest.ts` — per-source manifest contracts
- `CurrentCongressResolution` in `src/utils/fetch-config.ts` — `override`/`live`/`fallback` current-congress contract
- `RawResponseCacheMetadata` in `src/utils/cache.ts` — raw API response cache metadata contract
- `RateLimitState` / `RateLimitExhaustion` in `src/utils/rate-limit.ts` — shared limiter contract
- `OlrcFetchResult`, `FetchSourceResult` (`congress`), `GovInfoResult`, `VoteViewResult`, `UnitedStatesResult` — per-source CLI result payloads
- `ConstitutionProvisionRecord` in `src/backfill/constitution/dataset.ts` — per-article/amendment source-of-truth record
- `ConstitutionDataset` in `src/backfill/constitution/dataset.ts` — full static dataset contract
- `HistoricalEvent` in `src/backfill/planner.ts` — exact commit/write plan contract
- `PreparedTargetRepo` in `src/backfill/target-repo.ts` — repo bootstrap + resume state handoff
- `BackfillSummary` in `src/backfill/orchestrator.ts` — CLI success payload
- `TitleIR`, `SectionIR`, `ParseError`, `XmlEntry`, `HierarchyIR`, `StatutoryNoteIR`, and the labeled `ContentNode` union in `src/domain/model.ts` — transform contracts, including issue #12 hierarchy/statutory-note metadata and issue #14 first-class `subclause` / `subitem` structured-body nodes
- `splitSectionNumber(...)`, `compareSectionNumbers(...)`, `sectionFileSafeId(...)`, `sortSections(...)`, `chapterFileSafeId(...)`, `chapterOutputFilename(...)`, and `compareChapterIdentifiers(...)` in `src/domain/normalize.ts` — canonical section/chapter sort and filename contract for issues #12 and #16
- `readCanonicalNumText(...)` / `cleanDecoratedNumText(...)` in `src/transforms/uslm-to-ir.ts` — the canonical `<num>` extraction boundary for issue #10; future parser changes should extend this seam instead of adding ad hoc cleanup elsewhere

## Conventions / Patterns
- Keep `planner.ts`, `renderer.ts`, and `messages.ts` pure.
- Treat `src/backfill/constitution/dataset.ts` as the sole source of truth for provision metadata and commit authors.
- Preserve exact commit-message formatting; prefix detection depends on it.
- Same-day events must remain stable in numeric order; do not sort amendments by anything except planned order.
- `prepareTargetRepo()` is intentionally strict; do not relax clean-tree or non-prefix rejection without spec/architecture changes.
- Push logic must always specify branch explicitly for configured remotes with no upstream.
- The implementation uses `git fast-import` for historical commits, then `git reset --hard HEAD` to restore a clean working tree.
- Fetch-path conventions:
  - `src/commands/fetch.ts` owns CLI validation and top-level fail-open source ordering
  - `src/utils/manifest.ts` is permissive on read/normalize but all writers should emit the canonical shape
  - Congress/GovInfo raw API caching goes through `src/utils/cache.ts`; cache keys normalize away `api_key`
  - Congress and GovInfo both call `getSharedApiDataGovLimiter()` / `resetSharedApiDataGovLimiter()` from `src/utils/rate-limit.ts`; update tests and any mocks at that shared-module seam rather than assuming per-source limiter state
  - `src/utils/rate-limit.ts` owns `parseRetryAfter()`, and both `src/sources/congress.ts` and `src/sources/govinfo.ts` now keep the parsed retry horizon numeric until `normalizeError()` converts it into the public ISO `next_request_at` field
  - `src/utils/retry.ts` still exposes only a minimal `withRetry()` loop and does not own HTTP `Retry-After` translation today
  - OLRC requests bootstrap the homepage once per fetch context and then reuse an in-memory `Cookie` header for listing + ZIP requests; do not persist or log it
  - OLRC vintage discovery is `download.shtml`-first; only Title 53 may be classified as `reserved_empty`
  - issue #21 historical modes must reuse the exact discovery pass results: do not synthesize `resolveTitleUrl(title, vintage)` for titles the listing did not advertise for that vintage
  - `--list-vintages` is intentionally side-effect free; no manifest/cache writes belong on that path
  - latest-mode compatibility is deliberate: only plain `fetch --source=olrc` updates the top-level `sources.olrc.selected_vintage` + `titles` mirror
  - legislators cross-reference must delete stale `bioguide-crosswalk.json` whenever the result status is not `completed`
  - VoteView indexes are currently in-memory only via `inMemoryIndexes`, so repeated lookups in one process avoid reparsing but cross-process persistence is not implemented
- Summary/result objects are JSON-first and use spec-style keys like `requested_scope`, `bulk_scope`, `next_request_at`, and `last_success_at`.
- Issue #12 transform conventions:
  - never hand-roll section ordering in renderers/tests; use `sortSections()` / `compareSectionNumbers()`
  - never hand-roll section filenames or ref targets; use `sectionFileSafeId()` so writes and links stay aligned
  - slash-separated USC ref tails like `/us/usc/t10/s125/d` must be canonicalized before path generation; branch commit `07b954e` collapses the slash tail in `hrefToMarkdownLink()` so links resolve to `section-00125d.md`
  - preserve suffix case in ordering and filenames (`106A` != `106a`)
  - mixed-case suffix ordering is part of the contract: `106` < `106A` < `106a` < `106b`; branch commit `07b954e` replaced locale-sensitive suffix sorting with direct codepoint comparison to keep that order deterministic
  - mixed-content inline ordering is now handled by the preserve-order parser path at head `2fb5c52`: `parseUslmToIr()` parses both the ordinary object tree and a `preserveOrder: true` tree, aligns sections with `collectOrderedSectionNodes(...)`, and routes section prose / `sourceCredit` / statutory-note extraction through ordered helpers instead of relying on the older object-entry traversal
  - issue #14 builds on that same preserve-order seam: `parseOrderedContentChildren(...)` and `parseLabeledNodeOrdered(...)` are now the production path for structured section bodies when ordered children are available; preserve the source-order contract `chapeau -> inline body -> nested labeled children -> continuation`
  - issue #16 chapter mode must build on the existing transform contracts instead of bypassing them: group only on parsed `hierarchy.chapter`, order sections with `sortSections()`, derive chapter paths only through `chapterOutputFilename()`, and embed section output by stripping frontmatter from `renderSectionMarkdown()` results
  - when modifying `src/transforms/uslm-to-ir.ts`, treat `readOrderedRawText(...)` + `parseNotesOrdered(...)` as the production issue-#12 path and treat the ordered body helpers as the production issue-#14 path; keep legacy `readRawText(...)` behavior only where the ordered tree is unavailable, and avoid reintroducing per-tag bucket concatenation for mixed-content nodes
  - treat hierarchy frontmatter as part of the user-visible contract, not an internal parser detail

## Practical Notes
- `parseBackfillArgs()` rejects duplicate flags, unknown flags, and unsupported phases before any filesystem side effects.
- `ensureGitRepo()` behavior is part of the contract:
  - missing path → create + `git init`
  - empty existing dir → `git init`
  - populated non-git dir → fail
  - regular file target → fail
- `detectMatchingPrefix()` compares existing commits to the plan by author name/email, date, and normalized full commit message from `git cat-file -p`.
- `buildGitCommitEnv()` exists primarily to guarantee exact UTC timestamp strings in tests; actual commits are authored in `fast-import` using Unix seconds + `+0000`.
- There is no separate `authors.ts` file in the current code despite the architecture doc suggestion.

## Milestones / Releases Dev Notes (Issue #18)
- New CLI command family:
  - `node dist/index.js milestones plan --target <repo> --metadata <file>`
  - `node dist/index.js milestones apply --target <repo> --metadata <file>`
  - `node dist/index.js milestones release --target <repo> --metadata <file>`
- Fast focused verification for issue #18:
  - `rtk test npx vitest run tests/cli/milestones.test.ts tests/integration/milestones-workflow.test.ts`
  - `rtk err npx tsc --noEmit`
  - `rtk err npm run build`
- Current repo has milestone-specific production files:
  - `src/commands/milestones.ts`
  - `src/milestones/apply.ts`
  - `src/milestones/git.ts`
  - `src/milestones/manifest.ts`
  - `src/milestones/metadata.ts`
  - `src/milestones/plan.ts`
  - `src/milestones/president-tags.ts`
  - `src/milestones/release-renderer.ts`
  - `src/milestones/releases.ts`
  - `src/milestones/title-renderer.ts`
  - `src/milestones/types.ts`

## Module Dependency Graph

### If you're modifying... → Read these first:
- `src/commands/milestones.ts` → `src/milestones/metadata.ts`, `src/milestones/plan.ts`, `src/milestones/president-tags.ts`, `src/milestones/apply.ts`, `src/milestones/releases.ts`, `src/milestones/git.ts` (command entrypoint owns parse/usage/dispatch and the early `git` resolution for `apply`)
- `src/milestones/metadata.ts` → `src/milestones/types.ts` (manual semantic validation lives here; no external schema validator exists in current code)
- `src/milestones/plan.ts` → `src/milestones/metadata.ts`, `src/milestones/president-tags.ts`, `src/milestones/title-renderer.ts`, `src/milestones/git.ts` (plan shape depends on normalized metadata + commit resolution + Congress title/year derivation)
- `src/milestones/apply.ts` → `src/milestones/git.ts`, `src/milestones/manifest.ts`, `src/milestones/types.ts` (tag creation order + repo safety + manifest persistence all meet here)
- `src/milestones/git.ts` → Node `child_process`, `fs/promises`, `path` (this is the trusted subprocess boundary for both `git` and `gh`)
- `src/milestones/manifest.ts` → `src/milestones/types.ts` (manifest digesting, atomic writes, and repo-local lock handling live together)
- `src/milestones/releases.ts` → `src/milestones/manifest.ts`, `src/milestones/release-renderer.ts`, `src/milestones/metadata.ts`, `src/milestones/plan.ts`, `src/milestones/git.ts` (release freshness, diff-stat generation, and `gh` create/edit all converge here)
- `src/milestones/release-renderer.ts` → `src/milestones/types.ts` (pure body rendering + exact boundary-row selection)
- `tests/integration/milestones-workflow.test.ts` → all milestone modules via built CLI (`dist/index.js`), plus fake `gh` / PATH-manipulation scenarios

### Call Chain: Entry Point → Your Code
```text
src/index.ts
  → runMilestonesCommand()
    → loadMetadata()
    → (apply only) resolveGitBinary()
    → buildMilestonesPlan()
      → resolveCommitSelector()
      → normalizeReleasePointTag()
      → derivePresidentTags()
      → renderCongressTitle()
    → derivePresidentTags()
    → applyMilestones()
      → ensureAttachedHead()
      → ensureCleanWorkingTree()
      → withLock()
      → createAnnotatedTag()
      → writeManifest()
    OR
    → releaseMilestones()
      → readManifest()
      → computeMetadataDigest()
      → normalizeCurrentRepoShape()
        → resolveTagSha()
      → ensureGithubCliAvailableAndAuthenticated()
      → buildPlannedAnnualRows()
      → renderDiffStat()
      → renderReleaseBody()
      → upsertRelease()
```

### Key Interfaces (the contracts)
- `LegalMilestonesMetadata` in `src/milestones/types.ts` — committed metadata contract for `annual_snapshots[]` + `president_terms[]`
- `AnnualSnapshotRow` / `PresidentTermRow` — normalized row types after metadata validation
- `MilestonesPlan` — deterministic `plan`/`apply` JSON contract surfaced to stdout
- `PlannedAnnualRow` — annual row + resolved `commit_sha` + normalized `pl_tag`
- `MilestonesManifest` — repo-local persisted manifest contract under `.us-code-tools/milestones.json`
- `ReleaseCandidate` — Congress release planning and manifest freshness contract
- `SkippedPresidentTag` — machine-readable skipped-president diagnostics contract

## Conventions / Patterns
- Keep metadata validation in `src/milestones/metadata.ts` deterministic and explicit; do not split business rules across CLI, planner, and renderer.
- Reuse `resolveGitBinary()` / `resolveGhBinary()` and `git(...)`; do not introduce new bare-name `spawn('git', ...)` or `spawn('gh', ...)` call sites.
- Keep release publication serialized; `releaseMilestones()` intentionally loops one Congress release at a time.
- Preserve stable JSON ordering by building plan/manifest arrays from already-sorted metadata rows.
- Treat `.us-code-tools/milestones.lock` as part of the repo-local contract, not an implementation detail to silently bypass.
- If you modify repo cleanliness checks, keep the exclusion of tool-owned `.us-code-tools/*` files unless the spec changes.
- If you rename or reshape manifest fields, update both `normalizeManifestShape(...)` and `normalizeCurrentRepoShape(...)`; those two functions are the freshness comparison seam.

## Phase 1 Scope (Current)
- What's implemented:
  - existing transform pipeline
  - Constitution backfill command and CLI validation
  - static dataset, renderer, planner, target repo preflight, and git history orchestration
  - configured-remote push support without pre-existing upstream
  - fetch acquisition pipeline for all five issue #5 sources plus manifest/cache infrastructure
  - issue #8 OLRC compatibility work:
    - cookie-bootstrapped OLRC fetch flow
    - manifest-backed selected-vintage transform lookup
    - current `uscDoc` parser compatibility with namespace stripping
    - reserved-empty Title 53 handling
  - issue #10 parser correctness work:
    - non-empty `@_value` wins for title/chapter/section numbers even when display text disagrees
    - absent/empty `@_value` falls back to cleaned display `<num>` text
    - path-safe filenames depend on undecorated canonical section numbers reaching `sectionFileSafeId()`
  - issue #12 transform completeness work:
    - recursive hierarchy traversal for positive-law titles with deep `subtitle` / `part` / `subpart` / `subchapter` nesting
    - per-section hierarchy frontmatter + singular `source_credit`
    - statutory notes with preserved wrapper `noteType`
    - relative USC ref rendering and zero-padded section filenames
    - dedicated real-fixture coverage in `tests/unit/transforms/issue12-recursive-metadata.test.ts` and `tests/integration/issue12-transform-cli.test.ts`
  - issue #14 structured-body completeness work:
    - preserve section-level `chapeau` before numbered descendants
    - keep inline body text on labeled nodes from `<content>`, `<text>`, or `<p>`
    - preserve `continuation` text after nested descendants in the same parent
    - render first-class `subclause` and `subitem` nodes instead of dropping deep hierarchy levels
    - normalize bare labels to parenthesized markdown output without disturbing already-parenthesized labels
  - issue #16 chapter-grouped output work:
    - additive `TransformGroupBy = 'section' | 'chapter'` CLI/output contract
    - chapter files composed from existing section markdown with exact `heading: Chapter {chapter}` fallback when `TitleIR.chapters` lacks a match
    - `_uncategorized.md` + report-only `warnings[]` for sections missing `hierarchy.chapter`
    - pre-write normalized chapter filename collision rejection and non-zero exit on any chapter write failure
  - issue #21 historical OLRC fetch work:
    - additive fetch selectors `--list-vintages`, `--vintage=<pl-number>`, and `--all-vintages`
    - duplicate `--vintage` and malformed `--vintage` values fail in `parseFetchArgs()` before any OLRC discovery or disk mutation
    - `fetchOlrcVintagePlan()` is the one discovery pass for list/latest/single/all-vintages modes
    - `fetchDiscoveredOlrcVintage()` persists canonical per-vintage state and only updates the latest-mode mirror when `updateSelectedVintageMirror` is true
    - sparse historical vintages are expected: absent title links belong in `missing_titles`, not fabricated ZIP requests
- What's intentionally deferred:
  - additional backfill phases
  - auto-repair of internal-gap histories
  - downstream repo PR workflows
  - live Constitution fetching from external sources
  - appendix-title CLI support (`5a`, `11a`, `18a`, `28a`, `50a`)
  - stronger parser dependencies / persisted VoteView indexes; current code intentionally stays lightweight
- What's a test double vs production:
  - temp repos / bare remotes in tests are doubles
  - committed Constitution dataset and real git CLI orchestration are production paths
  - fixture upstream payloads are doubles; manifest/cache/source modules are production paths
