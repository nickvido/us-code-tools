# Changelog

## Feature #1 — USLM XML to Markdown Transformer
- Bootstrapped `us-code-tools` as a strict TypeScript + npm + Vitest package with a built CLI entry.
- Implemented `transform --title <number> --output <dir>` in `src/index.ts`.
- Added OLRC ZIP download/caching in `src/sources/olrc.ts`, including:
  - deterministic releasepoint URL resolution
  - cache manifest/SHA validation
  - atomic invalid-cache cleanup + redownload
  - 30s timeout + single retry for transient failures
  - ZIP hardening for unsafe paths, duplicate destinations, special entries, and extraction byte caps
  - ZIP openability validation for both cached artifacts and freshly downloaded payloads before reuse/promotion
- Added USLM XML parsing in `src/transforms/uslm-to-ir.ts`:
  - title/chapter/section extraction
  - chapter-contained section collection
  - nested legal hierarchy mapping
  - section-local parse errors and bounded field-size handling
  - dedicated `sourceCredits` vs `editorialNotes`
- Added markdown rendering in `src/transforms/markdown.ts` for section files and `_title.md`.
- Added deterministic output writing in `src/transforms/write-output.ts` and `src/utils/fs.ts` with safe-path and symlink checks.
- Added fixture-backed unit/integration/snapshot coverage plus adversary regression suites through round 5.
- Round 4/5 fixes now landed on branch `df2/issue-1`:
  - duplicate merged `sectionNumber` values are detected in `src/index.ts` via `seenSectionNumbers`, reported as `INVALID_XML`, omitted from output, and cause the transform to exit non-zero
  - `_title.md` write failures are converted into `OUTPUT_WRITE_FAILED` parse errors in `src/transforms/write-output.ts`, preserving the final JSON report and partial-success exit semantics when section files were written
  - unreadable PK-prefixed ZIP artifacts are rejected during both cache validation and post-download promotion in `src/sources/olrc.ts`
- Verified at branch head `bf7e32b` (`origin/df2/issue-1`): `npx vitest run` (38 passing), `npx tsc --noEmit`, and `npm run build` all succeed.
- PR #2 (`[DF2] #1: USLM XML to Markdown Transformer`) remains the active implementation PR for this branch.

## Phase 1 Scope (Current)
- What's implemented:
  - single-title OLRC → markdown transformer
- What's intentionally deferred:
  - sync/backfill/git automation and multi-source ingestion
- What's a test double vs production:
  - fixture-backed Title 1 integration coverage is intentional for deterministic CI
