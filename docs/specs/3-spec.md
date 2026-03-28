# Constitution Backfill — Articles & Amendments as Backdated Commits

## Summary
Add a new `backfill` CLI workflow to `us-code-tools` that materializes the U.S. Constitution into a target `us-code` git repository as a deterministic sequence of 28 backdated commits: one foundational Constitution commit containing Articles I–VII, followed by one commit per amendment in ratification order through Amendment XXVII. This establishes the first reusable historical-ingestion path for the `us-code` repository and defines the content, commit metadata, idempotency, and test boundaries required for later backfill phases.

## Context
- The repository already implements a `transform` CLI path for OLRC USLM input and contains real modules at `src/index.ts`, `src/domain/*`, `src/transforms/*`, and `src/utils/*`.
- `SPEC.md` defines a Constitution content model at `constitution/article-{N}.md` and `constitution/amendment-{NN}.md`, but the current repo has no Constitution-specific backfill engine, no git history writer, and no Constitution content source.
- This issue is the first workflow that writes historical content into the downstream `us-code` repository rather than only generating local markdown files.
- The implementation must preserve historically accurate ratification dates and proposing-body attribution so `git log`, `git blame`, and future ingestion phases can treat the Constitution as the canonical legal foundation.
- The solution must be deterministic and idempotent because later backfill phases will reuse the same orchestration pattern against already-initialized repositories.
- The target repository is external (`v1d0b0t/us-code`), but this spec is limited to changes inside `us-code-tools`; no cross-repo source changes are specified here.

## Acceptance Criteria

### 1. CLI surface and target repository validation
- [ ] `src/index.ts` is extended with a new `backfill` command that accepts `--phase=constitution` and `--target <path>`, exits with status `0` on success, and prints a usage error plus non-zero exit status when `--phase` or `--target` is missing.
  <!-- Touches: src/index.ts, tests/unit/backfill-cli.test.ts -->
- [ ] The `backfill` command rejects any `--phase` value other than the literal string `constitution` with a non-zero exit code and does not modify the target path.
  <!-- Touches: src/index.ts, tests/unit/backfill-cli.test.ts -->
- [ ] The command accepts a target path that already contains a git repository or a target path that does not yet exist; if the path does not exist, the implementation creates or clones the target working tree before any Constitution content is written.
  <!-- Touches: src/index.ts, src/backfill/orchestrator.ts, src/git/repository.ts, tests/integration/backfill-constitution.test.ts -->
- [ ] If `--target` points to an existing filesystem object that is not a directory, or to a directory that cannot be initialized/opened as a git repository, the command exits non-zero and writes no Constitution markdown files.
  <!-- Touches: src/index.ts, src/git/repository.ts, tests/unit/backfill-cli.test.ts, tests/integration/backfill-constitution.test.ts -->

### 2. Constitution dataset and markdown rendering
- [ ] A committed Constitution dataset is added under a new implementation module for Constitution content (new module name allowed) and contains exactly 7 articles and exactly 27 amendments, each with official full text, `number`, `heading`, `source`, `proposed`, `ratified`, and `proposing_body` metadata.
  <!-- New module; Touches: src/backfill/constitution-data.ts, tests/unit/constitution-data.test.ts -->
- [ ] The Constitution dataset uses the following source URLs and no unbounded "etc." list: `https://constitution.congress.gov/constitution/` for the original Constitution and `https://constitution.congress.gov/browse/amendment-{N}/` or `https://constitution.congress.gov/browse/article-{N}/` for individual amendments/articles.
  <!-- Touches: src/backfill/constitution-data.ts, tests/unit/constitution-data.test.ts -->
- [ ] A markdown renderer generates `constitution/article-I.md` through `constitution/article-VII.md` and `constitution/amendment-01.md` through `constitution/amendment-27.md` with `gray-matter`-parseable YAML frontmatter containing exactly these required keys for each file: `type`, `number`, `heading`, `ratified`, `proposed`, `proposing_body`, and `source`.
  <!-- Touches: src/backfill/render-constitution.ts, tests/unit/render-constitution.test.ts -->
