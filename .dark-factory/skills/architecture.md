# Architecture

## Current System
- Single-package Node.js CLI in `src/index.ts` with three command paths:
  - `transform --title <number> --output <dir>`
  - `backfill --phase constitution --target <dir>`
  - `fetch (--status | --all | --source=<name>) [--congress=<n>] [--force]`
- No database, HTTP API, queue, or background worker.
- The repo now has three major flows:
  1. OLRC USLM XML → IR → markdown (`transform`)
  2. Static Constitution dataset → planned historical events → rendered files + backdated git history (`backfill`)
  3. Raw-source acquisition + manifest-backed caching for OLRC, Congress.gov, GovInfo, VoteView, and UnitedStates (`fetch`)
- Issue #8 hardened the OLRC flow to the current releasepoint site:
  - `src/sources/olrc.ts` bootstraps an in-memory OLRC session from `https://uscode.house.gov/`
  - listing discovery now prefers `https://uscode.house.gov/download/download.shtml`
  - per-title OLRC manifest state distinguishes `status: 'downloaded'` vs `status: 'reserved_empty'`
  - `src/transforms/uslm-to-ir.ts` accepts both legacy `uslm.title` and current `uscDoc.main.title`

## Codebase Map
- `src/index.ts` — top-level CLI dispatcher, arg parsing, usage/error text, process exit policy.
- `src/commands/fetch.ts` — `fetch` CLI arg validation, `--status`, single-source dispatch, deterministic `--all` order.
- `src/domain/` — transform-only IR and normalization helpers for USLM ingestion.
- `src/sources/olrc.ts` — OLRC homepage bootstrap + in-memory cookie jar, `download.shtml` releasepoint scrape, latest-vintage selection, per-title ZIP download/extraction, reserved-empty Title 53 classification, transform ZIP helpers, and manifest-backed cache resolution for `transform`.
- `src/sources/congress.ts` — Congress.gov bulk fetch orchestration, shared-rate-limit use, member snapshot reuse, congress checkpoint updates.
- `src/sources/congress-member-snapshot.ts` — freshness evaluation for the reusable Congress global-member snapshot.
- `src/sources/govinfo.ts` — GovInfo PLAW walk, checkpointed resume state, retained-package summary/granule finalization.
- `src/sources/voteview.ts` — static CSV download plus in-memory indexes for congress/member lookups.
- `src/sources/unitedstates.ts` — YAML download, lightweight parsing, Congress-snapshot-based bioguide crosswalk generation/skip handling.
- `src/utils/cache.ts` — raw response cache keying, TTL reads, atomic body/metadata writes.
- `src/utils/manifest.ts` — manifest schema normalization, empty-manifest defaults, atomic manifest writes.
- `src/utils/fetch-config.ts` — current Congress resolution (`override`/`live`/`fallback`) and fallback warning path.
- `src/utils/logger.ts` — structured network logging with `api_key` redaction.
- `src/utils/rate-limit.ts` — sliding-window limiter helpers plus the shared `getSharedApiDataGovLimiter()` singleton/reset hook used by both `src/sources/congress.ts` and `src/sources/govinfo.ts` for the single `API_DATA_GOV_KEY` in-process budget.
- `src/transforms/` — namespace-tolerant USLM parsing (`uscDoc.main.title` + legacy `uslm.title`), markdown rendering, and output writing for `transform`.
- issue #10 tightened canonical number extraction inside `src/transforms/uslm-to-ir.ts`: title/chapter/section `<num>` reads now prefer `@_value` and only fall back to cleaned display text when the attribute is absent/empty.
- issue #12 extended the transform architecture from a fixed `title -> chapter -> section` walk to recursive hierarchy traversal with accumulated per-section frontmatter context:
  - `src/domain/model.ts` now carries `HierarchyIR`, singular `sourceCredit`, and `statutoryNotes` (`noteType`, `topic`, `heading`, `text`) on `SectionIR`
  - `src/domain/normalize.ts` now owns canonical section ordering via `splitSectionNumber()`, `compareSectionNumbers()`, `sectionFileSafeId()`, and `sortSections()`
  - `src/transforms/uslm-to-ir.ts` recursively walks `subtitle`, `part`, `subpart`, `chapter`, and `subchapter` containers, preserving hierarchy context on every parsed section
  - `src/transforms/markdown.ts` now serializes hierarchy keys as top-level frontmatter, emits `source_credit`, renders `## Statutory Notes`, and uses relative links for transformable `/us/usc/t{title}/s{section}` refs
  - `src/transforms/write-output.ts` writes zero-padded section filenames like `section-00001.md`
