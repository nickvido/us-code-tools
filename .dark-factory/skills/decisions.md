# Decisions

### ADR-001: Keep Issue #1 file-based only
- **Status:** Active
- **Context:** The approved spec/architecture scope is a single-process CLI transformer.
- **Decision:** Persist only cache artifacts, extracted XML in memory, and emitted markdown files. Do not add a database or HTTP API.
- **Consequence:** Future agents should not add ORM/server scaffolding to satisfy generic templates.
- **Feature:** #1 USLM XML to Markdown Transformer

### ADR-002: Preserve section identifiers as strings end-to-end
- **Status:** Active
- **Context:** US Code section ids may be alphanumeric or contain `/` (for example `36B`, `2/3`).
- **Decision:** `SectionIR.sectionNumber` stays a `string`; output filenames only replace `/` with `-`.
- **Consequence:** Do not numeric-coerce or normalize away letters/hyphens.
- **Feature:** #1 USLM XML to Markdown Transformer

### ADR-003: Process all XML files in ZIPs in lexical path order
- **Status:** Active
- **Context:** Title ZIPs may contain multiple XML files and nested paths.
- **Decision:** `extractXmlEntriesFromZip()` returns all accepted XML entries sorted lexically; `src/index.ts` merges all parsed sections into one `TitleIR`.
- **Consequence:** Multi-file archives remain deterministic and CI-testable. Exact `sectionNumber` collisions are treated as `INVALID_XML`, the colliding section is omitted, and the run exits non-zero.
- **Feature:** #1 USLM XML to Markdown Transformer

### ADR-004: Treat malformed sections as partial failures, not process-fatal failures
- **Status:** Active
- **Context:** The spec allows valid sections to be emitted even when some sections fail.
- **Decision:** `parseUslmToIr()` accumulates `ParseError[]`; section-local failures omit only the affected section.
- **Consequence:** CLI success depends on usable output being written, not on every section parsing perfectly.
- **Feature:** #1 USLM XML to Markdown Transformer

### ADR-005: Separate source credits from editorial notes in IR
- **Status:** Active
- **Context:** Review feedback required dedicated source-credit preservation.
- **Decision:** `parseNotes()` returns `{ sourceCredits, editorialNotes }`; `SectionIR.sourceCredits` is distinct from `editorialNotes`.
- **Consequence:** Downstream renderers/consumers can distinguish provenance metadata from editorial commentary.
- **Feature:** #1 USLM XML to Markdown Transformer

### ADR-006: Enforce bounded ZIP/XML parsing rules in production code
- **Status:** Active
- **Context:** Security review flagged path traversal, special entries, and oversized content as real risks.
- **Decision:** Reject unsafe ZIP entries, cap extraction sizes, use explicit parser config, and cap normalized field text at 1 MiB.
- **Consequence:** Security-sensitive rejection paths must keep regression tests.
- **Feature:** #1 USLM XML to Markdown Transformer

### ADR-007: Refuse symlinked intermediate output directories
- **Status:** Active
- **Context:** Output should not escape the operator-selected tree.
- **Decision:** `assertSafeOutputPath()` rejects symlinked path segments below the output root.
- **Consequence:** Some symlink-heavy local setups may fail intentionally.
- **Feature:** #1 USLM XML to Markdown Transformer

### ADR-008: Preserve structured report semantics when `_title.md` write fails
- **Status:** Active
- **Context:** Section file writes already accumulated `OUTPUT_WRITE_FAILED` parse errors; title metadata writes needed the same partial-failure behavior.
- **Decision:** `_title.md` write failures are converted into `OUTPUT_WRITE_FAILED` parse errors in `src/transforms/write-output.ts` and returned in `writeResult.parseErrors`.
- **Consequence:** Partial success is preserved while still surfacing the failure.
- **Feature:** #1 USLM XML to Markdown Transformer

### ADR-009: Treat the Constitution as committed static application data
- **Status:** Active
- **Context:** Constitution text is effectively static and later backfill phases need deterministic offline reuse.
- **Decision:** Store all 7 articles and 27 amendments directly in `src/backfill/constitution/dataset.ts` with metadata, author mapping, and markdown-ready text.
- **Consequence:** Backfill/test runs stay offline and reproducible; future agents should not add runtime fetches for this phase.
- **Feature:** #3 Constitution Backfill

### ADR-010: Group Articles I–VII into one foundational commit and commit each amendment separately
- **Status:** Active
- **Context:** The target history should model ratification events, with granular amendment history but one foundational Constitution event.
- **Decision:** `buildConstitutionPlan()` emits exactly 28 events: 1 Constitution event plus 27 amendment events, with Amendments I–X kept in numeric order on the shared `1791-12-15` date.
- **Consequence:** Resume/idempotency logic can reason over a fixed stable plan; do not merge Bill of Rights amendments into one commit.
- **Feature:** #3 Constitution Backfill

### ADR-011: Use commit metadata, not file diffs, to validate resume prefixes
- **Status:** Active
- **Context:** The tool must reject unrelated or internally gapped histories deterministically.
- **Decision:** `detectMatchingPrefix()` compares existing commits to the planned sequence by author name, author email, ratified date, and normalized full commit message from `git cat-file -p`.
- **Consequence:** History validation remains deterministic and strict; altered message/author/date metadata breaks prefix compatibility even if files happen to look similar.
- **Feature:** #3 Constitution Backfill

