# Security Notes

## Trust Boundary
- Untrusted inputs:
  - CLI flags (`transform` and `backfill`)
  - target path contents and git metadata in the downstream repo
  - existing target-repo history/branch state
  - configured remote behavior during `git push`
  - remote OLRC ZIP/XML payloads for the transform flow
- Trusted application data:
  - committed Constitution dataset in `src/backfill/constitution/dataset.ts`

## Implemented Controls

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
  - validates cached/downloaded ZIP openability with `yauzl`
- `src/utils/fs.ts` still enforces safe output-root containment for transform output.

## Security Decisions with Rationale
- **Strict non-git directory handling:** avoids initializing over pre-existing content and accidentally mutating unrelated operator files.
- **Clean-tree preflight:** avoids mixing historical backfill writes with operator changes and makes failures easier to inspect.
- **Contiguous-prefix-only resume:** prevents ambiguous repair behavior and stops the tool from silently appending foundational history after unrelated commits.
- **Explicit branch push:** prevents configured-remote repos without upstream from failing at the final network step.
- **Static Constitution dataset:** keeps the backfill path offline and deterministic; no runtime trust in external text sources.

## Things Future Agents Should Not Mislabel as Bugs
- No database/auth/RLS: intentional; this repo is a local CLI, not a service.
- Populated non-git directory rejection is a feature, not an inconvenience to remove.
- Rejection of non-prefix history is intentional; this phase does not repair or rewrite history.
- Local-only repos with no remote are valid success cases (`pushResult: skipped-local-only`).
- `git fast-import` is intentional for historical author/date control; do not replace it casually with ordinary `git commit` without revalidating exact-history guarantees.

## Phase 1 Scope (Current)
- What's implemented:
  - strict target bootstrap rules
  - dirty-tree and detached-HEAD rejection
  - exact-prefix history validation
  - deterministic UTC historical commit dating
  - explicit-branch remote push behavior
  - legacy transform ZIP/output hardening remains in place
- What's intentionally deferred:
  - signed-commit enforcement
  - remote authenticity verification beyond operator-configured git remotes
  - automatic recovery/repair for malformed target histories
  - runtime fetching/verification of Constitution text from remote sources
- What's a test double vs production:
  - temp repos and bare remotes in tests are doubles for downstream targets
  - actual repo-preflight and git execution code paths are production paths exercised in integration tests
