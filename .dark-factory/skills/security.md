# Security Notes

## Trust Boundary
- Untrusted inputs:
  - CLI flags (`transform`, `backfill`, and `fetch`)
  - target path contents and git metadata in the downstream repo
  - existing target-repo history/branch state
  - configured remote behavior during `git push`
  - remote OLRC ZIP/XML payloads for the transform flow
  - all upstream acquisition payloads for issue #5: OLRC listing/ZIPs, Congress.gov JSON, GovInfo JSON, VoteView CSV, UnitedStates YAML
  - persisted manifest/cache contents read back from disk
- Trusted application data:
  - committed Constitution dataset in `src/backfill/constitution/dataset.ts`

## Implemented Controls

### Fetch / Acquisition Safety
- `src/commands/fetch.ts`
  - rejects invalid selector combinations with JSON `error.code="invalid_arguments"` and exit `2`
  - preserves fail-open behavior in `--all`: later sources still run after earlier source failures
- `src/utils/cache.ts`
  - normalizes raw-response cache URLs by removing `api_key`
  - writes raw body + metadata via temp file + rename
  - reuses TTL-fresh Congress/GovInfo API responses when `--force` is not set
- `src/utils/manifest.ts`
  - normalizes missing/corrupt partial source state back to canonical defaults
  - writes `data/manifest.json` atomically with mode `0600`
- `src/utils/logger.ts`
  - redacts `api_key` query values before network events hit stderr
  - emits allowlisted scalar fields only (`source`, `method`, `url`, `attempt`, `cache_status`, `duration_ms`, `status_code`)
- `src/utils/fetch-config.ts`
  - only uses `API_DATA_GOV_KEY` for Congress/GovInfo auth
  - falls back to a hardcoded Congress floor only after failed live resolution and logs a warning event
- `src/utils/rate-limit.ts`
  - enforces sliding-window exhaustion with a machine-readable `nextRequestAt`
  - interactive runs stop on exhaustion instead of waiting for the next hour
  - exports `getSharedApiDataGovLimiter()` / `resetSharedApiDataGovLimiter()`, and both `src/sources/congress.ts` and `src/sources/govinfo.ts` now use that singleton for one in-process `API_DATA_GOV_KEY` budget
- `src/sources/congress-member-snapshot.ts`
  - treats the Congress member snapshot as reusable only when status is `complete`, `snapshot_completed_at + cache_ttl_ms` is still fresh, and every referenced artifact still exists on disk
- `src/sources/unitedstates.ts`
  - skips cross-reference unless the latest Congress snapshot is complete and fresh
  - deletes stale `bioguide-crosswalk.json` on skip paths so manifest state and disk state cannot disagree

### Backfill Target Safety
- `src/backfill/target-repo.ts`
  - rejects `--target` when it resolves to a non-directory filesystem object
  - initializes missing target paths with `git init`
  - initializes existing empty non-git directories in place
  - rejects populated non-git directories before writing files or initializing git
  - rejects detached HEAD targets
  - rejects any dirty working tree via `git status --porcelain`

### History Integrity / Idempotency
- `detectMatchingPrefix()` only accepts:
  - empty history, or
  - an exact contiguous prefix of the 28-event Constitution plan
- Existing history is matched by:
  - author name
  - author email
  - ratified date
  - normalized full commit message
- Repos with unrelated commits or internal gaps are rejected rather than repaired in place.
- Push failure preserves local commits and causes a non-zero exit instead of retrying or rewriting history automatically.

### Historical Timestamp Safety
- `buildGitCommitEnv()` in `src/backfill/git-adapter.ts` validates `YYYY-MM-DD` dates and produces exact UTC-midnight strings:
  - `GIT_AUTHOR_DATE=YYYY-MM-DDT00:00:00+0000`
  - `GIT_COMMITTER_DATE=YYYY-MM-DDT00:00:00+0000`
- Actual historical commit creation uses `git fast-import` with Unix timestamps derived from the same UTC date, preventing local-time drift.

