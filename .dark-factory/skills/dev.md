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
- `src/sources/olrc.ts` — OLRC ZIP acquisition + extraction + latest-vintage selection
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
- `src/index.ts` → `src/commands/fetch.ts`, `src/backfill/orchestrator.ts`, `src/sources/olrc.ts`, `src/transforms/uslm-to-ir.ts`, `src/transforms/write-output.ts`
- `src/commands/fetch.ts` → `src/utils/manifest.ts`, `src/utils/fetch-config.ts`, every `src/sources/*.ts` fetch entrypoint (this file owns CLI contract + deterministic `--all` ordering)
- `src/sources/congress.ts` → `src/utils/cache.ts`, `src/utils/manifest.ts`, `src/utils/rate-limit.ts`, `src/utils/logger.ts`, `src/sources/congress-member-snapshot.ts`
- `src/sources/congress-member-snapshot.ts` → `src/utils/manifest.ts` (freshness derives from manifest snapshot metadata + artifact existence)
- `src/sources/govinfo.ts` → `src/utils/cache.ts`, `src/utils/manifest.ts`, `src/utils/rate-limit.ts`, `src/utils/logger.ts`
- `src/sources/unitedstates.ts` → `src/utils/manifest.ts`, `src/sources/congress-member-snapshot.ts`, current Congress cache layout in `src/sources/congress.ts`
- `src/sources/voteview.ts` → `src/utils/manifest.ts` and its in-memory index cache (`inMemoryIndexes`)
- `src/sources/olrc.ts` → `src/domain/model.ts`, `src/domain/normalize.ts`, `src/types/yauzl.d.ts`, manifest expectations for selected vintage + per-title state
- `src/utils/cache.ts` → `src/utils/manifest.ts` consumers in Congress/GovInfo; cache key normalization strips `api_key`
- `src/utils/manifest.ts` → all fetch sources + `src/commands/fetch.ts` (manifest shape is the contract)
- `src/backfill/orchestrator.ts` → `src/backfill/planner.ts`, `src/backfill/constitution/dataset.ts`, `src/backfill/target-repo.ts`, `src/backfill/git-adapter.ts`
- `src/backfill/target-repo.ts` → `src/backfill/planner.ts`, `src/backfill/git-adapter.ts` (prefix checks depend on planned commit metadata and git inspection)
- `src/backfill/git-adapter.ts` → `src/backfill/planner.ts` (commit creation consumes `HistoricalEvent`)
- `src/backfill/planner.ts` → `src/backfill/constitution/dataset.ts`, `src/backfill/renderer.ts`, `src/backfill/messages.ts`
- `src/backfill/renderer.ts` → `src/backfill/constitution/dataset.ts`, `gray-matter`
- `src/backfill/messages.ts` → no downstream state; keep pure and template-exact
- `src/transforms/write-output.ts` → `src/transforms/markdown.ts`, `src/utils/fs.ts`, `src/domain/model.ts`

### Call Chain: Entry Point → Your Code
```text
src/index.ts (main)
  → runFetchCommand()
    → parseFetchArgs()
    → runAllSources() | runSingleSource()
      → fetchOlrcSource()
        → fetchOlrcVintagePlan()
        → getOrCreateZipPath()
        → extractXmlEntriesFromZip()
        → writeManifest()
      → fetchCongressSource()
        → resolveCurrentCongressScope()
        → ensureMemberSnapshot()
          → evaluateCongressMemberSnapshotFreshness()
        → fetchSingleCongress()
          → fetchCongressResponse()
            → readFreshRawResponseCache() / writeRawResponseCache()
            → isRateLimitExhausted() / markRateLimitUse()
        → writeManifest()
      → fetchGovInfoSource()
        → fetchGovInfoResponse()
          → readFreshRawResponseCache() / writeRawResponseCache()
          → isRateLimitExhausted() / markRateLimitUse()
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
  → runBackfillCommand()
    → runConstitutionBackfill()
      → buildConstitutionPlan(constitutionDataset)
      → prepareTargetRepo()
      → commitHistoricalEvent()
```

### Key Interfaces (the contracts)
- `FetchArgs` in `src/commands/fetch.ts` — normalized CLI request for `fetch`
- `FetchManifest` in `src/utils/manifest.ts` — persisted acquisition state contract
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
- `TitleIR`, `SectionIR`, `ParseError`, `XmlEntry` in `src/domain/model.ts` — existing transform contracts

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
  - Congress and GovInfo each define a module-local `sharedLimiter`; they are structurally identical but not a single shared singleton across modules, so be careful if you change rate-limit behavior
  - legislators cross-reference must delete stale `bioguide-crosswalk.json` whenever the result status is not `completed`
  - VoteView indexes are currently in-memory only via `inMemoryIndexes`, so repeated lookups in one process avoid reparsing but cross-process persistence is not implemented
- Summary/result objects are JSON-first and use spec-style keys like `requested_scope`, `bulk_scope`, `next_request_at`, and `last_success_at`.

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
- What's intentionally deferred:
  - additional backfill phases
  - auto-repair of internal-gap histories
  - downstream repo PR workflows
  - live Constitution fetching from external sources
  - stronger parser dependencies / persisted VoteView indexes; current code intentionally stays lightweight
- What's a test double vs production:
  - temp repos / bare remotes in tests are doubles
  - committed Constitution dataset and real git CLI orchestration are production paths
  - fixture upstream payloads are doubles; manifest/cache/source modules are production paths
