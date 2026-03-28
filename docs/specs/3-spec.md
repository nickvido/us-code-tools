## [spec-writer] — Initial spec drafted
See `docs/specs/3-spec.md` for the canonical spec.

# Constitution Backfill — Articles & Amendments as Backdated Commits

## Summary
Add a new `backfill --phase=constitution --target <path>` workflow to `us-code-tools` that writes the full U.S. Constitution into a target `us-code` git repository as deterministic historical commits: one commit for Articles I–VII on the Constitution’s ratification date, followed by one commit per amendment through Amendment XXVII on each amendment’s ratification date. The implementation must be offline-testable, idempotent on re-run, and reusable as the first backfill phase for later historical-ingestion work.

## Context
- The repo already defines a CLI package (`package.json` bin: `us-code-tools`) and an existing `transform` command implemented in `src/index.ts`, plus current transform/domain/source modules and Vitest coverage.
- `SPEC.md` already defines the Constitution content model and path conventions, but its broader project structure is aspirational in places; this issue must extend the existing tool surface rather than assuming the scaffold is empty.
- This is the first workflow in this repo that mutates a downstream git repository instead of only transforming local source data into files.
- Later backfill phases will reuse the same planning, rendering, repository-opening, commit-writing, and push orchestration patterns, so determinism, idempotency, and resume behavior are non-negotiable.
- The Constitution source data is effectively static and must be committed in-repo so builds and tests remain offline and deterministic.

## Acceptance Criteria

### 1. CLI Surface
- [ ] Add a new CLI entry path for `backfill` such that `npx us-code-tools backfill --phase=constitution --target <path>` invokes Constitution backfill orchestration.  
  <!-- Touches: existing `src/index.ts` CLI bootstrap or equivalent dispatcher, new backfill command parser module, CLI tests -->
- [ ] The existing `transform` command behavior remains available and its current tests continue to pass after `backfill` is added.  
  <!-- Touches: CLI dispatcher, existing transform tests -->
- [ ] The CLI rejects each invalid invocation with a non-zero exit code and a deterministic error message: missing `--phase`, missing `--target`, unsupported `--phase`, and `--target` resolving to a non-directory path.  
  <!-- Touches: CLI parser/validator, CLI tests -->
- [ ] The CLI accepts either: (a) an existing local git repository whose history is empty or already matches a prefix of the 28-event Constitution plan, or (b) a non-existent target path that the workflow will `git init` as a new local repository before backfilling. It must reject a target repository containing unrelated pre-existing commits with a deterministic non-zero exit and error message, rather than appending Constitution history after unrelated commits.  
  <!-- Touches: repository opener/precondition validator, integration tests -->
- [ ] If `--target` points to an existing empty directory that is not already a git repository, the workflow must `git init` in that directory and proceed with Constitution backfill. If `--target` points to an existing non-git directory that already contains files or subdirectories, the workflow must reject it with a deterministic non-zero exit and error message and must not initialize git over that pre-existing content.  
  <!-- Touches: repository opener/precondition validator, integration tests -->
- [ ] Before writing any Constitution files or creating any commits in an existing git repository, the workflow must verify that the working tree is clean (no staged changes, unstaged tracked-file changes, or untracked files). If the repo is dirty, the command exits non-zero with a deterministic error message and creates 0 new commits.  
  <!-- Touches: repository preflight validator, integration tests -->