### Git Execution Safety
- `src/backfill/git-adapter.ts`
  - shells out only to `git`
  - sets deterministic fallback committer identity (`us-code-tools <sync@us-code-tools.local>`) if the operator has none configured
  - creates historical commits without amend/rebase/force-push behavior
- `src/backfill/orchestrator.ts`
  - pushes only when a remote is configured
  - uses explicit branch push: `git push --set-upstream <remote> <branch>`
  - reports `skipped-local-only` for repos without remotes instead of failing

### Existing Transform Controls
- `src/sources/olrc.ts` still enforces ZIP/XML hardening:
  - rejects unsafe/non-regular entries
  - rejects duplicate normalized destinations
  - enforces extraction-size caps
  - uses a bounded 128 MiB large-title per-entry ceiling plus total extracted XML cap for current OLRC compatibility
  - validates cached/downloaded ZIP openability with `yauzl`
- `src/transforms/uslm-to-ir.ts`
  - strips namespace prefixes in parser configuration (`removeNSPrefix: true`)
  - accepts `uscDoc.main.title` first and falls back to legacy `uslm.title`
  - keeps section identifiers as strings through the current-format parser path
  - prefers non-empty `node['@_value']` for title/chapter/section `<num>` extraction and only falls back to cleaned display text when the attribute is absent/empty
  - removes mixed trailing display decoration (`.` / `—`) in one pass so canonical numbers cannot retain path-unsafe punctuation
  - issue #12 recursively traverses nested hierarchy containers, but hierarchy keys come only from normalized container `<num>` values rather than arbitrary heading text
  - issue #12 renders USC ref links only when identifiers match the narrow `/us/usc/t{title}/s{section}` pattern; unknown refs fall back to plain text instead of malformed links
  - issue #14 preserves structured body order using the same preserve-order XML path, so `chapeau`, inline labeled-node text, nested children, and `continuation` text stay attached to the correct sibling/parent instead of being bucketed or reordered
  - issue #14 renders deep hierarchy nodes through `subitem`; dropping `subclause`/`subitem` is now a correctness/integrity bug rather than an acceptable simplification
  - issue #16 keeps chapter output path safety behind the normalization boundary in `src/domain/normalize.ts`; raw `hierarchy.chapter` values must never be interpolated directly into filenames
  - issue #16 treats uncategorized sections as report-only `warnings[]` and routes them to `_uncategorized.md`; they are intentionally not parse errors and must not change a successful exit on their own
  - issue #16 rejects normalized chapter filename collisions before any chapter write (`A-B` vs `A / B` -> same `chapter-a-b.md`) so one bucket cannot silently overwrite another
  - issue #16 requires non-zero exit on any `OUTPUT_WRITE_FAILED` chapter-mode partial write even if `_title.md` and another chapter file succeeded
- `src/domain/normalize.ts`
  - is the intended single sanitization boundary for section sort/file/link identifiers via `splitSectionNumber()`, `compareSectionNumbers()`, and `sectionFileSafeId()`
  - pads only the leading numeric root to width 5 while preserving suffix case
  - branch commit `07b954e` restored the intended boundary behavior for slash-separated USC ref tails by collapsing `/us/usc/t10/s125/d` to the same canonical section id used for filenames (`section-00125d.md`)
- `src/transforms/uslm-to-ir.ts`
  - now uses a preserve-order parse path for the security-sensitive mixed-content surfaces added by issue #12: section prose, `sourceCredit`, and statutory notes are read from ordered child arrays so inline `<ref>` / `<date>` nodes retain surrounding plain text in source order
  - still keeps the non-preserve-order object tree for legacy parsing and metadata extraction, but the production safety/correctness boundary for mixed content is the ordered helper family (`readOrderedRawText(...)`, `readOrderedNodeText(...)`, `parseNotesOrdered(...)`)
  - dual parsing does not add outbound surface area or new trust boundaries; it only changes how untrusted XML is normalized before markdown/frontmatter/path reuse
- `src/utils/fs.ts` still enforces safe output-root containment for transform output.

