# Git tags and GitHub Releases for legal milestones

## Summary
Add a release-marking workflow to `us-code-tools` that turns historical OLRC snapshot commits in the downstream `us-code` repository into a navigable legal timeline. The workflow must apply deterministic `annual/*`, `congress/*`, `president/*`, and annual-release-point `pl/*` git tags to the correct snapshot commits, persist a machine-readable manifest of what was tagged, and generate one GitHub Release per completed Congress boundary using diff stats plus structured legal-summary metadata. Day-one scope covers the OLRC annual baseline window (~2013-present); within that scope, `pl/{congress}-{number}` tags mark the public law release point that each annual OLRC snapshot is current through, even though the underlying commits are annual snapshots rather than commit-per-law history.

## Context
- The current repo already has a git-writing path for Constitution history in `src/backfill/*`, but it has no release/tagging workflow yet.
- `src/index.ts` currently exposes `transform`, `backfill`, and `fetch`; any release-marking entry point added by this issue is new and must fit the existing CLI style.
- `docs/specs/5-spec.md` established OLRC acquisition and historical-release-point groundwork, and `docs/specs/16-spec.md` established chapter-level output needed for snapshot commits that are readable at chapter granularity.
- The downstream goal is a `us-code` git history where users can run `git checkout congress/117`, `git diff annual/2023..annual/2024`, or browse the GitHub Releases page as a timeline of legal change.
- OLRC annual release points are snapshot-based, not per-law. Day-one `pl/{congress}-{number}` tags therefore mean "this annual snapshot is current through Public Law X"; they do not claim that the tagged commit is the enactment commit for that law.
- The implementation must preserve that distinction mechanically: each annual snapshot row carries exactly one `release_point` value, and day-one `pl/*` tags are created only from those annual release-point identifiers. The workflow must not infer additional per-law tags beyond the one release-point tag attached to each annual snapshot commit.
- Congress release bodies must derive their `Summary`, `Notable Laws`, and `Narrative` from exactly one metadata row per Congress: the annual row for that Congress with `is_congress_boundary: true`. No cross-row aggregation or heuristic selection is allowed in day-one scope.
- Presidential-tag derivation must read committed inauguration metadata from a normative schema, not from hardcoded dates in code or ad hoc release metadata.
- Non-negotiable constraint: Congress Releases are created only at Congress boundary tags, not for every annual snapshot and not for every public law.

## Acceptance Criteria

### Functional

#### 1. CLI and planning contract
- [ ] `src/index.ts` adds a new `milestones` command with exactly these valid invocations for this issue: `npx us-code-tools milestones plan --target <repo> --metadata <file>`, `npx us-code-tools milestones apply --target <repo> --metadata <file>`, and `npx us-code-tools milestones release --target <repo> --metadata <file>`. Any other `milestones` subcommand or any invocation missing `--target` or `--metadata` exits non-zero with a deterministic usage error before modifying the target repo or calling GitHub.  <!-- Touches: src/index.ts, new src/commands/milestones.ts, tests/cli/milestones.test.ts -->
- [ ] The metadata file consumed by all three subcommands is a committed JSON document in this repo (new file, for example `docs/metadata/legal-milestones.json`) whose schema is validated before use. Its top-level schema contains exactly two normative arrays: `annual_snapshots[]` and `president_terms[]`. Each `annual_snapshots[]` row must contain `annual_tag`, `snapshot_date`, `release_point`, `commit_selector`, `congress`, `president_term`, `is_congress_boundary`, and `release_notes` with exactly these required members: `notable_laws[]`, `summary_counts.titles_changed`, `summary_counts.chapters_changed`, `summary_counts.sections_added`, `summary_counts.sections_amended`, `summary_counts.sections_repealed`, and `narrative`. `release_point` must normalize to exactly one day-one git tag name in the form `pl/{congress}-{number}` for that same row’s `congress` value. Each `president_terms[]` row must contain exactly `slug`, `inauguration_date`, and `president_name`. Invalid JSON, duplicate annual tag names, duplicate normalized `pl/*` tag names across annual rows, duplicate `snapshot_date`, duplicate president slugs, malformed inauguration dates, unknown president term slugs referenced by annual rows, malformed release points, mismatches between `release_point` congress and row `congress`, negative summary counts, empty narrative text, or a `commit_selector` that resolves to zero or multiple commits all make the command exit non-zero before any tag/release side effects.  <!-- Touches: new docs/metadata/legal-milestones.json, new src/milestones/schema.ts, tests/unit/milestones-schema.test.ts -->

