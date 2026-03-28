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
- Added USLM XML parsing in `src/transforms/uslm-to-ir.ts`:
  - title/chapter/section extraction
  - chapter-contained section collection
  - nested legal hierarchy mapping
  - section-local parse errors and bounded field-size handling
  - dedicated `sourceCredits` vs `editorialNotes`
- Added markdown rendering in `src/transforms/markdown.ts` for section files and `_title.md`.
- Added deterministic output writing in `src/transforms/write-output.ts` and `src/utils/fs.ts` with safe-path and symlink checks.
- Added fixture-backed unit/integration/snapshot coverage plus adversary regression suites through round 3.
- Current verified state from latest dev/adversary comments:
  - `npx vitest run` passing
  - `npx tsc --noEmit` passing
  - `npm run build` passing
  - adversary review approved

## Phase 1 Scope (Current)
- What's implemented:
  - single-title OLRC → markdown transformer
- What's intentionally deferred:
  - sync/backfill/git automation and multi-source ingestion
- What's a test double vs production:
  - fixture-backed Title 1 integration coverage is intentional for deterministic CI
