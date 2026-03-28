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
- Run backfill after build:
  - `node dist/index.js backfill --phase constitution --target ./test-repo`
- Run transform after build:
  - `node dist/index.js transform --title 1 --output ./out`
- Public CLI entry in `package.json`: `us-code-tools -> ./dist/index.js`
- CI/build note: integration tests shell out to `dist/index.js`, so `npm run build` must happen before Vitest when validating CLI behavior.

## Tech Stack
- Runtime: Node.js 22+
- Package manager: npm
- Language: TypeScript (`strict: true`)
- XML parsing: `fast-xml-parser`
- Frontmatter: `gray-matter`
- ZIP handling: `yauzl`
- Testing: Vitest
- Git integration: system `git` CLI via `child_process`

## File Layout
- `src/index.ts` — dispatches `transform` and `backfill`
- `src/backfill/constitution/dataset.ts` — static Constitution records + author metadata
- `src/backfill/renderer.ts` — Constitution markdown/frontmatter renderer
- `src/backfill/messages.ts` — exact historical commit-message templates
- `src/backfill/planner.ts` — 28-event plan builder
- `src/backfill/target-repo.ts` — repo prep / preflight / prefix detection / remote resolution
- `src/backfill/git-adapter.ts` — git wrapper + fast-import commit creation
- `src/backfill/orchestrator.ts` — applies missing suffix events and pushes current branch
- `src/domain/`, `src/sources/`, `src/transforms/`, `src/utils/` — existing transform pipeline
- `tests/unit/` — pure-module coverage
- `tests/integration/` — built CLI end-to-end coverage
- `tests/adversary-round1-issue3.test.ts` — remote-push regression for issue #3

## Module Dependency Graph

### If you're modifying... → Read these first:
- `src/index.ts` → `src/backfill/orchestrator.ts`, `src/sources/olrc.ts`, `src/transforms/uslm-to-ir.ts`, `src/transforms/write-output.ts`
- `src/backfill/orchestrator.ts` → `src/backfill/planner.ts`, `src/backfill/constitution/dataset.ts`, `src/backfill/target-repo.ts`, `src/backfill/git-adapter.ts`
- `src/backfill/target-repo.ts` → `src/backfill/planner.ts`, `src/backfill/git-adapter.ts` (prefix checks depend on planned commit metadata and git inspection)
- `src/backfill/git-adapter.ts` → `src/backfill/planner.ts` (commit creation consumes `HistoricalEvent`)
- `src/backfill/planner.ts` → `src/backfill/constitution/dataset.ts`, `src/backfill/renderer.ts`, `src/backfill/messages.ts`
- `src/backfill/renderer.ts` → `src/backfill/constitution/dataset.ts`, `gray-matter`
- `src/backfill/messages.ts` → no downstream state; keep pure and template-exact
- `src/transforms/write-output.ts` → `src/transforms/markdown.ts`, `src/utils/fs.ts`, `src/domain/model.ts`
- `src/sources/olrc.ts` → `src/domain/model.ts`, `src/domain/normalize.ts`, `src/types/yauzl.d.ts`

### Call Chain: Entry Point → Your Code
```text
src/index.ts (main)
  → runBackfillCommand()
    → runConstitutionBackfill()
      → buildConstitutionPlan(constitutionDataset)
        → renderConstitutionProvision()
        → renderConstitutionCommitMessage()
        → renderAmendmentCommitMessage()
      → prepareTargetRepo()
        → ensureGitRepo()
        → ensureAttachedHead()
        → ensureCleanWorkingTree()
        → detectMatchingPrefix()
        → detectPushRemoteName()
      → commitHistoricalEvent()
      → git push --set-upstream <remote> <branch> (if remote exists)
```

### Key Interfaces (the contracts)
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
- Summary objects use camelCase in code (`eventsApplied`, `pushResult`); tests tolerate both camelCase and snake_case when parsing CLI output.

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
- What's intentionally deferred:
  - additional backfill phases
  - auto-repair of internal-gap histories
  - downstream repo PR workflows
  - live Constitution fetching from external sources
- What's a test double vs production:
  - temp repos / bare remotes in tests are doubles
  - committed Constitution dataset and real git CLI orchestration are production paths
