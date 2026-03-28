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
- **Consequence:** Multi-file archives remain deterministic and CI-testable. Exact `sectionNumber` collisions are now treated as `INVALID_XML`, the colliding section is omitted, and the run exits non-zero to avoid ambiguous output.
- **Feature:** #1 USLM XML to Markdown Transformer

### ADR-004: Treat malformed sections as partial failures, not process-fatal failures
- **Status:** Active
- **Context:** The spec explicitly allows valid sections to be emitted even when some sections fail.
- **Decision:** `parseUslmToIr()` accumulates `ParseError[]`; section-local failures omit only the affected section.
- **Consequence:** CLI exits 0 when at least one section file plus `_title.md` is written.
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
- **Consequence:** Security-sensitive rejection paths must keep regression tests; do not simplify them away for convenience.
- **Feature:** #1 USLM XML to Markdown Transformer

### ADR-007: Refuse symlinked intermediate output directories
- **Status:** Active
- **Context:** Output should not escape the operator-selected tree.
- **Decision:** `assertSafeOutputPath()` rejects symlinked path segments below the output root.
- **Consequence:** Some symlink-heavy local setups may fail intentionally; do not remove this check without revisiting architecture.
- **Feature:** #1 USLM XML to Markdown Transformer

### ADR-008: Preserve structured report semantics when `_title.md` write fails
- **Status:** Active
- **Context:** Section file writes already accumulated `OUTPUT_WRITE_FAILED` parse errors; title metadata writes needed the same partial-failure behavior.
- **Decision:** `_title.md` write failures are converted into `OUTPUT_WRITE_FAILED` parse errors in `src/transforms/write-output.ts` and returned in `writeResult.parseErrors` so `src/index.ts` still emits the final JSON report.
- **Consequence:** Partial success is preserved: if section files were written, the CLI can exit `0` even when title metadata failed, while still surfacing the failure in `parse_errors`.
- **Feature:** #1 USLM XML to Markdown Transformer

## Phase 1 Scope (Current)
- What's implemented:
  - core transform pipeline decisions above
  - deterministic fixture-backed testing strategy
- What's intentionally deferred:
  - dynamic OLRC releasepoint discovery
  - future sync/backfill/git workflow ADRs
- What's a test double vs production:
  - committed Title 1 fixtures are an intentional CI test double for live OLRC content