#### 2. Tag taxonomy application
- [ ] `milestones apply` creates lightweight or annotated git tags only with these namespace formats in day-one scope: `annual/{YYYY}`, `pl/{congress}-{number}`, `congress/{N}`, and `president/{slug}`. For each `annual_snapshots[]` row, the command must create both the row’s `annual/{YYYY}` tag and exactly one normalized `pl/{congress}-{number}` tag derived from `release_point`, and both tags must point at the same resolved snapshot commit. No additional `pl/*` tags beyond those one-per-annual-row release-point tags may be created in this issue.  <!-- Touches: new src/milestones/apply.ts, new src/milestones/schema.ts, tests/unit/milestones-apply.test.ts -->
- [ ] For each metadata row, `annual/{YYYY}` is applied to exactly one snapshot commit in the target repository selected by `commit_selector`; the paired `pl/{congress}-{number}` tag derived from that row’s `release_point` is applied to that same commit; and the command records the resolved commit SHA, annual tag name, `pl/*` tag name, snapshot date, release point, congress number, and president term in a machine-readable manifest file under the target repo (new file at `.us-code-tools/milestones.json`). Re-running `milestones apply` against an unchanged repo and unchanged metadata is idempotent: it creates 0 new tags, rewrites 0 existing tags, and leaves manifest contents byte-identical.  <!-- Touches: new src/milestones/apply.ts, new src/milestones/manifest.ts, tests/integration/milestones-apply.test.ts -->
- [ ] `congress/{N}` tags are created only on metadata rows explicitly marked `is_congress_boundary: true`, and the boundary tag must point to the same commit as that row’s `annual/{YYYY}` tag. Validation fails if two rows claim the same Congress boundary, if Congress numbers decrease across chronologically sorted rows, or if a boundary row is missing its paired annual tag definition.  <!-- Touches: new src/milestones/apply.ts, new src/milestones/validate-order.ts, tests/unit/milestones-apply.test.ts -->
- [ ] `president/{slug}` tags are derived only from `president_terms[]` inauguration metadata in the committed metadata file, not from handwritten ad hoc per snapshot and not from hardcoded dates in code. For every `president_terms[]` row whose `inauguration_date` falls within the covered annual-snapshot timeline, exactly one `president/{slug}` tag is created on the first snapshot commit whose `snapshot_date` is on or after that inauguration date. If the metadata window contains no snapshot on or after an inauguration date, that presidential tag is skipped and the plan/apply report must list it under `skipped_president_tags[]` with the row’s `slug`, `inauguration_date`, and machine-readable reason code `no_snapshot_on_or_after_inauguration`.  <!-- Touches: new src/milestones/president-tags.ts, new docs/metadata/legal-milestones.json, tests/unit/president-tags.test.ts, tests/integration/milestones-plan.test.ts -->

#### 3. Planning/reporting behavior
- [ ] `milestones plan` performs full validation and commit resolution without mutating git tags or GitHub releases, then prints one JSON object to stdout containing: `annual_tags[]`, `pl_tags[]`, `congress_tags[]`, `president_tags[]`, `skipped_president_tags[]`, `release_candidates[]`, and `errors[]`. Each planned release candidate must include `tag`, `previous_tag`, `title`, `start_date`, `end_date`, and the exact commit SHAs those tags resolve to; for the earliest in-scope Congress boundary, `previous_tag` and `previous_tag_sha` are `null` and the candidate is still valid. The command exits `0` only when `errors[]` is empty.  <!-- Touches: new src/commands/milestones.ts, new src/milestones/plan.ts, tests/cli/milestones.test.ts -->
- [ ] `milestones apply` requires the target repository working tree to be clean and the current HEAD to be attached to a branch before creating or updating the milestone manifest. If the repo is dirty or in detached HEAD state, the command exits non-zero with deterministic error text and creates 0 tags. The command may create tags in a repo with no remotes configured; pushing tags to remotes is out of scope for this issue.  <!-- Touches: new src/milestones/git.ts or existing backfill git adapter extension, tests/integration/milestones-apply.test.ts -->