- `src/backfill/constitution/dataset.ts` — committed Constitution dataset (7 articles, 27 amendments) plus metadata/author mapping.
- `src/backfill/renderer.ts` — deterministic YAML frontmatter + markdown rendering for Constitution provisions.
- `src/backfill/messages.ts` — exact Constitution/amendment commit-message formatting.
- `src/backfill/planner.ts` — pure 28-event plan builder (`constitution` + `amendment-01..27`).
- `src/backfill/target-repo.ts` — target directory bootstrap, attached-HEAD check, clean-tree preflight, prefix-history detection, push-remote resolution.
- `src/backfill/git-adapter.ts` — git CLI wrapper, UTC commit env construction, and `git fast-import` historical commit creation.
- `src/backfill/orchestrator.ts` — end-to-end Constitution backfill execution + push classification.
- `tests/cli/fetch.test.ts` — fetch CLI contract and `--all`/`--status` behavior.
- `tests/utils/` — fetch-config, manifest, rate-limit, and helper coverage.
- `tests/adversary-round1-issue5.test.ts` … `tests/adversary-round9-issue5.test.ts` — issue #5 regression chain, including stale crosswalk cleanup.

## Backfill Data Model
- `ConstitutionDataset` in `src/backfill/constitution/dataset.ts`
  - `constitution.signed`, `ratified`, `ratifiedDetail`, `source`, `authorName`, `authorEmail`
  - `constitution.articles: ConstitutionProvisionRecord[]`
  - `amendments: ConstitutionProvisionRecord[]`
- `ConstitutionProvisionRecord`
  - `type: 'article' | 'amendment'`
  - `number: number`
  - `romanNumeral: string`
  - `heading: string`
  - `proposed: string`
  - `ratified: string`
  - `proposing_body: string`
  - `proposingBody: string`
  - `authorName: string`
  - `authorEmail: string`
  - `source: string`
  - `markdownBody: string`
- `HistoricalEvent` in `src/backfill/planner.ts`
  - `sequence`, `slug`, `ratified`, `ratifiedDate`, `authorName`, `authorEmail`, `commitMessage`, `writes`
- `BackfillSummary` in `src/backfill/orchestrator.ts`
  - `phase`, `target`, `eventsPlanned`, `eventsApplied`, `eventsSkipped`, `pushResult`

## Backfill Flow
1. `src/index.ts` parses `backfill --phase constitution --target <dir>`.
2. `runConstitutionBackfill(target)` loads static dataset and builds the 28-event plan.
3. `prepareTargetRepo()`:
   - creates/init's a missing target dir
   - `git init`s an existing empty non-git dir
   - rejects populated non-git dirs
   - rejects detached HEAD
   - rejects dirty working trees
   - allows only empty history or an exact contiguous prefix of the Constitution plan
   - resolves push remote via `branch.<name>.pushRemote` → `branch.<name>.remote` → `origin` → first remote
4. Orchestrator writes each missing event’s files to deterministic paths under `constitution/`.
5. `commitHistoricalEvent()` creates backdated commits via `git fast-import`, then hard-resets the working tree to `HEAD`.
6. If a push remote exists, orchestrator runs `git push --set-upstream <remote> <branch>`; otherwise it reports local-only success.

## Rendering / History Contracts
- First event writes all seven article files in a single commit dated `1788-06-21`.
- Events 2–28 each write exactly one amendment file.
- Markdown frontmatter keys are fixed to:
  - `type`
  - `number`
  - `heading`
  - `ratified`
  - `proposed`
  - `proposing_body`
  - `source`
- Article paths: `constitution/article-I.md` … `constitution/article-VII.md`
- Amendment paths: `constitution/amendment-01.md` … `constitution/amendment-27.md`
- Commit messages come only from `src/backfill/messages.ts`; matching-prefix detection compares author name/email, ratified date, and full normalized commit message.

## Fetch Acquisition Model
- `fetch` persists only to `data/cache/{source}/` and `data/manifest.json`; no database layer exists.
- Cache split:
  - permanent file artifacts: OLRC ZIP/XML, VoteView CSVs, legislators YAML/crosswalk
  - TTL-governed raw API responses: Congress + GovInfo via `src/utils/cache.ts`
- Manifest state tracked in `src/utils/manifest.ts` includes:
  - per-source `last_success_at` / `last_failure`
  - OLRC `selected_vintage` plus per-title `status: 'downloaded' | 'reserved_empty'`
  - Congress `bulk_scope`, `member_snapshot`, `congress_runs`, `bulk_history_checkpoint`
  - GovInfo `query_scopes` and `checkpoints`
  - legislators `cross_reference` state with explicit skip statuses