## Security Decisions with Rationale
- **Strict non-git directory handling:** avoids initializing over pre-existing content and accidentally mutating unrelated operator files.
- **Clean-tree preflight:** avoids mixing historical backfill writes with operator changes and makes failures easier to inspect.
- **Contiguous-prefix-only resume:** prevents ambiguous repair behavior and stops the tool from silently appending foundational history after unrelated commits.
- **Explicit branch push:** prevents configured-remote repos without upstream from failing at the final network step.
- **Static Constitution dataset:** keeps the backfill path offline and deterministic; no runtime trust in external text sources.
- **Manifest/cache as the only persistence layer for issue #5:** avoids hidden state and keeps partial-write safety testable.
- **Redacted structured logging:** prevents `API_DATA_GOV_KEY` leakage in stderr logs while still preserving request observability.
- **Skip-path crosswalk cleanup:** a skipped legislators cross-reference is not allowed to leave a stale success artifact behind; this is both correctness and data-integrity hardening.
- **OLRC cookie jar stays in-memory only:** `src/sources/olrc.ts` may forward the session cookie for homepage/listing/ZIP requests during one fetch operation, but it must never persist into manifest JSON, cache metadata, logs, or markdown output.
- **Reserved-empty downgrade is Title-53-only:** current unreadable/non-zip/empty payload handling is intentionally narrow so other title failures remain operator-visible instead of being silently reclassified.
- **Canonical `@value` wins over decorated display text:** when `<num value="7">§ 8.</num>` disagrees, the parser must emit `7` because the XSD defines `@value` as machine-readable canonical data; future agents should not add reconciliation or warning logic that rewrites canonical numbers from the display string.
- **Fallback cleanup is path-safety hardening, not cosmetic formatting:** `cleanDecoratedNumText(...)` exists to keep `sectionFileSafeId()` inputs undecorated so filenames like `section-§-1..md` never appear.
- **Issue #12 centralizes XML-derived identifier reuse behind one normalization boundary:** hierarchy numbers, section filenames, `_title.md` ordering, and relative USC ref targets must all flow through shared normalization helpers before being reused in paths, links, or frontmatter.
- **Issue #12 keeps ref rendering fail-closed:** only recognized USC section identifiers become links; legislative-history and non-USC refs remain plain text so markdown cannot contain broken or unsafe `[]()` targets.
- **Issue #14 preserves sibling isolation by source order, not tag buckets:** `continuation` text belongs after nested children of the same parent node, and the ordered parser path is the control that prevents it from drifting onto siblings or being emitted too early.
- **Issue #14 label normalization is output hardening, not semantic rewriting:** markdown rendering may add missing parentheses around bare labels like `1` → `(1)`, but it must not double-wrap already normalized labels or rewrite the canonical machine-readable label value used elsewhere.
- **Issue #16 keeps chapter filename normalization as the sole filename boundary:** numeric chapters zero-pad to width 3; non-numeric chapters flow through `chapterFileSafeId()` / `chapterOutputFilename()` using the spec-defined ASCII-safe normalization contract.
- **Issue #16 collision detection is integrity hardening, not optional polish:** because chapter normalization is many-to-one by design, future agents must preserve the explicit pre-write collision check instead of letting later buckets overwrite earlier ones.
- **Issue #16 warning classification is part of the public contract:** uncategorized sections surface via `TransformWarning` / `warnings[]`, not `ParseError`, so successful runs can still report zero `parse_errors`.
- **Issue #21 historical OLRC fetches must remain discovery-driven:** once the listing is parsed, `selectVintagePlan()` must reuse the discovered per-vintage title URL map rather than synthesizing `resolveTitleUrl(title, vintage)` for titles that were never advertised.
- **Issue #21 listing mode is intentionally side-effect free:** `listOlrcVintages()` may perform OLRC discovery but must not persist manifest state, cache artifacts, or cookie material.

