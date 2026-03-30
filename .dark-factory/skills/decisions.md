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

### ADR-018: Congress/GovInfo share one in-process limiter singleton
- **Status:** Active
- **Context:** The spec and architecture bind Congress.gov and GovInfo to one `API_DATA_GOV_KEY` budget.
- **Decision:** Both `src/sources/congress.ts` and `src/sources/govinfo.ts` call `getSharedApiDataGovLimiter()` from `src/utils/rate-limit.ts` before dispatching requests and update that same singleton with `markRateLimitUse()`.
- **Consequence:** One process now enforces a single rolling-window budget across both sources; tests should mock the shared helper module rather than assuming per-source limiter state.
- **Feature:** #5 Data Acquisition

### ADR-019: Upstream `Retry-After` stays numeric until result normalization
- **Status:** Active
- **Context:** Congress/GovInfo share the `API_DATA_GOV_KEY` limiter and need a machine-readable retry horizon whenever preflight exhaustion or upstream `429` responses occur.
- **Decision:** Keep `nextRequestAt` as `number | null` inside `src/sources/congress.ts` and `src/sources/govinfo.ts`, and convert it to ISO only inside each module’s `normalizeError()` when emitting the public `next_request_at` field.
- **Consequence:** `rate_limit_exhausted` results now preserve `next_request_at` consistently across shared-budget exhaustion and parsed `Retry-After` responses; future agents should not reintroduce early ISO conversion in the throw path.
- **Feature:** #5 Data Acquisition

### ADR-020: OLRC fetches bootstrap one in-memory session cookie jar per request context
- **Status:** Active
- **Context:** `uscode.house.gov` now requires a session cookie before `download.shtml` and releasepoint ZIP URLs return the expected artifacts.
- **Decision:** `src/sources/olrc.ts` performs a homepage bootstrap against `https://uscode.house.gov/`, captures `Set-Cookie`, and reuses the resulting `Cookie` header for later OLRC requests in the same fetch context.
- **Consequence:** Manual curl bootstrap is no longer required, but future agents must keep cookie state memory-only and must not move it into manifest/cache/log state.
- **Feature:** #8 OLRC Compatibility

### ADR-021: OLRC discovery is `download.shtml`-first and only Title 53 may downgrade to `reserved_empty`
- **Status:** Active
- **Context:** The legacy `annualtitlefiles.shtml` page is obsolete for current OLRC releasepoints, and the current site returns an empty/non-ZIP payload for reserved Title 53.
- **Decision:** `fetchOlrcVintagePlan()` prefers `download.shtml`, parses numeric releasepoint ZIP links, ignores appendix-title links, and `fetchOlrcSource()` records Title 53 as `status: 'reserved_empty'` instead of failing the whole run when classification matches the approved reasons.
- **Consequence:** Current OLRC vintages are discoverable again, but non-53 title failures must remain hard failures and no placeholder artifact should be cached for reserved-empty Title 53.
- **Feature:** #8 OLRC Compatibility

### ADR-022: Parser compatibility is current `uscDoc.main.title` first, legacy `uslm.title` second
- **Status:** Active
- **Context:** Current OLRC XML is rooted at `uscDoc` with a namespace-qualified `main > title` path, while existing fixtures still use legacy `<uslm><title>` layout.
- **Decision:** `src/transforms/uslm-to-ir.ts` configures `fast-xml-parser` with `removeNSPrefix: true`, resolves `document.uscDoc?.main?.title` first, and falls back to `document.uslm?.title`.
- **Consequence:** Callers continue to pass raw XML strings directly, legacy fixtures stay valid, and current releasepoint XML transforms without caller-side namespace stripping.
- **Feature:** #8 OLRC Compatibility

### ADR-023: Raise the OLRC large-title entry ceiling to a bounded 128 MiB
- **Status:** Active
- **Context:** Current Title 42 exceeds the prior 64 MiB per-entry cap after decompression, but the issue scope does not justify a streaming parser rewrite.
- **Decision:** `src/sources/olrc.ts` keeps bounded extraction limits but allows recognized large-title XML entries up to 128 MiB while still enforcing total extracted XML limits.
- **Consequence:** Current Title 42-compatible archives extract successfully, and future agents should preserve explicit bounds rather than removing the guardrails entirely.
- **Feature:** #8 OLRC Compatibility