- Congress global-member snapshot is intentionally separate from per-congress bill/committee runs. `src/sources/unitedstates.ts` may use it only when the latest snapshot is both `status: 'complete'` and still fresh per `evaluateCongressMemberSnapshotFreshness()`.
- `fetch --all` runs sources serially in fixed order: `olrc`, `congress`, `govinfo`, `voteview`, `legislators`.
- Current-congress resolution in `src/utils/fetch-config.ts` is process-cached and can be `override`, `live`, or `fallback`; fallback marks the bulk scope as degraded/operator-review-required.

## Security-Relevant Architecture Notes
- Target bootstrap is intentionally strict:
  - empty non-git directory → initialize in place
  - populated non-git directory → deterministic failure
- Existing git targets must be clean before any backfill writes.
- Resume semantics are intentionally narrow: only contiguous Constitution prefixes are allowed.
- Historical timestamps are fixed to exact UTC midnight values using `YYYY-MM-DDT00:00:00+0000`.
- Push failures do not rewrite history; local commits remain intact for rerun.
- Fetch-path safety/hardening now also matters:
  - manifest and raw-response cache writes are temp-file + rename atomic writes
  - cache artifacts are written `0640`; manifest is written `0600`
  - structured logs redact `api_key` query params via `src/utils/logger.ts`
  - Congress/GovInfo stop immediately on limiter exhaustion and return `next_request_at` instead of sleeping until the next window
  - legislators skip states must not leave a stale `data/cache/legislators/bioguide-crosswalk.json` on disk
  - Congress and GovInfo now both consult the shared in-process limiter singleton from `src/utils/rate-limit.ts`, so one process no longer keeps separate per-source budgets for the same `API_DATA_GOV_KEY`
  - Congress/GovInfo `429` handling now keeps `nextRequestAt` numeric through the throw path and converts it to ISO only in `normalizeError()`, preserving the public `next_request_at` summary
  - OLRC cookie state is memory-only inside `src/sources/olrc.ts`; it must never be persisted in manifest/cache metadata/output
  - OLRC releasepoint discovery is `download.shtml`-first and only Title 53 may be downgraded to `reserved_empty`
  - OLRC ZIP extraction now tolerates current large-title payloads via the 128 MiB large-entry ceiling while keeping bounded extraction caps

## Things Future Agents Should Notice
- Issue #10 centralizes `<num>` normalization in `readCanonicalNumText(...)`; do not re-implement title/chapter/section cleanup at each call site.
- Issue #12 makes recursive hierarchy traversal the production path. Do not add new fixed-depth loops that assume sections only live directly under `<title>` or `<chapter>`.
- Hierarchy preservation is not just parser IR now; rendered section markdown is required to serialize present `subtitle`, `part`, `subpart`, `chapter`, and `subchapter` keys and omit absent ones.
- `src/domain/normalize.ts` is now the single normalization boundary for section sort order and file stems. `_title.md` ordering, section filenames, and USC ref targets must all flow through the same helpers.
- `sectionFileSafeId()` pads the leading numeric root to width 5 and preserves trailing suffixes/case, so examples like `106A`, `106a`, `106b`, and `2/3` remain distinct and stable.
- Branch commit `07b954e` fixed the earlier issue #12 adversary seams around slash-separated `/us/usc/t10/s125/d` refs and equal-root mixed-case suffix ordering (`106 < 106A < 106a < 106b`).
- Current head `2fb5c52` completes the remaining mixed-content seam in `src/transforms/uslm-to-ir.ts`: the module now dual-parses XML with a preserve-order tree and routes section body parsing, `sourceCredit`, and statutory-note extraction through ordered-text helpers (`readOrderedRawText(...)`, `readOrderedNodeText(...)`, `parseNotesOrdered(...)`) so inline `<ref>` / `<date>` siblings keep source document order.
- `src/transforms/uslm-to-ir.ts` still keeps the legacy object-tree helpers (`readRawText(...)`, `readNodeTextInDocumentOrder(...)`) for non-preserve-order call sites, but issue #12 correctness now depends on the ordered path found via `findOrderedTitleNode(...)` / `collectOrderedSectionNodes(...)` rather than the older bucketed reconstruction.
- Current issue #12 fixture coverage is centered on Titles 1, 5, 10, and 26 plus the deterministic numeric-title integration matrix and reserved-empty Title 53 negative path.
- PR #13 is open and no longer draft; the latest issue comments show `[dev]` and `[adversary-review]` both approved with no remaining blocker on issue #12.
- Under the current `fast-xml-parser` config (`ignoreAttributes: false`, `attributeNamePrefix: '@_'`, `removeNSPrefix: true`), canonical USLM `value` attributes are read as `node['@_value']` even on `uscDoc` inputs.
- Current Title 1 fixture coverage now assumes the XSD-shaped `uscDoc > meta + main > title > chapter > section` structure with decorated display `<num>` text and clean canonical `@value` strings.
- `docs/architecture/3-architecture.md` proposes an `authors.ts` split, but the current implementation keeps author identity inside `src/backfill/constitution/dataset.ts`; do not assume a separate author module exists.
- `git-adapter.ts` exposes `buildGitCommitEnv()` for unit coverage, but actual commit creation uses `git fast-import` instead of `git commit`.
- Prefix validation keys off commit metadata, not file diffs.