## Things Future Agents Should Not Mislabel as Bugs
- No database/auth/RLS: intentional; this repo is a local CLI, not a service.
- Populated non-git directory rejection is a feature, not an inconvenience to remove.
- Rejection of non-prefix history is intentional; this phase does not repair or rewrite history.
- Local-only repos with no remote are valid success cases (`pushResult: skipped-local-only`).
- `git fast-import` is intentional for historical author/date control; do not replace it casually with ordinary `git commit` without revalidating exact-history guarantees.
- Congress and GovInfo no longer keep separate module-local limiter instances; both sources now import the shared singleton from `src/utils/rate-limit.ts`, so future agents should treat duplicate per-source limiter state as obsolete branch knowledge.
- Congress and GovInfo parse upstream `Retry-After` and preserve the parsed numeric `nextRequestAt` until `normalizeError()` serializes the public `next_request_at` field; future changes should keep that boundary intact.
- OLRC cookie bootstrap and `download.shtml` discovery are required production behavior, not temporary test scaffolding.
- Title 53 `reserved_empty` manifest entries are expected machine-readable skip states, not generic fetch failures and not cache artifacts.
- VoteView indexing is currently in-memory only; lack of on-disk index files is an implementation choice, not accidental data loss.
- The fallback current-congress path is expected to mark runs degraded/operator-review-required; that warning path is part of the contract.
- Recursive hierarchy walking for issue #12 is required production behavior for positive-law titles; zero sections from titles like 5/10/26 is a correctness bug, not an acceptable degraded mode.
- Issue #14 structured-body completeness is also required production behavior; rendering only labels without the paired body text for Titles like 42/26 is an output-integrity bug, not an acceptable abbreviated mode.
- Issue #16 chapter-grouped output is required additive behavior when `--group-by chapter` is passed; falling back to `section-*.md` output in that mode is a contract regression.
- Issue #16 `_uncategorized.md` plus `warnings[]` is expected behavior for chapter-less sections and should not be mislabeled as a failed transform.
- Zero-padded section filenames are part of the transform safety/correctness contract now because lexicographic directory order must match canonical numeric order during local review and downstream processing.
- Issue #21 sparse historical vintages are valid upstream behavior; missing discovered links should populate `missing_titles`, not trigger fabricated 404 fetch failures.
- Issue #21 only updates the top-level OLRC compatibility mirror (`selected_vintage` + `titles`) for plain latest-mode fetches; historical single-vintage and all-vintages runs persist canonical state under `sources.olrc.vintages` without redefining latest-mode semantics.

## Milestones / Releases Security Notes (Issue #18)

### Trust Boundary Additions
- Untrusted milestone inputs now include:
  - committed-but-still-validated milestone metadata JSON (`docs/metadata/legal-milestones.json` or test metadata files)
  - `commit_selector` strings resolved against arbitrary target repos
  - target-repo tag state under managed namespaces (`annual/*`, `pl/*`, `congress/*`, `president/*`)
  - repo-local `.us-code-tools/milestones.json` and `.us-code-tools/milestones.lock`
  - host `PATH` entries used to resolve `git` / `gh`

### Implemented Controls
- `src/milestones/git.ts`
  - resolves `git` / `gh` once per process into absolute executable paths and reuses them through `resolvedBinaryCache`
  - uses `execFile` with argument vectors rather than shell interpolation
  - fails closed with `git_cli_unavailable` / `github_cli_unavailable` when binaries cannot be resolved
  - distinguishes detached HEAD from dirty-tree state via dedicated `detached_head` error text
- `src/milestones/metadata.ts`
  - validates tag/release metadata before plan/apply/release side effects
  - rejects duplicate `annual_tag`, duplicate `snapshot_date`, duplicate normalized `pl/*`, duplicate president slugs, unknown president-term references, malformed release points, and scope mismatches
- `src/milestones/manifest.ts`
  - computes metadata digests with SHA-256 for freshness checks
  - writes `.us-code-tools/milestones.json` atomically via temp file + rename with mode `0600`
  - acquires a repo-local exclusive lock file and surfaces deterministic `lock_conflict` payload details for manual recovery
  - does not auto-break stale locks
- `src/milestones/apply.ts`
  - requires resolved `git`, attached HEAD, and a clean working tree before tag creation
  - fails on tag drift (`tag_conflict`) rather than retargeting an existing managed tag