## Phase 1 Scope (Current)
- What's implemented:
  - transform ADRs for issue #1
  - Constitution dataset/planner/render/git-history/push ADRs for issue #3
  - manifest/cache/member-snapshot/crosswalk ADRs for issue #5
  - OLRC cookie/bootstrap/listing/parser/size-limit ADRs for issue #8
- What's intentionally deferred:
  - later backfill phases and their own ADRs
  - history repair/rewrite semantics for non-prefix repos
- What's a test double vs production:
  - temp repos and local bare remotes are test doubles; committed Constitution dataset, acquisition manifest/cache, and git orchestration are production design choices

### ADR-024: Canonical USLM numbers come from `<num @value>` when present
- **Status:** Active
- **Context:** Current OLRC `uscDoc` XML wraps decorated display numbers like `§ 1.` and `Title 1—` inside `<num>`, while the USLM XSD defines `@value` as the normalized machine-readable form.
- **Decision:** `src/transforms/uslm-to-ir.ts` routes title, chapter, and section number extraction through `readCanonicalNumText(...)`, which uses non-empty `node['@_value']` first and falls back to cleaned display text only when the attribute is absent or whitespace-only.
- **Consequence:** Canonical numbers stay stable for IR fields, validation, and output paths even when display text includes decoration or disagrees with the attribute.
- **Feature:** #10 Parser: read @value attribute from `<num>` elements + XSD-driven test validations

### ADR-025: Current-format multi-title transform coverage is derived from one committed Title 1 fixture
- **Status:** Active
- **Context:** The approved spec requires coverage for titles `2..54` (excluding reserved-empty `53`) without introducing live OLRC downloads or a large committed fixture matrix.
- **Decision:** `tests/integration/transform-cli.test.ts` keeps one committed current-format fixture at `tests/fixtures/xml/title-01/04-current-uscdoc.xml` and generates the other numeric titles via deterministic substitutions inside `buildCurrentFormatFixtureZip(...)`.
- **Consequence:** Integration coverage remains offline, reproducible, and easy to update when the current-format contract changes.
- **Feature:** #10 Parser: read @value attribute from `<num>` elements + XSD-driven test validations

### ADR-026: Positive-law section discovery is recursive and hierarchy metadata is a rendered contract
- **Status:** Active
- **Context:** Fixed-depth `title -> chapter -> section` traversal dropped sections for positive-law titles whose sections live under `subtitle`, `part`, `subpart`, or `subchapter` containers.
- **Decision:** `src/transforms/uslm-to-ir.ts` recursively walks nested hierarchy containers beneath `<title>`, accumulates normalized container numbers into `SectionIR.hierarchy`, and `src/transforms/markdown.ts` serializes every present hierarchy level as top-level frontmatter.
- **Consequence:** Future agents must treat hierarchy frontmatter as part of the public transform contract; parser-only preservation is insufficient.
- **Feature:** #12 Transform: zero-padded filenames, rich metadata (sourceCredit/notes), recursive hierarchy

### ADR-027: One normalization helper family owns section ordering, filenames, and USC ref targets
- **Status:** Active
- **Context:** Section ordering, zero-padded filenames, and internal USC cross-reference targets can drift if each layer computes its own sort/path logic.
- **Decision:** `src/domain/normalize.ts` is the shared boundary for `splitSectionNumber()`, `compareSectionNumbers()`, `sectionFileSafeId()`, and `sortSections()`, and all title-index rendering, file writes, and relative USC ref links reuse those helpers.
- **Consequence:** Future agents should modify the shared helpers instead of patching ordering/filename/link logic independently in renderer or tests.
- **Feature:** #12 Transform: zero-padded filenames, rich metadata (sourceCredit/notes), recursive hierarchy

### ADR-028: Statutory notes preserve wrapper metadata and render separately from main content
- **Status:** Active
- **Context:** Current OLRC sections carry `<sourceCredit>` and `<notes type="..."><note topic="...">...</note></notes>` metadata that is distinct from main section prose and legacy editorial note handling.
- **Decision:** `SectionIR` carries singular `sourceCredit` plus ordered `statutoryNotes`, `parseNotes()` copies wrapper `@type` onto each emitted note as `noteType`, and markdown renders them under `## Statutory Notes` while frontmatter emits `source_credit`.
- **Consequence:** Provenance and statutory-note context survive parsing/rendering; future agents should not collapse them back into generic notes.
- **Feature:** #12 Transform: zero-padded filenames, rich metadata (sourceCredit/notes), recursive hierarchy