- [ ] Each article file sets `type: "article"`, uses uppercase Roman numerals in the filename, and preserves the article’s internal hierarchy so every constitutional section appears as a visible markdown subsection heading and every clause/list item remains present in output text order.
  <!-- Touches: src/backfill/render-constitution.ts, tests/unit/render-constitution.test.ts, tests/snapshots/constitution/*.snap -->
- [ ] Each amendment file sets `type: "amendment"`, uses zero-padded two-digit Arabic numbering in the filename (`01` through `27`), and contains the full amendment text rather than a summary or excerpt.
  <!-- Touches: src/backfill/render-constitution.ts, tests/unit/render-constitution.test.ts, tests/snapshots/constitution/*.snap -->
- [ ] Rendered markdown is deterministic: given the same Constitution dataset, two render passes produce byte-identical file content for every article and amendment.
  <!-- Touches: src/backfill/render-constitution.ts, tests/unit/render-constitution.test.ts -->

### 3. Backdated git commit planning and author metadata
- [ ] A pure commit-planning function produces exactly 28 planned historical events in chronological order: 1 Constitution event for Articles I–VII, 10 separate Bill of Rights events for Amendments I–X all ratified on `1791-12-15`, and 17 additional amendment events for Amendments XI–XXVII ordered by ratification date through `1992-05-07`.
  <!-- Touches: src/backfill/plan-constitution.ts, tests/unit/plan-constitution.test.ts -->
- [ ] The Constitution event uses author date `1788-06-21`, proposal/signing date `1787-09-17`, author identity `Constitutional Convention <convention@constitution.gov>`, and commit message body matching this template exactly aside from trailing newline handling:
  `Constitution of the United States\n\nSigned: 1787-09-17 by Constitutional Convention\nRatified: 1788-06-21 (9th state: New Hampshire)\n\nSource: https://constitution.congress.gov/constitution/`.
  <!-- Touches: src/backfill/plan-constitution.ts, tests/unit/plan-constitution.test.ts -->
- [ ] Each amendment event uses `GIT_AUTHOR_DATE` equal to the amendment ratification date, author identity derived from the proposing body for that amendment (for example `1st Congress <congress-1@congress.gov>`), and a commit message body matching this template exactly aside from amendment-specific values and trailing newline handling:
  `Amendment XIV: Citizenship, equal protection, due process\n\nProposed: 1866-06-13 by 39th Congress\nRatified: 1868-07-09\n\nSource: https://constitution.congress.gov/browse/amendment-14/`.
  <!-- Touches: src/backfill/plan-constitution.ts, tests/unit/plan-constitution.test.ts -->
- [ ] The commit-writing layer sets both `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` to the planned ratification date for each historical event so `git log --format="%ai %s"` reports chronological commit dates based on ratification rather than run time.
  <!-- Touches: src/git/backdated-commit.ts, tests/unit/backdated-commit.test.ts, tests/integration/backfill-constitution.test.ts -->

### 4. Repository mutation and idempotent execution
- [ ] Running `npx us-code-tools backfill --phase=constitution --target <repo>` against an empty initialized temp git repository creates exactly 28 commits on the current branch and leaves the working tree clean at the end of the run.
  <!-- Touches: src/backfill/orchestrator.ts, src/git/backdated-commit.ts, tests/integration/backfill-constitution.test.ts -->
- [ ] Commit 1 writes all 7 article markdown files under `constitution/`; commits 2 through 28 each add or update exactly one amendment file under `constitution/` without deleting previously created Constitution files.
  <!-- Touches: src/backfill/orchestrator.ts, tests/integration/backfill-constitution.test.ts -->
- [ ] After a successful first run, a second run against the same target repository is idempotent: it exits with status `0`, creates `0` additional commits, and leaves `git rev-list --count HEAD` unchanged at `28`.
  <!-- Touches: src/backfill/orchestrator.ts, src/git/repository.ts, tests/integration/backfill-constitution.test.ts -->
- [ ] ⚡ If the target repository already contains some but not all Constitution backfill commits, the implementation resumes from the next missing planned event without rewriting earlier historical commits, and the final commit count after completion is still `28`.
  <!-- Cross-module: src/backfill/plan-constitution.ts -> src/backfill/orchestrator.ts -> src/git/repository.ts; Touches: tests/integration/backfill-constitution.test.ts -->
- [ ] If any git write operation fails before a historical event is committed, the command exits non-zero, reports which planned event failed, and does not create a partial extra commit for that failed event.
  <!-- Touches: src/backfill/orchestrator.ts, src/git/backdated-commit.ts, tests/integration/backfill-constitution.test.ts -->
- [ ] On successful completion, the backfill workflow invokes a push step against the configured target repository state; in tests this push behavior is isolated behind a repository adapter so integration tests can verify the push call without requiring network access.
  <!-- Touches: src/backfill/orchestrator.ts, src/git/repository.ts, tests/unit/repository.test.ts, tests/integration/backfill-constitution.test.ts -->

### 5. Verification, snapshots, and build gates
- [ ] The repository includes unit tests for commit planning, backdated commit environment/date handling, Constitution markdown generation, and frontmatter validation using committed expected fixtures or inline fixtures.
  <!-- Touches: tests/unit/plan-constitution.test.ts, tests/unit/backdated-commit.test.ts, tests/unit/render-constitution.test.ts -->
- [ ] The repository includes snapshot coverage for at least these representative documents: `constitution/article-I.md`, `constitution/article-VII.md`, `constitution/amendment-01.md`, and `constitution/amendment-14.md`.
  <!-- Touches: tests/unit/render-constitution.test.ts, tests/__snapshots__/**/* -->
- [ ] The repository includes an integration test that runs the real CLI against a temp git repository, then verifies all of the following mechanically: 28 commits exist, the oldest author date is `1788-06-21`, the newest author date is `1992-05-07`, all expected Constitution file paths exist, and `git log --format="%ai %s"` is in non-decreasing chronological order.
  <!-- Touches: tests/integration/backfill-constitution.test.ts -->