### ADR-012: Bootstrap only empty targets and reject populated non-git directories
- **Status:** Active
- **Context:** Operators may point `--target` at a missing path, empty directory, populated directory, or existing git repo.
- **Decision:** Missing or empty non-git directories are initialized with `git init`; populated non-git directories fail before any writes.
- **Consequence:** The tool avoids mutating unrelated content and matches the explicit spec preflight contract.
- **Feature:** #3 Constitution Backfill

### ADR-013: Historical commits are created with `git fast-import`
- **Status:** Active
- **Context:** The tool needs exact author/date control and deterministic multi-file historical commit creation.
- **Decision:** `commitHistoricalEvent()` streams a fast-import script containing author, committer, timestamp, commit message, and inline file blobs, then hard-resets the worktree to `HEAD`.
- **Consequence:** Exact historical metadata is preserved. Future agents should revalidate chronology/idempotency tests before replacing this with ordinary `git commit` flows.
- **Feature:** #3 Constitution Backfill

### ADR-014: Push the current branch explicitly when a remote exists
- **Status:** Active
- **Context:** Freshly initialized repos may have a configured remote but no upstream branch, and bare `git push` fails in that case.
- **Decision:** Resolve a remote name deterministically and run `git push --set-upstream <remote> <branch>`.
- **Consequence:** Configured-remote repos succeed without manual upstream setup; this behavior is protected by `tests/adversary-round1-issue3.test.ts`.
- **Feature:** #3 Constitution Backfill

### ADR-015: Use a manifest-backed filesystem cache for issue #5 acquisition state
- **Status:** Active
- **Context:** Issue #5 needs resumable source downloads, TTL-backed API cache reuse, and status reporting without introducing a database.
- **Decision:** Persist acquisition state only in `data/cache/{source}/` plus `data/manifest.json`, with source modules reading/writing through `src/utils/cache.ts` and `src/utils/manifest.ts`.
- **Consequence:** Future agents should update the manifest contract instead of adding hidden side-state or ad hoc metadata files.
- **Feature:** #5 Data Acquisition

### ADR-016: Congress member data is a reusable global snapshot, not a per-congress sub-fetch
- **Status:** Active
- **Context:** Congress member pages/details are reused across congress-specific bill/committee fetches and are the only valid input for legislators bioguide cross-reference.
- **Decision:** `src/sources/congress.ts` records a distinct `member_snapshot` in the manifest and reuses it when `evaluateCongressMemberSnapshotFreshness()` says it is still complete/fresh.
- **Consequence:** Future agents should not re-download `/member` data inside every congress loop or treat stale/incomplete snapshots as valid crosswalk input.
- **Feature:** #5 Data Acquisition

### ADR-017: Legislators cross-reference skip paths must remove stale success artifacts
- **Status:** Active
- **Context:** QA/adversary coverage found that a later stale-snapshot run could mark cross-reference as skipped while leaving an older `bioguide-crosswalk.json` on disk.
- **Decision:** `src/sources/unitedstates.ts` deletes `data/cache/legislators/bioguide-crosswalk.json` whenever `buildCrossReferenceState()` returns a non-`completed` status before manifest persistence.
- **Consequence:** Manifest state and filesystem artifacts stay consistent; future skip-path changes must preserve this cleanup behavior.
- **Feature:** #5 Data Acquisition

### ADR-018: Congress/GovInfo must share one in-process limiter singleton
- **Status:** Proposed / not yet implemented on current branch
- **Context:** The spec and architecture bind Congress.gov and GovInfo to one `API_DATA_GOV_KEY` budget, but the current branch creates separate `sharedLimiter` instances inside `src/sources/congress.ts` and `src/sources/govinfo.ts`.
- **Decision:** Centralize limiter state in shared infrastructure (expected under `src/utils/rate-limit.ts` or a sibling shared module) and have both sources consult/mutate that same singleton before request dispatch.
- **Consequence:** Until this lands, the branch can oversubscribe the single-key hourly budget across the two sources and remains adversary-rejected.
- **Feature:** #5 Data Acquisition

### ADR-019: Upstream `Retry-After` must map to the fetch exhaustion contract
- **Status:** Proposed / not yet implemented on current branch
- **Context:** The spec requires honoring `Retry-After`, but current Congress/GovInfo response handling turns throttle responses into generic `upstream_request_failed` errors.
- **Decision:** Parse `Retry-After` in shared retry/rate-limit infrastructure and surface it as `error.code="rate_limit_exhausted"` plus `next_request_at` instead of dropping the server-provided retry horizon.
- **Consequence:** Until this lands, operators cannot reliably resume from upstream-directed throttle windows and the branch remains out of spec.
- **Feature:** #5 Data Acquisition

## Phase 1 Scope (Current)
- What's implemented:
  - transform ADRs for issue #1
  - Constitution dataset/planner/render/git-history/push ADRs for issue #3
  - manifest/cache/member-snapshot/crosswalk ADRs for issue #5
- What's intentionally deferred:
  - later backfill phases and their own ADRs
  - history repair/rewrite semantics for non-prefix repos
- What's a test double vs production:
  - temp repos and local bare remotes are test doubles; committed Constitution dataset, acquisition manifest/cache, and git orchestration are production design choices