### ADR-029: Slash-separated USC refs must canonicalize to the same section identifier used for filenames
- **Status:** Active
- **Context:** OLRC `<ref href="/us/usc/t10/s125/d">` links use slash-separated section tails that describe the same generated section document as canonical section id `125d`.
- **Decision:** Relative markdown link generation for transformable USC refs must normalize slash-separated tails into the canonical section identifier before calling the shared filename helper.
- **Consequence:** Ref targets and generated section files stay aligned; branch commit `07b954e` implements this by collapsing slash tails before `sectionFileSafeId()`.
- **Feature:** #12 Transform: zero-padded filenames, rich metadata (sourceCredit/notes), recursive hierarchy

### ADR-030: Mixed-case section suffix ordering is explicit and deterministic
- **Status:** Active
- **Context:** Locale-sensitive suffix comparison can drift across environments for identifiers like `106A` and `106a`, which breaks `_title.md` ordering and filename/link expectations.
- **Decision:** The canonical section-order contract for equal numeric roots is explicit and regression-tested: `106` < `106A` < `106a` < `106b`.
- **Consequence:** Future agents must preserve this exact ordering behavior when changing normalization helpers or renderer sorting; branch commit `07b954e` now uses direct codepoint comparison to enforce it.
- **Feature:** #12 Transform: zero-padded filenames, rich metadata (sourceCredit/notes), recursive hierarchy

### ADR-031: Mixed-content XML normalization must preserve source order across text and inline children
- **Status:** Active
- **Context:** `sourceCredit` and statutory-note nodes interleave plain text with inline `<ref>` and `<date>` children, and the earlier object-tree reconstruction in `readRawText()` reordered or dropped source text like `Aug. 10, 1956, ch. 1041` / `70A Stat. 3`.
- **Decision:** `src/transforms/uslm-to-ir.ts` now keeps a second `fast-xml-parser` pass with `preserveOrder: true` and uses ordered helper functions (`readOrderedRawText(...)`, `readOrderedNodeText(...)`, `parseNotesOrdered(...)`) for section prose, `sourceCredit`, and statutory notes so normalization follows source document order before applying USC-link vs plain-text fallback logic.
- **Consequence:** Recognized USC refs still link, non-transformable refs stay plain text, surrounding punctuation/dates survive in rendered order, and future agents should extend the ordered helper path instead of reviving tag-bucket concatenation.
- **Feature:** #12 Transform: zero-padded filenames, rich metadata (sourceCredit/notes), recursive hierarchy

### ADR-032: Structured section bodies render in source order with first-class deep hierarchy nodes
- **Status:** Active
- **Context:** Many USC sections express their real body text through `chapeau`, labeled descendants (`subsection` through `subitem`), inline node body text (`content` / `text` / `p`), and trailing `continuation` text. Earlier rendering could keep labels while dropping the actual body text or lose deep levels like `subclause` / `subitem`.
- **Decision:** `src/domain/model.ts` treats `subclause` and `subitem` as first-class `ContentNode` variants, `src/transforms/uslm-to-ir.ts` preserves ordered section-body content across all labeled levels, and markdown rendering follows the container order `chapeau -> parent inline body -> nested children -> continuation`.
- **Consequence:** Future agents must preserve deep hierarchy node types and the ordered-body contract rather than flattening or bucketizing structured content.
- **Feature:** #14 Transform: render chapeau, paragraph content, and subsection body text

### ADR-033: Markdown label normalization is a renderer concern, not a parser rewrite
- **Status:** Active
- **Context:** Real fixtures and tests now cover cases where parsed labels may be bare canonical values (`1`, `A`, `i`) while expected markdown output requires readable legislative formatting like `(1)`.
- **Decision:** `src/transforms/markdown.ts` normalizes labels at render time with `formatLabel(...)`, adding parentheses only when they are absent and leaving already-parenthesized labels unchanged.
- **Consequence:** Canonical parser values stay stable for IR/testing/path logic, while rendered markdown remains readable and deterministic. Future agents should not move this formatting concern into identifier parsing.
- **Feature:** #14 Transform: render chapeau, paragraph content, and subsection body text