#### 4. GitHub Release generation
- [ ] `milestones release` creates or updates GitHub Releases only for `congress/{N}` tags present in the manifest produced by `milestones apply`. Annual tags, `pl/*` tags, and president tags never produce GitHub Releases in this issue. Before any GitHub write, the command must validate that `.us-code-tools/milestones.json` exists, is valid JSON, declares the exact metadata file digest used by the last successful `apply`, and still matches a freshly recomputed plan for the current target repo + `--metadata` input, including every resolved annual/pl/congress/president tag SHA needed by the release candidates. If the manifest is absent, malformed, missing its metadata digest, or differs from the freshly recomputed plan, the command exits non-zero with a deterministic freshness error before creating or editing any release. If the required `gh` CLI is unavailable or unauthenticated, the command exits non-zero before creating or editing any release and reports `error.code="github_cli_unavailable"` or `error.code="github_cli_auth_missing"` respectively.  <!-- Touches: new src/milestones/releases.ts, new src/milestones/manifest.ts, tests/unit/releases-auth.test.ts, tests/integration/milestones-release.test.ts -->
- [ ] For each Congress release candidate, the release title is exactly `{ordinal} Congress ({startYear}–{endYear})` (for example `118th Congress (2023–2024)`), and the release body contains all of the following machine-checkable sections in this order: `## Diff Stat`, `## Summary`, `## Notable Laws`, and `## Narrative`. The metadata source for all three non-diff sections is exactly the single `annual_snapshots[]` row for that Congress where `is_congress_boundary: true`; if zero or multiple rows satisfy that condition for a Congress release candidate, validation fails before any GitHub write. When `previous_tag` is non-null, the `## Diff Stat` section must be generated from `git diff --stat <previousCongressTag>..<currentCongressTag>` using the resolved Congress tags from the manifest; when `previous_tag` is `null` for the earliest in-scope Congress release, the section must instead contain the exact sentence `Baseline release: no prior congress tag in scope.`. `## Summary` must render the exact integer values from that boundary row’s metadata fields `release_notes.summary_counts.titles_changed`, `chapters_changed`, `sections_added`, `sections_amended`, and `sections_repealed`; `## Notable Laws` must render the exact ordered list from that same row’s `release_notes.notable_laws[]`; and `## Narrative` must render the exact `release_notes.narrative` string from that same row, not a live LLM call and not a synthesized paraphrase.  <!-- Touches: new src/milestones/releases.ts, new src/milestones/release-renderer.ts, tests/unit/release-renderer.test.ts, tests/integration/milestones-release.test.ts -->
- [ ] Release generation is idempotent and update-safe: re-running `milestones release` with unchanged manifest and unchanged metadata does not create duplicate releases, and if a release already exists for `congress/{N}`, the command updates that existing release in place instead of creating a second one. Mechanically, tests must prove release lookup is keyed by tag name and that one existing release plus one rerun still results in exactly one release for that tag.  <!-- Touches: new src/milestones/releases.ts, tests/unit/releases-idempotency.test.ts -->

### Non-Functional
- [ ] Determinism: for the same target repo history and the same metadata file, `milestones plan` emits byte-identical JSON and `milestones apply` emits byte-identical manifest content across repeated runs.
- [ ] Auditability: every tag and release created by this workflow is derivable from committed metadata plus existing git history; no live web scraping or model call is required during `plan`, `apply`, or `release`, and `milestones release` must prove manifest freshness against the current metadata-derived plan before trusting stored SHAs.
- [ ] Safety: no command in this issue force-moves an existing tag to a different commit unless the user passes a future explicit repair flag, which is out of scope here. If an existing namespaced tag already points at the wrong SHA, the command exits non-zero and reports the conflict instead of retagging silently.