## Phase 1 Scope (Current)
- What's implemented:
  - original Title 1 USLM transform flow
  - Constitution static dataset and renderer
  - 28-event historical planner
  - deterministic backdated git history creation
  - target-repo bootstrap/preflight/resume logic
  - push classification: `pushed` vs `skipped-local-only`
  - issue #5 acquisition layer:
    - `fetch` CLI in `src/commands/fetch.ts`
    - OLRC latest-vintage bulk acquisition under `data/cache/olrc/`
    - Congress.gov per-congress acquisition + reusable global member snapshot
    - GovInfo PLAW walk with checkpointed resume state
    - VoteView CSV download + in-memory lookup indexes
    - UnitedStates YAML download + optional bioguide crosswalk
    - manifest-backed source status and raw-response caching
  - issue #8 OLRC compatibility layer:
    - homepage bootstrap + in-memory cookie propagation for OLRC requests
    - `download.shtml` listing scrape with releasepoint URL parsing
    - per-title OLRC manifest states for `downloaded` vs `reserved_empty`
    - `resolveCachedOlrcTitleZipPath()` so `transform` reads the selected-vintage cache layout
    - `uscDoc.main.title` parsing with namespace tolerance and legacy `uslm.title` fallback
    - larger bounded OLRC XML entry allowance for current Title 42
  - issue #10 canonical `<num>` extraction layer:
    - `readCanonicalNumText(...)` prefers non-empty `@_value` for title/chapter/section numbers
    - fallback `cleanDecoratedNumText(...)` strips leading `§`, `Title `, `Chapter ` and trailing mixed `.` / `—` decoration
    - current Title 1 `uscDoc` fixture asserts `titleIr.chapters.length === 1`, 53 sections, `/us/usc/t1/s...` identifiers, and per-section/per-chapter equality with source `<num @value>` values
    - multi-title current-format integration coverage derives titles `2..54` (excluding reserved-empty `53`) from the committed Title 1 fixture via `buildCurrentFormatFixtureZip(...)`
  - issue #12 recursive hierarchy + metadata layer:
    - parser now discovers sections beneath `subtitle`, `part`, `subpart`, `chapter`, and `subchapter` at arbitrary nesting depth under `<title>`
    - section markdown frontmatter serializes every present hierarchy level as its own top-level key
    - `sourceCredit` is emitted as singular `source_credit` frontmatter
    - statutory notes are rendered under `## Statutory Notes` and preserve wrapper `noteType` plus note `topic`
    - transformable USC refs render as relative markdown links using the same zero-padded filename helper as actual output files
    - section output names are zero-padded (`section-00001.md`, `section-00106a.md`, `section-00002-3.md`) and `_title.md` uses the same canonical sort order
    - real recursive fixtures live at `tests/fixtures/xml/title-05/05-part-chapter-sections.xml`, `tests/fixtures/xml/title-10/10-subtitle-part-chapter-sections.xml`, and `tests/fixtures/xml/title-26/26-deep-hierarchy-sections.xml`
  - unit, integration, snapshot, and adversary coverage for issues #3, #5, #8, #10, and #12
- What's intentionally deferred:
  - non-Constitution backfill phases that consume fetched artifacts
  - rewriting/repairing non-prefix histories
  - force-push/rebase/history rewrite automation
  - network fetching of Constitution text at runtime
  - GitHub/PR automation for downstream `us-code`
  - a database-backed ingestion/indexing layer; issue #5 remains filesystem-first by design
- What's a test double vs production:
  - committed Constitution dataset is production application data, not a test double
  - temp git repos in tests are intentional doubles for downstream repositories
  - bare remotes in adversary tests are intentional doubles for configured push remotes
  - fixture payloads for OLRC/Congress/GovInfo/VoteView/legislators are intentional doubles for upstream sources; the manifest/cache/state-machine code paths are production paths