### ADR-034: Transform output grouping is an extensible mode value, not a boolean
- **Status:** Active
- **Context:** Issue #16 adds chapter-grouped output while keeping section-per-file output as the default, and future grouping modes (`subchapter`, `part`) are explicitly contemplated by the spec.
- **Decision:** `src/domain/model.ts` defines `TransformGroupBy = 'section' | 'chapter'`, `src/index.ts` defaults `parseTransformArgs()` to `'section'`, and `writeTitleOutput(...)` branches on that mode instead of on a bespoke boolean flag.
- **Consequence:** Future grouping modes can extend the union without redefining the CLI/output contract or overloading a boolean with new meanings.
- **Feature:** #16 Transform: chapter-level output mode

### ADR-035: Chapter files are composed from rendered section markdown, not a second section renderer
- **Status:** Active
- **Context:** The spec and architecture treat rendering drift between section mode and chapter mode as the highest-risk correctness failure.
- **Decision:** `src/transforms/markdown.ts` implements `renderChapterMarkdown(...)` / `renderUncategorizedMarkdown(...)` by stripping frontmatter from `renderSectionMarkdown(section)` output and concatenating those rendered bodies in canonical order.
- **Consequence:** Section headings, body text, notes, source credits, and USC links stay aligned across output modes; future agents should not introduce a parallel raw-content rendering path for chapter mode.
- **Feature:** #16 Transform: chapter-level output mode

### ADR-036: Chapter filename normalization is centralized and collisions fail before any chapter write
- **Status:** Active
- **Context:** The spec requires one shared normalization contract for `chapter-{safe-id}.md`, and adversary review found that the normalization is intentionally many-to-one (`A-B` and `A / B` can both map to `chapter-a-b.md`).
- **Decision:** `src/domain/normalize.ts` owns `chapterFileSafeId()`, `chapterOutputFilename()`, and `compareChapterIdentifiers()`, while `src/transforms/write-output.ts` precomputes normalized output filenames and records `OUTPUT_WRITE_FAILED` if distinct raw chapter ids collide before the write loop starts.
- **Consequence:** Raw chapter identifiers never become filenames directly, and one bucket cannot silently overwrite another. Future agents must preserve the pre-write collision guard.
- **Feature:** #16 Transform: chapter-level output mode

### ADR-037: Uncategorized chapter-mode diagnostics are warnings, not parse errors
- **Status:** Active
- **Context:** The approved spec requires successful chapter-mode runs to preserve zero `parse_errors` even when some sections lack `hierarchy.chapter`.
- **Decision:** `src/transforms/write-output.ts` routes chapter-less sections into `_uncategorized.md` and emits `TransformWarning { code: 'UNCATEGORIZED_SECTION', ... }` entries that `src/index.ts` surfaces via the additive `warnings` array in the JSON report.
- **Consequence:** Successful chapter-mode runs can surface incomplete hierarchy metadata without failing parse success semantics. Future agents should not downgrade this warning path into `parseErrors`.
- **Feature:** #16 Transform: chapter-level output mode

### ADR-038: Any chapter-mode output write failure forces a non-zero transform exit
- **Status:** Active
- **Context:** Issue #16 adversary review found that partial chapter writes could still exit `0` if `_title.md` and one chapter file succeeded while another chapter file failed.
- **Decision:** After emitting the JSON report, `src/index.ts` explicitly returns non-zero whenever `writeResult.parseErrors` contains any `OUTPUT_WRITE_FAILED`, not just duplicate-section collisions.
- **Consequence:** Partial chapter writes are surfaced through the existing write-error path and cannot be mistaken for a successful transform.
- **Feature:** #16 Transform: chapter-level output mode

### ADR-039: Milestone metadata is validated in code and normalized before any tag/release work
- **Status:** Active
- **Context:** Issue #18 introduces a committed legal-milestones metadata file that drives git tags, repo-local manifest state, and GitHub Releases. Wrong or ambiguous rows would mutate history or publish incorrect releases.
- **Decision:** `src/milestones/metadata.ts` performs manual schema + semantic validation in code, including duplicate annual tags, duplicate snapshot dates, duplicate normalized `pl/*` tags, release-point/congress consistency, president-term reference checks, scope parity, and monotonic congress ordering, then sorts rows deterministically before downstream planning.
- **Consequence:** Future agents should extend the existing validation seam instead of scattering milestone invariants across CLI/apply/release code paths.
- **Feature:** #18 Git tags and GitHub Releases for legal milestones