## Out of Scope
- Creating commit-per-law history or any additional `pl/{congress}-{number}` tags beyond the single annual release-point tag attached to each annual snapshot row.
- Generating GitHub Releases for annual snapshots or presidential terms.
- Downloading OLRC historical snapshots or creating the snapshot commits themselves.
- Pushing tags to remotes, creating PRs in the downstream `us-code` repo, or force-repairing incorrect historical tags.
- Live LLM calls, browser automation, or manual GitHub web UI flows for release narratives.
- Any milestone coverage before the OLRC annual-snapshot baseline window covered by committed metadata.

## Dependencies
- `docs/specs/5-spec.md` — historical OLRC release-point acquisition and metadata availability.
- `docs/specs/16-spec.md` — chapter-level output used by the downstream snapshot commits.
- Existing git orchestration patterns in `src/backfill/*` for repo validation and idempotent history operations.
- `gh` CLI installed and authenticated for `milestones release` only.

## Acceptance Tests (human-readable)
1. Create a fixture git repo containing annual snapshot commits for the covered years and place a valid `legal-milestones.json` file in the repo.
2. Run `npx us-code-tools milestones plan --target <repo> --metadata <file>` and verify stdout JSON includes planned `annual/*`, `pl/*`, `congress/*`, and `president/*` tags plus release candidates, with `errors` empty.
3. Modify metadata so one `annual_tag` is duplicated; rerun `plan` and verify it exits non-zero before any git mutation.
4. Run `npx us-code-tools milestones apply --target <repo> --metadata <file>` and verify the target repo now contains `annual/2013` through the last in-scope annual tag, one `pl/*` release-point tag for each annual snapshot row on the same commit as its paired annual tag, the expected `congress/*` tags, and the expected `president/*` tags.
5. Open `.us-code-tools/milestones.json` and verify each annual row records annual tag name, paired `pl/*` tag name, resolved commit SHA, release point, congress number, president term, and the metadata digest used to compute the manifest.
6. Re-run `milestones apply` unchanged and verify no tags move, no extra tags appear, and the manifest file is byte-identical.
7. Put the target repo into a dirty working-tree state and rerun `apply`; verify it exits non-zero and creates 0 new tags.
8. Seed metadata whose `president_terms[]` includes an inauguration before the first covered annual snapshot; run `plan` and verify that tag appears under `skipped_president_tags[]` with the same `slug`, the same `inauguration_date`, and reason `no_snapshot_on_or_after_inauguration`.
9. With a valid manifest present and a mocked/authenticated `gh` adapter, run `npx us-code-tools milestones release --target <repo> --metadata <file>` and verify releases are created only for `congress/*` tags.
10. Hand-edit `.us-code-tools/milestones.json` or change the metadata file after `apply`, rerun `release`, and verify it exits non-zero with a deterministic manifest-freshness error before any GitHub write.
11. Inspect one non-baseline rendered release body and verify it contains `## Diff Stat`, `## Summary`, `## Notable Laws`, and `## Narrative` in that order, that the diff section reflects `git diff --stat congress/<prev>..congress/<current>`, and that all three non-diff sections come from the single `annual_snapshots[]` row for that Congress where `is_congress_boundary: true`.
12. Modify metadata so one Congress has zero boundary rows or multiple boundary rows; rerun `release` and verify it exits non-zero before any GitHub write for that Congress.
13. Inspect the earliest in-scope Congress release and verify `previous_tag` is `null` in plan output and the release body contains `Baseline release: no prior congress tag in scope.` instead of a git diff stat.
14. Re-run `milestones release` unchanged and verify the same release records are updated in place rather than duplicated.
15. Run `npm test` and `npm run build` and verify both exit `0`.

