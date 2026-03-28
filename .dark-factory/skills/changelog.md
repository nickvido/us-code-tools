# Changelog

## Feature #1 — USLM XML to Markdown Transformer
- Bootstrapped `us-code-tools` as a strict TypeScript + npm + Vitest package with a built CLI entry.
- Implemented `transform --title <number> --output <dir>` in `src/index.ts`.
- Added OLRC ZIP download/caching in `src/sources/olrc.ts`, including deterministic releasepoint URL resolution, cache manifest/SHA validation, invalid-cache cleanup, timeout/retry behavior, ZIP hardening, and openability validation.
- Added USLM XML parsing in `src/transforms/uslm-to-ir.ts` with title/chapter/section extraction, bounded parse errors, and dedicated `sourceCredits` vs `editorialNotes`.
- Added markdown rendering in `src/transforms/markdown.ts` and deterministic output writing in `src/transforms/write-output.ts` / `src/utils/fs.ts`.
- Added fixture-backed unit/integration/snapshot coverage plus adversary regression suites through round 5.
- CI follow-up: `.github/workflows/ci.yml` now builds before Vitest because CLI integration tests execute `dist/index.js`.

## Feature #3 — Constitution Backfill — Articles & Amendments as Backdated Commits
- Added `backfill` command parsing in `src/index.ts` while preserving existing `transform` behavior.
- Added committed Constitution source-of-truth data in `src/backfill/constitution/dataset.ts`:
  - 7 articles
  - 27 amendments
  - proposal/ratification metadata
  - deterministic author identity metadata
  - markdown-ready text bodies
- Added deterministic Constitution rendering in `src/backfill/renderer.ts` using YAML frontmatter with `gray-matter`.
- Added exact historical commit message templates in `src/backfill/messages.ts`.
- Added pure 28-event planning in `src/backfill/planner.ts`:
  - one foundational Constitution event
  - one event per amendment
  - stable same-day ordering for Amendments I–X
- Added target-repo bootstrap and preflight logic in `src/backfill/target-repo.ts`:
  - initialize missing targets
  - initialize existing empty non-git directories
  - reject populated non-git directories
  - reject detached HEAD
  - reject dirty working trees
  - reject unrelated/non-prefix history
  - resolve push remote deterministically
- Added historical git execution in `src/backfill/git-adapter.ts`:
  - exact UTC historical dates
  - deterministic author metadata
  - `git fast-import` commit creation
  - fallback committer identity
- Added end-to-end orchestration in `src/backfill/orchestrator.ts`:
  - apply only missing suffix events
  - preserve idempotency on rerun
  - classify push result as `pushed` vs `skipped-local-only`
  - fail non-zero on real push failures while preserving local history
- Added issue #3 test coverage:
  - `tests/unit/backfill-cli-args.test.ts`
  - `tests/unit/backfill-dataset.test.ts`
  - `tests/unit/backfill-renderer.test.ts`
  - `tests/unit/backfill-messages.test.ts`
  - `tests/unit/backfill-planner.test.ts`
  - `tests/unit/backfill-git-env.test.ts`
  - `tests/integration/backfill-constitution.test.ts`
  - `tests/adversary-round1-issue3.test.ts`
- Adversary regression fix landed at current branch head: configured-remote repos without upstream now push with `git push --set-upstream <remote> <branch>` instead of failing on bare `git push`.
- Latest implementation verification from issue context:
  - `npx vitest run tests/adversary-round1-issue3.test.ts` ✅
  - `npm test` ✅
  - `npx tsc --noEmit` ✅
  - `npm run build` ✅

## Phase 1 Scope (Current)
- What's implemented:
  - Title transform flow from issue #1
  - Constitution backfill flow from issue #3
- What's intentionally deferred:
  - later historical backfill phases (US Code titles, public laws)
  - history rewrite/repair behavior beyond contiguous-prefix resume
- What's a test double vs production:
  - transform fixtures and temp repos/remotes are intentional test doubles
  - committed Constitution dataset is production application data