- `src/milestones/releases.ts`
  - requires a present manifest whose metadata digest and live repo tag SHAs match a freshly recomputed plan before any GitHub write
  - requires resolved/authenticated `gh` before release publication
  - serializes release writes one at a time and stops immediately on failure
  - renders diff stats with `git diff --stat` using resolved tag names and a bounded subprocess timeout

### Security Decisions with Rationale
- **Absolute-path binary reuse per command run:** mitigates PATH-spoofing drift during one milestone invocation; once resolved, subprocesses do not fall back to repeated bare-name lookup.
- **Fail-on-tag-conflict:** managed milestone tags are historical markers and must not silently move to new SHAs.
- **Repo-local manifest freshness gate before GitHub writes:** prevents hand-edited or stale manifests from driving release publication after repo/tag drift.
- **Repo-local lock payload is operator-readable, not self-healing:** manual recovery is safer than auto-breaking a possibly-live lock in a git-mutating workflow.
- **Tool-owned `.us-code-tools/*` paths are excluded from clean-tree gating:** reruns should not deadlock on the command’s own operational files, but unrelated working-tree changes still block mutation.
- **Release body content is deterministic, metadata-driven text only:** no live model calls or web scraping can inject nondeterministic or unreviewed legal summaries during `release`.

## Things Future Agents Should Not Mislabel as Bugs
- The current code manually validates metadata in `src/milestones/metadata.ts`; absence of Ajv/schema modules is branch reality, not automatically a security bug.
- `createAnnotatedTag(...)` is a misleading name today: implementation currently issues plain `git tag <tag> <sha>` calls. That is a correctness/doc drift note, not evidence of silent force-move behavior.
- Skipping president tags for inaugurations before `coverage_start` in the same calendar year is intentional; the code compares full ISO dates, not just years.
- Release publication without remotes is still valid for `apply`; pushing tags is explicitly out of scope for issue #18.

## Phase 1 Scope (Current)
- What's implemented:
  - strict target bootstrap rules
  - dirty-tree and detached-HEAD rejection
  - exact-prefix history validation
  - deterministic UTC historical commit dating
  - explicit-branch remote push behavior
  - legacy transform ZIP/output hardening remains in place
  - issue #5 cache/manifest atomicity, redacted network logging, member-snapshot freshness checks, and skip-path crosswalk cleanup
  - issue #8 OLRC hardening: in-memory cookie bootstrap, Title-53-only reserved-empty downgrade, namespace-tolerant parser root discovery, and bounded larger-title XML extraction
  - issue #10 transform hardening: canonical `@_value` extraction for `<num>` nodes and mixed-decoration fallback cleanup so display punctuation does not leak into identifiers or paths
  - issue #12 transform hardening: one shared normalization boundary for XML-derived identifiers reused in frontmatter/paths/links, recursive hierarchy coverage for positive-law titles, preserved statutory note wrapper metadata, and fail-closed relative USC ref rendering
  - issue #14 transform integrity hardening: preserve-order structured-body parsing prevents chapeau/body/continuation loss or sibling drift, and markdown label normalization now preserves readable numbering without changing canonical parser identifiers
  - issue #16 output-integrity hardening: one shared chapter filename boundary, explicit pre-write collision rejection, report-only uncategorized warnings, and non-zero exit on any chapter write failure
  - issue #21 historical OLRC hardening: duplicate/malformed `--vintage` rejection before discovery, in-memory-only cookie reuse across list/latest/single/all-vintages modes, additive manifest normalization for old OLRC state, and discovery-driven sparse-vintage handling
- What's intentionally deferred:
  - signed-commit enforcement
  - remote authenticity verification beyond operator-configured git remotes
  - automatic recovery/repair for malformed target histories
  - runtime fetching/verification of Constitution text from remote sources
  - appendix-title CLI support
  - stronger host-allowlist / disk-ceiling enforcement promised by architecture but not yet fully centralized in code
- What's a test double vs production:
  - temp repos and bare remotes in tests are doubles for downstream targets
  - actual repo-preflight and git execution code paths are production paths exercised in integration tests
  - fixture source payloads are doubles; manifest/cache/crosswalk cleanup behavior is production logic