- [ ] `npm test` exits with status `0`, and `npm run build` exits with status `0` without TypeScript errors after the Constitution backfill implementation is added.
  <!-- Touches: package.json, tsconfig.json, tests/**/*.test.ts, src/**/*.ts -->

## Out of Scope
- US Code title backfill beyond the Constitution phase
- Public law or bill-history commit generation
- Pull request creation, vote records, or legislator/member attribution beyond the Constitution proposing-body commit author
- Downloading Constitution text at runtime from remote sources
- Rebasing, force-pushing, or rewriting previously created historical commits in an already-complete target repository
- Any source-code changes inside the downstream `us-code` repository itself

## Dependencies
- Git CLI available in the execution environment
- Node.js 22+ and the existing TypeScript/Vitest toolchain
- `gray-matter` for markdown frontmatter validation/generation
- Official Constitution text and ratification metadata sourced from constitution.congress.gov and/or the National Archives, committed into this repository as static data

## Acceptance Tests (human-readable)
1. Run `npm install` and `npm run build`; verify both succeed.
2. Create a temp git repository, or point `--target` at a clone/worktree of `us-code`.
3. Run `npx us-code-tools backfill --phase=constitution --target ./test-repo`.
4. Verify `./test-repo/constitution/article-I.md` through `article-VII.md` exist.
5. Verify `./test-repo/constitution/amendment-01.md` through `amendment-27.md` exist.
6. Parse several files with `gray-matter` and verify the required frontmatter keys are present and dates match the relevant ratification/proposal dates.
7. Run `git -C ./test-repo rev-list --count HEAD` and verify the result is `28`.
8. Run `git -C ./test-repo log --reverse --format="%ai %s"` and verify the first entry is dated `1788-06-21`, the final entry is dated `1992-05-07`, and the dates do not decrease.
9. Run the same backfill command a second time and verify the commit count remains `28`.
10. Run `npm test` and verify all unit, snapshot, and integration tests pass.

## Edge Case Catalog
- CLI validation: missing `--phase`, missing `--target`, unsupported `--phase`, extra unknown flags, target path points to a file instead of a directory.
- Repository state: target path does not exist yet, target directory exists but is not a git repo, target repo has no commits yet, target repo has unrelated pre-existing commits, target repo already contains all 28 Constitution events.
- Partial progress: target repo contains the Constitution commit plus only some amendment commits; rerun must resume without duplicating or rewriting prior history.
- Data integrity: missing article/amendment heading, blank text body, malformed frontmatter date strings, duplicate amendment numbers, out-of-order ratification dates, truncated Constitution text.
- Filename/path boundaries: article filenames must use only `I`–`VII`; amendment filenames must be zero-padded `01`–`27`; no extra Constitution files may be emitted.
- Encoding issues: smart quotes, em dashes, historical punctuation, UTF-8 BOM, mixed line endings, invalid UTF-8 in committed static data.
- Commit metadata boundaries: same-day ratification events for Amendments I–X, historical dates before 1900, timezone normalization when formatting `git log`, commit author emails derived from proposing bodies with consistent deterministic slugs.
- Subsystem failure: git add/commit/push failure, repository lock file present, write permission denied in target repo, process interrupted between file write and commit.
- Partial failure: one markdown file write fails during a planned event, or push fails after all commits are created; the implementation must make the failure state observable and rerunnable.
- Recovery: rerunning after a failed push or a failed mid-sequence write resumes from the first missing event and finishes with the same final 28-commit history.

## Verification Strategy
- **Pure core:** Constitution dataset normalization, filename derivation, frontmatter assembly, markdown rendering, commit-plan generation, author/email derivation, and idempotency comparison against existing commit subjects/dates should be implemented as pure functions.
- **Properties:**
  - The Constitution plan always yields exactly 28 events.
  - The event list is monotonically non-decreasing by ratification date.
  - Rendered article/amendment markdown always parses through `gray-matter`.
  - Article filenames are exactly `article-I.md` … `article-VII.md`; amendment filenames are exactly `amendment-01.md` … `amendment-27.md`.
  - Re-running against a fully populated repository does not change `HEAD`, working tree contents, or commit count.
- **Purity boundary:** Filesystem writes, git repository initialization/opening, staging, commits, and push are the effectful shell. Tests should isolate those operations behind thin adapters so unit tests can cover planning/rendering without shelling out.

## Infrastructure Requirements
- **Database:** None.
- **API endpoints:** None.
- **Infrastructure:** Local git working tree access to the target repository and temp directories for integration tests.
- **Environment variables / secrets:** No new secrets required for the Constitution phase; pushing uses the existing local git remote/auth configuration already present in the target repository.

## Complexity Estimate
L

Reason: the work spans new CLI behavior, committed historical source data, deterministic markdown generation, git commit orchestration, resume/idempotency behavior, and end-to-end integration testing against a real repository.

## Required Skills
- TypeScript
- Node.js CLI development
- Git automation
- Markdown/YAML generation
- Vitest
- Test fixture design
- Historical data verification