## Edge Case Catalog
- **Malformed input:** invalid JSON metadata, duplicate keys after parse normalization, malformed `release_point` like missing `PL` delimiter, malformed `annual/`, `pl/`, or `congress/` tag strings, unknown president slugs, negative `summary_counts` values, empty `release_notes.narrative`, and `commit_selector` expressions that resolve to zero or multiple commits.
- **Partial data:** annual rows present without Congress boundary flags, annual rows missing any required `release_notes` member (`notable_laws`, `summary_counts.*`, or `narrative`), `president_terms[]` rows missing `slug` or `inauguration_date`, or metadata window that includes some but not all inaugurations; the workflow must either validate these fields or emit explicit skip records rather than inventing missing data.
- **Delimiter edge cases:** tag names with extra slashes, whitespace, lowercase/uppercase year mismatches, trailing separators, or empty namespace segments must be rejected during schema validation.
- **Encoding issues:** metadata narratives and notable-law titles may include Unicode punctuation, em dashes, accented characters, or BOM markers; parsing and release rendering must preserve UTF-8 content without corrupting tag calculation.
- **Repository state:** dirty working tree, detached HEAD, missing commit selectors, pre-existing tags pointing at the wrong SHA, duplicate annual rows pointing at the same commit, duplicate annual rows normalizing to the same `pl/*` tag, hand-edited or stale manifest contents, or chronologically decreasing snapshot dates.
- **Concurrency:** two milestone commands targeting the same repo simultaneously must not leave a partially written `.us-code-tools/milestones.json`; one may fail deterministically with a lock/conflict error.
- **Subsystem failure:** `gh` CLI missing, not authenticated, or returning a non-zero exit during release creation must leave already-created git tags intact and must not create duplicate release records on retry.
- **Partial failure:** some Congress releases already exist while a later release creation fails; rerun must update existing releases in place and continue from manifest state without duplicating earlier releases.
- **Fallback behavior:** if no snapshot occurs on or after a presidential inauguration date inside the metadata window, the workflow records an explicit skipped-president entry instead of choosing the nearest earlier snapshot.
- **First baseline release:** the earliest in-scope Congress release has no predecessor tag; planning must emit `previous_tag: null` / `previous_tag_sha: null`, and release rendering must use the fixed baseline sentence rather than attempting `git diff` against a nonexistent tag.
- **Recovery:** once repo cleanliness, metadata validity, or GitHub auth problems are fixed, rerunning the command should succeed without moving existing correct tags.
- **Time boundaries:** inauguration dates, annual snapshot dates, and Congress ordering must be computed in ISO calendar dates only; timezone or DST differences must not change tag selection.

## Verification Strategy
- **Pure core:** metadata schema validation, chronological ordering checks, president-tag derivation, release-candidate planning, ordinal/title rendering, and manifest serialization should be pure functions with unit coverage.
- **Properties:**
  - Every annual metadata row produces exactly one `annual/*` tag and exactly one paired release-point `pl/*` tag on the same commit, or a validation failure.
  - Every `congress/*` tag points at the same SHA as one annual row marked `is_congress_boundary: true`.
  - Every Congress release body derives its `Summary`, `Notable Laws`, and `Narrative` from exactly one boundary row for that Congress; zero or multiple boundary rows is a validation failure.
  - President tags are derived only from `president_terms[]` inauguration metadata plus annual snapshot dates and never from mutable repo state outside the resolved annual commits.
  - No valid rerun changes a correct existing tag or duplicates an existing release.
  - `milestones release` trusts the manifest only when its metadata digest and resolved tag SHAs exactly match a freshly recomputed plan for the same target repo and metadata file; otherwise it fails before any GitHub write.
  - Release lookup is keyed by tag name, so one tag maps to at most one GitHub Release.
  - The earliest in-scope Congress release is rendered without a diff base and is still deterministic because its `previous_tag` is null and its body uses the fixed baseline sentence.
- **Purity boundary:** git inspection/tag creation, filesystem writes for `.us-code-tools/milestones.json`, and `gh` CLI calls live in thin adapters; planning and rendering logic stay unit-testable without shelling out.

## Infrastructure Requirements
- **Database:** None.
- **API endpoints:** None directly; GitHub interaction is through `gh` CLI only.
- **Infrastructure:** Local git repository access, local manifest file under target repo, and authenticated `gh` CLI for release publication.
- **Environment variables / secrets:** No new secrets for plan/apply; existing GitHub auth used by `gh` CLI for release publication.

## Complexity Estimate
L

## Decomposition Notes
This spec should decompose into at least four implementation slices:
1. Metadata schema + pure planners for annual/congress/president tags.
2. Git tag application + milestone manifest persistence + repo locking/safety.
3. Release-body renderer + Congress release candidate generation from diff stats.
4. `gh` integration + idempotent release create/update tests + CLI wiring.

## Required Skills
TypeScript, git CLI orchestration, schema validation, deterministic markdown/text rendering, Vitest, GitHub CLI integration