### ADR-040: Trusted `git` and `gh` binaries are resolved once per process and reused by absolute path
- **Status:** Active
- **Context:** Milestone `apply` mutates git tags and `release` writes GitHub Releases. Repeated bare-name PATH lookups would make the subprocess boundary vulnerable to PATH spoofing or inconsistent host state during one command run.
- **Decision:** `src/milestones/git.ts` resolves `git` / `gh` once into absolute executable paths, caches the resulting promise in `resolvedBinaryCache`, and routes all later subprocess execution through `execFile` with that resolved path.
- **Consequence:** Failure to resolve now fails closed with `git_cli_unavailable` or `github_cli_unavailable`, and future agents should not add new milestone subprocess calls that bypass this adapter.
- **Feature:** #18 Git tags and GitHub Releases for legal milestones

### ADR-041: Milestone manifest freshness is proven against live repo tag SHAs before GitHub writes
- **Status:** Active
- **Context:** A repo-local `.us-code-tools/milestones.json` is convenient operational state, but it can go stale or be edited after `apply`. Publishing GitHub Releases from stale manifest data would break auditability.
- **Decision:** `src/milestones/releases.ts` requires both metadata-digest equality and plan-shape equality against freshly resolved live repo tag SHAs (including paired `pl/*` tags) before calling `gh release create/edit`.
- **Consequence:** Hand-edited manifests, metadata drift, or tag drift fail release publication before any GitHub write. Future agents must preserve both the digest check and the live-SHA normalization comparison.
- **Feature:** #18 Git tags and GitHub Releases for legal milestones

### ADR-042: Repo-local milestone locking is fail-closed and manual-recovery only
- **Status:** Active
- **Context:** `milestones apply` writes target-repo tags plus `.us-code-tools/milestones.json`; concurrent runs could otherwise interleave tag checks and manifest writes.
- **Decision:** `src/milestones/manifest.ts` acquires `.us-code-tools/milestones.lock` via exclusive create, persists exactly `pid`, `hostname`, `command`, and `timestamp`, and on conflict surfaces those same fields in `lock_conflict` output without overwriting or deleting the existing lock.
- **Consequence:** Operators can inspect and manually clear stale locks, but the tool never auto-breaks them. Future agents should keep this contract deterministic and repo-local.
- **Feature:** #18 Git tags and GitHub Releases for legal milestones

### ADR-043: Title directory names are derived from a shared heading-slug helper with exact legacy fallback
- **Status:** Active
- **Context:** Issue #20 changes transform output roots from bare `title-{NN}` folders to descriptive directories like `title-18-crimes-and-criminal-procedure`, and adversary review showed that writers and cross-title links drift if each layer formats title paths independently.
- **Decision:** `src/domain/normalize.ts` now owns `slugifyTitleHeading(...)` and `titleDirectoryName(...)`; all section-mode writes, chapter-mode writes, `_title.md`, `_uncategorized.md`, markdown helper links, and parser-generated USC ref links must reuse that single helper contract.
- **Consequence:** Future agents should update the shared normalization helper instead of patching title-path strings in individual writers/renderers/tests. Missing or punctuation-only headings must continue to fall back to the exact legacy directory `title-{NN}`.
- **Feature:** #20 Transform: descriptive title folder names

### ADR-044: Real parser-path cross-title links may use a canonical title-number → heading map
- **Status:** Active
- **Context:** Inline USC refs like `/us/usc/t18/s4041` expose the destination title number but not the destination title heading, yet issue #20 requires those links to target the same slugged directories as emitted output.
- **Decision:** `src/domain/normalize.ts` exports `resolveKnownTitleHeading(...)`, a canonical map for successful numeric titles, and `src/transforms/uslm-to-ir.ts` uses it only when deriving destination title directories for parser-generated cross-title markdown links.
- **Consequence:** The real XML-to-markdown path stays aligned with emitted directory names without inventing a second slugging contract. Future agents should treat the map as a narrowly scoped fallback for destination-link rendering, not as a replacement for parsed `TitleIR.heading` where that real heading already exists.
- **Feature:** #20 Transform: descriptive title folder names

### ADR-045: Historical OLRC discovery is a single shared pass reused across list/latest/single/all-vintages modes
- **Status:** Active
- **Context:** Issue #21 adds `--list-vintages`, `--vintage=<pl-number>`, and `--all-vintages`, and the spec/architecture require deterministic dedupe, ordering, and requested-vintage lookup.
- **Decision:** `src/sources/olrc.ts` centralizes releasepoint discovery in `fetchOlrcVintagePlan()`, which returns descending `availableVintages`, the selected latest vintage, and the discovered per-vintage title URL maps used by every OLRC mode.
- **Consequence:** Future agents should extend that shared discovery seam rather than adding mode-specific OLRC listing logic that can drift in ordering or sparse-vintage behavior.
- **Feature:** #21 Historical OLRC annual release-point fetch

