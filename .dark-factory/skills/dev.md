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
- `src/index.ts` — dispatches `transform`, `backfill`, and `fetch`
- `src/commands/fetch.ts` — fetch CLI parsing/dispatch/status output
- `src/backfill/constitution/dataset.ts` — static Constitution records + author metadata
- `src/backfill/renderer.ts` — Constitution markdown/frontmatter renderer
- `src/backfill/messages.ts` — exact historical commit-message templates
- `src/backfill/planner.ts` — 28-event plan builder
- `src/backfill/target-repo.ts` — repo prep / preflight / prefix detection / remote resolution
- `src/backfill/git-adapter.ts` — git wrapper + fast-import commit creation
- `src/backfill/orchestrator.ts` — applies missing suffix events and pushes current branch
- `src/sources/olrc.ts` — OLRC homepage bootstrap/cookie handling, `download.shtml` vintage discovery, ZIP acquisition + extraction, reserved-empty Title 53 classification, and selected-vintage cache resolution
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
- `src/index.ts` → `src/commands/fetch.ts`, `src/backfill/orchestrator.ts`, `src/sources/olrc.ts`, `src/transforms/uslm-to-ir.ts`, `src/transforms/write-output.ts` (issue #8: `transform` now resolves OLRC ZIPs via manifest-backed selected-vintage cache state instead of the legacy `.cache/olrc/title-XX` layout)
- `src/commands/fetch.ts` → `src/utils/manifest.ts`, `src/utils/fetch-config.ts`, every `src/sources/*.ts` fetch entrypoint (this file owns CLI contract + deterministic `--all` ordering)
- `src/sources/congress.ts` → `src/utils/cache.ts`, `src/utils/manifest.ts`, `src/utils/rate-limit.ts`, `src/utils/retry.ts`, `src/utils/logger.ts`, `src/sources/congress-member-snapshot.ts` (this source uses `getSharedApiDataGovLimiter()` and throws numeric `nextRequestAt` values that `normalizeError()` serializes into the public `next_request_at` field)
- `src/sources/congress-member-snapshot.ts` → `src/utils/manifest.ts` (freshness derives from manifest snapshot metadata + artifact existence)
- `src/sources/govinfo.ts` → `src/utils/cache.ts`, `src/utils/manifest.ts`, `src/utils/rate-limit.ts`, `src/utils/retry.ts`, `src/utils/logger.ts` (this source also uses `getSharedApiDataGovLimiter()` and preserves numeric `nextRequestAt` through `normalizeError()`)
- `src/sources/unitedstates.ts` → `src/utils/manifest.ts`, `src/sources/congress-member-snapshot.ts`, current Congress cache layout in `src/sources/congress.ts`
- `src/sources/voteview.ts` → `src/utils/manifest.ts` and its in-memory index cache (`inMemoryIndexes`)
- `src/sources/olrc.ts` → `src/domain/model.ts`, `src/domain/normalize.ts`, `src/types/yauzl.d.ts`, `src/utils/manifest.ts`, `src/utils/logger.ts` (issue #8: this module owns OLRC homepage bootstrap, in-memory cookie forwarding, `download.shtml` parsing, Title 53 `reserved_empty` classification, the 128 MiB large-title entry cap, and `resolveCachedOlrcTitleZipPath()`)
- `src/utils/cache.ts` → `src/utils/manifest.ts` consumers in Congress/GovInfo; cache key normalization strips `api_key`
- `src/utils/manifest.ts` → all fetch sources + `src/commands/fetch.ts` (manifest shape is the contract; issue #8 hardened `sources.olrc.titles[title]` into concrete `downloaded` vs `reserved_empty` states)
- `src/backfill/orchestrator.ts` → `src/backfill/planner.ts`, `src/backfill/constitution/dataset.ts`, `src/backfill/target-repo.ts`, `src/backfill/git-adapter.ts`
- `src/backfill/target-repo.ts` → `src/backfill/planner.ts`, `src/backfill/git-adapter.ts` (prefix checks depend on planned commit metadata and git inspection)
- `src/backfill/git-adapter.ts` → `src/backfill/planner.ts` (commit creation consumes `HistoricalEvent`)
- `src/backfill/planner.ts` → `src/backfill/constitution/dataset.ts`, `src/backfill/renderer.ts`, `src/backfill/messages.ts`
- `src/backfill/renderer.ts` → `src/backfill/constitution/dataset.ts`, `gray-matter`
- `src/backfill/messages.ts` → no downstream state; keep pure and template-exact
- `src/transforms/uslm-to-ir.ts` → `src/domain/model.ts`, `src/domain/normalize.ts`, `fast-xml-parser` (issue #8/#10/#12: parser config uses `removeNSPrefix: true`, root discovery falls back from `uscDoc.main.title` to `uslm.title`, canonical title/chapter/section numbers flow through `readCanonicalNumText(...)`, and recursive traversal now accumulates `subtitle`/`part`/`subpart`/`chapter`/`subchapter` context while `parseNotes()` emits `sourceCredit`, `statutoryNotes`, and note wrapper `noteType`)
- `src/transforms/markdown.ts` → `src/domain/model.ts`, `src/domain/normalize.ts`, `gray-matter` (issue #12: section frontmatter now serializes hierarchy keys + `source_credit`, `_title.md` must use `sortSections()`, and section prose may contain relative USC links generated from sanitized section ids)
- `src/transforms/write-output.ts` → `src/transforms/markdown.ts`, `src/utils/fs.ts`, `src/domain/model.ts`, `src/domain/normalize.ts` (issue #12: all section file paths must use zero-padded `sectionFileSafeId()` output)

### Call Chain: Entry Point → Your Code
```text
src/index.ts (main)
  → runFetchCommand()
    → parseFetchArgs()
    → runAllSources() | runSingleSource()
      → fetchOlrcSource()
        → fetchOlrcVintagePlan()
          → fetchWithRetry()
            → fetchWithOlrcCookies()
              → bootstrapOlrcSession()
        → getOrCreateZipPath()
          → fetchWithRetry()
          → classifyReservedEmptyPayload() / classifyReservedEmptyError()
        → extractXmlEntriesFromZip()
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
- `FetchArgs` in `src/commands/fetch.ts` — normalized CLI request for `fetch`
- `FetchManifest` in `src/utils/manifest.ts` — persisted acquisition state contract
- `OlrcTitleState` / `OlrcTitleReservedEmptyState` in `src/utils/manifest.ts` — per-title OLRC cache/result contract for issue #8
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
- `TitleIR`, `SectionIR`, `ParseError`, `XmlEntry`, `HierarchyIR`, `StatutoryNoteIR` in `src/domain/model.ts` — transform contracts, including issue #12 hierarchy and statutory-note metadata
- `splitSectionNumber(...)`, `compareSectionNumbers(...)`, `sectionFileSafeId(...)`, `sortSections(...)` in `src/domain/normalize.ts` — canonical section sort/pad/file-stem contract for issue #12
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
  - legislators cross-reference must delete stale `bioguide-crosswalk.json` whenever the result status is not `completed`
  - VoteView indexes are currently in-memory only via `inMemoryIndexes`, so repeated lookups in one process avoid reparsing but cross-process persistence is not implemented
- Summary/result objects are JSON-first and use spec-style keys like `requested_scope`, `bulk_scope`, `next_request_at`, and `last_success_at`.
- Issue #12 transform conventions:
  - never hand-roll section ordering in renderers/tests; use `sortSections()` / `compareSectionNumbers()`
  - never hand-roll section filenames or ref targets; use `sectionFileSafeId()` so writes and links stay aligned
  - slash-separated USC ref tails like `/us/usc/t10/s125/d` must be canonicalized before path generation; branch commit `07b954e` now collapses the slash tail in `hrefToMarkdownLink()` so links resolve to `section-00125d.md`
  - preserve suffix case in ordering and filenames (`106A` != `106a`)
  - mixed-case suffix ordering is part of the contract: `106` < `106A` < `106a` < `106b`; branch commit `07b954e` replaced locale-sensitive suffix sorting with direct codepoint comparison to keep that order deterministic
  - the remaining open issue #12 parser seam is mixed-content inline ordering: `readRawText()` still buckets `#text`/`text`/`p` ahead of other children, so source-credit and statutory-note text around inline `<ref>` / `<date>` nodes can be reordered or dropped
  - exact current seam at `bfc6502`: `readRawText()` concatenates `node['#text']`, `text`, `p`, `content`, `heading`, `num`, `chapeau`, `continuation`, `quotedContent`, and `inline` before a second `Object.entries(node)` walk for everything else; replace that two-pass rebuild with one document-order walker instead of patching individual child names
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