- [ ] If the target repo has no configured remote (e.g., a freshly `git init`'d repo or `--target ./test-repo`), the push step is skipped and the command exits `0` after all 28 local commits are created. The CLI must NOT fail because push has no remote to push to.  
  <!-- Touches: push adapter, integration tests -->

### 2. Static Constitution Dataset
- [ ] Commit a static Constitution dataset in this repository containing exactly 7 articles and 27 amendments, each with: `type`, `number`, `heading`, `proposed`, `ratified`, `proposing_body`, `source`, and full markdown-ready text content.  
  <!-- Touches: new data module(s) or fixtures under `src/` and/or `tests/fixtures/` -->
- [ ] The dataset records the original Constitution as proposed on `1787-09-17`, ratified on `1788-06-21`, and sourced from `https://constitution.congress.gov/constitution/`; each amendment record uses its correct proposal date, ratification date, proposing body, and browse URL.  
  <!-- Touches: static dataset, dataset validation tests -->
- [ ] Article content preserves constitutional structure in source form so rendering can emit all article sections and subordinate clauses without collapsing or summarizing them.  
  <!-- Touches: static dataset shape, renderer tests -->

### 3. Markdown Rendering
- [ ] Render exactly these article files in the target repo: `constitution/article-I.md`, `constitution/article-II.md`, `constitution/article-III.md`, `constitution/article-IV.md`, `constitution/article-V.md`, `constitution/article-VI.md`, and `constitution/article-VII.md`.  
  <!-- Touches: renderer, path planner, snapshot/integration tests -->
- [ ] Render exactly these amendment files in the target repo: `constitution/amendment-01.md` through `constitution/amendment-27.md`, zero-padded to two digits.  
  <!-- Touches: renderer, path planner, snapshot/integration tests -->
- [ ] Every rendered file begins with parseable YAML frontmatter containing `type`, `number`, `heading`, `ratified`, `proposed`, `proposing_body`, and `source`, followed by deterministic markdown body content.  
  <!-- Touches: renderer, frontmatter validation tests -->
- [ ] Rendering the same dataset twice without changing inputs produces byte-identical file content for every Constitution markdown file.  
  <!-- Touches: pure renderer, unit tests -->
- [ ] Article markdown preserves all article section headings and ordered internal structure; amendment markdown includes the full amendment text and does not replace any provision with summaries, placeholders, or ellipses not present in the official text.  
  <!-- Touches: renderer, snapshot tests -->

### 4. Historical Event Planning
- [ ] Build a pure planning function that produces exactly 28 historical events in non-decreasing ratification-date order: 1 Constitution event, 10 Bill of Rights events dated `1791-12-15`, and 17 amendment events dated from Amendment XI through Amendment XXVII.  
  <!-- Touches: planner module, planner unit tests -->
- [ ] The Constitution event writes all seven article files in a single commit dated `1788-06-21`; each amendment event writes or updates exactly one amendment file in its own commit dated to that amendment’s ratification date.  
  <!-- Touches: planner, repository writer, integration tests -->
- [ ] For same-day ratifications, planner order is stable and deterministic: Amendments I through X are committed in numeric order on `1791-12-15`.  
  <!-- Touches: planner, unit tests -->

### 5. Commit Authoring and Messages
- [ ] Each historical commit is created with both `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` set to exactly `YYYY-MM-DDT00:00:00+0000` for that event’s ratification date (for example, Amendment XXVII must use `1992-05-07T00:00:00+0000` for both variables).  
  <!-- Touches: git commit adapter, unit/integration tests -->
- [ ] The commit author name and email are deterministic for all 28 events. The complete mapping is:
  | Event | Author Name | Author Email |
  |-------|-------------|--------------|
  | Constitution (Articles I-VII) | Constitutional Convention | convention@constitution.gov |
  | Amendments I-X (Bill of Rights) | 1st Congress | congress-1@congress.gov |
  | Amendment XI | 3rd Congress | congress-3@congress.gov |
  | Amendment XII | 8th Congress | congress-8@congress.gov |
  | Amendment XIII | 38th Congress | congress-38@congress.gov |
  | Amendment XIV | 39th Congress | congress-39@congress.gov |
  | Amendment XV | 40th Congress | congress-40@congress.gov |
  | Amendment XVI | 61st Congress | congress-61@congress.gov |
  | Amendment XVII | 62nd Congress | congress-62@congress.gov |
  | Amendment XVIII | 65th Congress | congress-65@congress.gov |
  | Amendment XIX | 66th Congress | congress-66@congress.gov |
  | Amendment XX | 72nd Congress | congress-72@congress.gov |
  | Amendment XXI | 72nd Congress | congress-72@congress.gov |
  | Amendment XXII | 80th Congress | congress-80@congress.gov |
  | Amendment XXIII | 86th Congress | congress-86@congress.gov |
  | Amendment XXIV | 87th Congress | congress-87@congress.gov |
  | Amendment XXV | 89th Congress | congress-89@congress.gov |
  | Amendment XXVI | 92nd Congress | congress-92@congress.gov |
  | Amendment XXVII | 1st Congress | congress-1@congress.gov |
  <!-- Touches: author mapping logic, planner/commit tests -->
- [ ] The Constitution commit message matches this template exactly, with field values filled from the dataset:
  ```
  Constitution of the United States

  Signed: 1787-09-17 by Constitutional Convention
  Ratified: 1788-06-21 (9th state: New Hampshire)

  Source: https://constitution.congress.gov/constitution/
  ```
  <!-- Touches: commit message formatter, snapshot tests -->
- [ ] Every amendment commit message matches this template exactly, with the correct Roman numeral amendment label, heading, proposed date, proposing body, ratified date, and source URL:
  ```
  Amendment XIV: Citizenship, equal protection, due process

  Proposed: 1866-06-13 by 39th Congress
  Ratified: 1868-07-09

  Source: https://constitution.congress.gov/browse/amendment-14/
  ```
  <!-- Touches: commit message formatter, snapshot tests -->

### 6. Repository Orchestration and Idempotency
- [ ] ⚡ Implement repository orchestration that can open or prepare the target repository, apply planned file writes, create commits, and invoke a push step through a repository adapter that is mockable in tests. The success contract is explicit and limited to two cases only: (a) if the repo has a configured push remote, the command exits `0` only after all 28 planned local commits have been created (or found already present on a re-run) and the adapter reports `pushed`; (b) if the repo has no configured push remote, the adapter must not attempt a network push and must report `skipped-local-only`, after which the command exits `0` once the full 28-event local history is present. Any actual push attempt against a configured remote that fails after local history creation must make the command exit non-zero while preserving local commits.  
  <!-- Touches: repository adapter, backfill orchestrator, integration tests -->
- [ ] Running Constitution backfill against an empty temp git repository creates exactly 28 commits on the current branch, leaves all 34 Constitution markdown files present in the working tree, and leaves the working tree clean at process exit.  
  <!-- Touches: orchestrator, git adapter, integration tests -->
- [ ] A second run against a fully backfilled repo creates 0 additional commits and does not rewrite existing commit history.  
  <!-- Touches: idempotency detection, integration tests -->
- [ ] A run against a partially completed Constitution history is supported only when the existing history is a contiguous prefix of the 28-event plan (for example, events 1..N already exist in order). In that case the workflow resumes from event N+1 without replaying earlier events or altering already-correct files and commits. Repos with non-contiguous Constitution history (for example, events 1, 2, and 4 present while event 3 is missing) are rejected with a deterministic non-zero error and are not repaired in place.  
  <!-- Touches: resume detection logic, integration tests -->
- [ ] If the push step fails after local commits are created, the command exits non-zero, reports the push failure, preserves the completed local history, and does not create extra commits on the next run.  
  <!-- Touches: push adapter, failure-mode integration tests -->

### 7. Test and Build Gates
- [ ] Add unit tests covering: CLI argument validation, Constitution dataset completeness, deterministic markdown rendering, frontmatter parsing, historical-event planning, commit-message formatting, and backdated git environment construction.  
  <!-- Touches: new `tests/` suites -->
- [ ] Add snapshot tests for at least: Article I markdown, Amendment I markdown, Amendment XIV commit message, and the Constitution commit message.  
  <!-- Touches: snapshot fixtures/tests -->
- [ ] Add an integration test that runs Constitution backfill against a temporary git repository and verifies all of the following mechanically: 34 rendered files exist, `git rev-list --count HEAD` equals `28`, `git log --reverse --format="%ai %s"` starts with `1788-06-21 00:00:00 +0000`, ends with `1992-05-07 00:00:00 +0000`, never decreases by date, and a second run leaves commit count unchanged.  
  <!-- Touches: end-to-end integration tests -->
- [ ] `npm test` and `npm run build` both exit `0` after implementation.  
  <!-- Touches: package scripts, TypeScript config, all new code -->

## Out of Scope
- Backfilling any non-Constitution `us-code` content, including baseline US Code titles, public laws, or pending bills
- Modeling floor votes, committee actions, PR timelines, or congressional members beyond deterministic proposing-body commit authors
- Runtime fetching of Constitution text from remote services during normal command execution or tests
- Rewriting or force-pushing already-correct Constitution history in a target repo
- Cross-repo automation such as opening PRs in `us-code` as part of this issue

## Dependencies
- Git CLI available in the execution environment
- Node.js 22+
- `gray-matter` for YAML frontmatter validation/rendering
- A committed static Constitution dataset bundled in this repo
- A testable repository adapter layer for local git operations and push invocation

## Acceptance Tests (human-readable)
1. Run `npm install` if dependencies are not yet installed.
2. Run `npm run build`; expect exit code `0`.
3. Create an empty temporary git repository.
4. Run `npx us-code-tools backfill --phase=constitution --target <temp-repo>`.
5. Verify `constitution/article-I.md` through `constitution/article-VII.md` and `constitution/amendment-01.md` through `constitution/amendment-27.md` exist in the target repo.
6. Parse frontmatter from several files and verify required keys plus expected ratified/proposed/source values.
7. Run `git rev-list --count HEAD` in the target repo; expect `28`.
8. Run `git log --reverse --format="%ai %s"`; verify the first entry begins `1788-06-21 00:00:00 +0000`, the last begins `1992-05-07 00:00:00 +0000`, Amendments I–X appear in numeric order on `1791-12-15`, and dates never decrease.
9. Re-run `npx us-code-tools backfill --phase=constitution --target <temp-repo>`; verify commit count remains `28`.
10. Simulate a partial repo by resetting to an early Constitution commit or preparing a repo with only the first N planned events; rerun backfill and verify only missing later events are added.
11. Run the command with `--target` pointing at an existing empty non-git directory; verify the workflow initializes git there and completes successfully.
12. Run the command with `--target` pointing at an existing populated non-git directory; verify the command exits non-zero with the documented error and does not initialize git in that directory.
13. Simulate a target repo with unrelated pre-existing commits; verify the command exits non-zero with the documented error and does not append Constitution commits after that history.
14. Dirty an otherwise valid target git repo before execution; verify the command exits non-zero with the documented error and creates 0 new commits.
15. Run the command against a freshly initialized local repo with no remote configured; verify it still exits `0` after creating 28 commits and that the repository adapter reports `skipped-local-only`.
16. Simulate a push failure in tests via the repository adapter and verify local commits remain intact while the command exits non-zero.
17. Run `npm test`; expect unit, snapshot, and integration suites to pass.

## Edge Case Catalog
- Missing CLI args, unsupported `--phase`, empty `--target`, repeated flags, extra unknown flags, and `--target` pointing at a regular file instead of a directory
- **Non-existent target path:** `git init` a new repo at that path, then backfill. Exit `0`.
- **Existing empty directory (not a git repo):** `git init` in that directory, then backfill. Exit `0`.
- **Existing non-git directory with files:** reject with non-zero exit and error message (do not `git init` over existing non-git content).
- **Existing git repo with Constitution-history prefix:** resume from next missing event. Exit `0`.
- **Existing git repo with unrelated commits:** reject with non-zero exit and error message.
- **Detached HEAD target repo:** reject with non-zero exit and error message.
- **Target repos with no configured push remote:** skip push, report `skipped-local-only`, exit `0`.
- **Dirty working tree:** reject with non-zero exit and error message before creating any commits. The backfill command must not run against a repo with uncommitted changes.
- Partial-progress repositories are supported only when existing Constitution commits form a contiguous prefix of the 28-event plan (e.g., only the first 5 commits exist). Internal gaps are NOT supported — a repo with commits 1, 2, 4 but missing 3 is treated as unrelated/non-prefix history and rejected rather than repaired.
- Duplicate dataset records, missing article/amendment numbers, malformed dates, empty headings, missing source URLs, truncated text, BOM-prefixed text, or invalid UTF-8 in static source assets
- Deterministic ordering for same-day ratifications, especially Amendments I–X on `1791-12-15`
- Dirty working tree before execution: reject before any new files or commits are created. Dirty state introduced by a failed internal write/commit step: surface the failure explicitly; do not add extra recovery commits, and leave the repo in an inspectable state for rerun after the operator cleans it up.
- Configured-remote push failure after all local commits succeed (for example authentication or network failure after the adapter attempts `push`); recovery by re-running without duplicating local history
- Time-format drift caused by local timezone differences, daylight saving transitions, or differing git date parsing behavior across environments
- Recovery behavior when the repository adapter, filesystem write, or git commit step fails midway through the 28-event plan
- Local-only repos (no remote configured): push step is skipped, command exits `0` after creating all 28 local commits. This is distinct from push *failure* (remote exists but push fails), which exits non-zero.

## Verification Strategy
- **Pure core:** Constitution dataset validation, file-path planning, markdown rendering, commit-message formatting, author mapping, and event planning should be pure functions with snapshot/unit coverage.
- **Properties:**
  - Planned Constitution event count is always 28.
  - Planned event order is non-decreasing by ratification date and stable for same-day events.
  - Rendered file paths are unique and match the allowed Constitution path set.
  - Every rendered markdown document has parseable frontmatter with the required key set.
  - Re-rendering the same record yields byte-identical output.
  - Idempotent runs do not increase commit count once the repo matches the plan.
- **Purity boundary:** Filesystem mutation, git command execution, repository clone/open, and push invocation live behind thin adapters exercised by integration tests; all history planning and text formatting remain pure and testable without I/O.

## Infrastructure Requirements
- **Database:** None.
- **API endpoints:** None for this issue.
- **Infrastructure:** Local git repository access only; no queues, caches, or remote services required for normal execution.
- **Environment variables / secrets:** None required for Constitution backfill itself; push tests should use mocked adapters rather than real credentials.

## Complexity Estimate
L

## Decomposition Notes
This issue should decompose into at least four implementation tasks:
1. Static Constitution dataset + renderer + snapshots
2. Backfill planner + author/message formatting
3. Repository adapter + idempotent/resumable orchestration + push behavior
4. CLI wiring + integration/build/test hardening

## Required Skills
TypeScript, Vitest, Git CLI orchestration, markdown/frontmatter generation