### ADR-046: Historical OLRC state is canonical per vintage, with a latest-mode compatibility mirror
- **Status:** Active
- **Context:** Pre-issue-21 manifests could represent only one OLRC vintage via top-level `selected_vintage` + `titles`, but historical fetch needs machine-readable state for multiple vintages without breaking existing consumers.
- **Decision:** `src/utils/manifest.ts` keeps `sources.olrc.selected_vintage` and top-level `titles` as the compatibility mirror for plain latest-mode fetches, while canonical historical state lives under `sources.olrc.vintages` plus additive `available_vintages` metadata.
- **Consequence:** Future agents must preserve normalization of old manifests to `vintages: {}` / `available_vintages: null` and avoid redefining the top-level mirror as the canonical historical source of truth.
- **Feature:** #21 Historical OLRC annual release-point fetch

### ADR-047: Sparse historical OLRC vintages must reuse discovered title links instead of synthesizing missing URLs
- **Status:** Active
- **Context:** Adversary review found that non-latest historical vintages were fabricating `1..54` title URLs, turning real discovery gaps into 404-driven `upstream_request_failed` runs.
- **Decision:** `OlrcVintagePlan` now retains `titleUrlsByVintage`, and `selectVintagePlan()` clones the discovered map for the requested vintage so absent titles remain represented by `missing_titles` rather than invented download requests.
- **Consequence:** Future agents should treat sparse vintage listings as valid upstream input and should not reintroduce fallback URL synthesis for titles missing from the discovered listing.
- **Feature:** #21 Historical OLRC annual release-point fetch

### ADR-048: Chapter-mode link rewriting is driven by writer-built section target maps plus exact canonical fallback URLs
- **Status:** Active
- **Context:** Issue #29 found that chapter-mode markdown still linked to nonexistent local `section-*.md` files, and slash-bearing parse-output refs like `125/d` could lose their canonical identifier during rewrite/fallback.
- **Decision:** `src/transforms/write-output.ts` builds `sectionTargetsByRef` entries keyed as `${titleNumber}:${sectionNumber}` from actual chapter filenames/anchors, `src/transforms/markdown.ts` rewrites chapter-mode links through that map, and unmapped refs fall back exactly through `buildCanonicalSectionUrl(titleNumber, sectionNumber)`.
- **Consequence:** Renderer link targets now match actual written chapter files, and canonical refs like `125/d` must remain intact for both map lookup and fallback URL emission. Future agents should not reintroduce local `section-*.md` chapter links or ad hoc fallback URL builders.
- **Feature:** #29 Markdown chapter rendering correctness

### ADR-049: Embedded chapter-mode rendering is context-aware, while section-mode rendering remains standalone
- **Status:** Active
- **Context:** Chapter files embed multiple sections, so reusing standalone section markdown byte-for-byte caused invalid heading hierarchy, missing embedded anchors, and note heading levels that were too shallow for chapter pages.
- **Decision:** `src/transforms/markdown.ts` keeps standalone section rendering at H1, but chapter-mode embedded sections render with explicit H2 headings plus `{#section-*}` anchors, statutory notes at H3/H4, editorial notes at H3, and depth-indented labeled content lines.
- **Consequence:** Future agents should treat heading level, anchor insertion, and chapter-mode note levels as contextual renderer concerns rather than trying to get chapter output by stripping frontmatter from standalone section markdown.
- **Feature:** #29 Markdown chapter rendering correctness

### ADR-050: Section heading extraction must share one helper across ordered and non-ordered parser paths
- **Status:** Active
- **Context:** Issue #29 exposed intermittent missing headings in parsed sections, especially when sections also contained structured/nested ordered content.
- **Decision:** `src/transforms/uslm-to-ir.ts` now routes section-heading extraction through `readSectionHeading(...)`, which prefers ordered-path heading text when available and otherwise falls back to the non-ordered `<heading>` read, returning `''` when the element is absent.
- **Consequence:** Ordered/non-ordered parsing must stay heading-equivalent for the same section input, and future agents should not substitute descendant paragraph text into `SectionIR.heading` as a fallback.
- **Feature:** #29 Markdown chapter rendering correctness
