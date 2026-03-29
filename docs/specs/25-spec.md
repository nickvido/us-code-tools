## [spec-writer] — Initial spec drafted
See `docs/specs/25-spec.md` for the canonical spec.

# Transform descriptive chapter filenames

## Summary
Update chapter-grouped transform output so each generated chapter markdown file includes both the canonical chapter identifier and a slugified form of that chapter’s heading in the filename. The change keeps chapter-mode outputs readable for humans, preserves stable deterministic naming for historical backfills, and must not alter `_title.md`, `_uncategorized.md`, or the section markdown content embedded inside each chapter file.

## Context
- `src/transforms/write-output.ts` currently writes chapter-mode files via `chapterOutputFilename(chapter)`, which emits names like `chapter-047.md` or `chapter-iv.md`.
- `src/transforms/markdown.ts` already writes a `heading` field into chapter frontmatter, and the issue context guarantees 100% heading coverage for generated chapter files.
- Existing normalization logic for chapter identifiers lives in `src/domain/normalize.ts` and already handles numeric chapter ids, non-numeric ids, and collision detection for many-to-one normalized chapter identifiers.
- Existing chapter-mode regression coverage lives in `tests/unit/issue16-chapter-mode.test.ts` and `tests/integration/issue16-transform-cli.test.ts`.
- This feature must reuse the same slug rules already approved for descriptive title directories in issue #20: lowercase ASCII, hyphen-separated words, quotes/special punctuation removed via normalization, deterministic output, and no third-party slugification dependency.
- `_title.md` and `_uncategorized.md` are explicitly out of scope for renaming and must retain their current filenames and content contracts.

## Acceptance Criteria

### 1. Chapter filename construction
- [ ] `src/domain/normalize.ts` exposes one shared pure helper that derives the descriptive chapter filename stem from both the chapter identifier and chapter heading, producing `chapter-{safe-chapter-id}-{safe-heading}.md` when the heading slug is non-empty and preserving the existing chapter-id normalization rules from issue #16 (`047` → `047`, `IV` → `iv`, `A-1 / Special` → `a-1-special`, empty normalized chapter id → `unnamed`).
  <!-- Touches: src/domain/normalize.ts, tests/unit/issue16-chapter-mode.test.ts or successor unit file -->
- [ ] The heading portion of that filename uses the same slug normalization contract as issue #20 title-directory naming: trim Unicode whitespace; lowercase ASCII letters; replace each maximal run of one or more non-ASCII alphanumeric characters with a single hyphen; collapse repeated hyphens; trim leading/trailing hyphens; and if the normalized heading would be empty, omit the `-{safe-heading}` suffix entirely instead of producing a trailing hyphen.
  <!-- Touches: src/domain/normalize.ts, tests/unit/issue16-chapter-mode.test.ts or successor unit file -->
- [ ] Mechanically testable examples must pass exactly: chapter `047` + heading `Fraud and False Statements` → `chapter-047-fraud-and-false-statements.md`; chapter `IV` + heading `Program Administration` → `chapter-iv-program-administration.md`; chapter `12` + heading `"Emergency" Powers` → `chapter-012-emergency-powers.md`; and chapter `A / B` + heading `General Provisions & Definitions` → `chapter-a-b-general-provisions-definitions.md`.
  <!-- Touches: src/domain/normalize.ts, tests/unit/issue16-chapter-mode.test.ts or successor unit file -->

### 2. Chapter-mode writer integration
- [ ] `src/transforms/write-output.ts` uses the chapter heading associated with each chapter bucket when generating output paths, so a chapter-mode transform writes descriptive chapter filenames for every categorized chapter bucket while leaving `_title.md` and `_uncategorized.md` unchanged.
  <!-- Touches: src/transforms/write-output.ts, src/transforms/markdown.ts if helper plumbing is needed, tests/integration/issue16-transform-cli.test.ts -->
- [ ] If two distinct chapter buckets would normalize to the same descriptive filename after combining normalized chapter id and normalized heading, the transform must reject the collision before writing any chapter file, emit an `OUTPUT_WRITE_FAILED` parse error mentioning the colliding filename, and return non-zero exactly as the existing chapter collision path does today.
  <!-- Touches: src/transforms/write-output.ts, tests/integration/issue16-transform-cli.test.ts -->
- [ ] If a chapter heading is unavailable at filename-generation time despite the current dataset guarantee, the transform must fall back to the existing non-descriptive filename for that bucket (`chapter-{safe-chapter-id}.md`) rather than failing or synthesizing a different heading string; the markdown frontmatter fallback behavior for `heading` remains governed by `renderChapterMarkdown()`.
  <!-- Touches: src/transforms/write-output.ts, src/transforms/markdown.ts, tests/unit/issue16-chapter-mode.test.ts or successor unit file -->

### 3. Link and corpus-level regression coverage
- [ ] Chapter-mode integration coverage proves that embedded section markdown remains byte-identical to `renderSectionMarkdown()` output apart from chapter-file frontmatter, and any relative cross-reference links rendered inside section bodies continue to resolve to the descriptive chapter filenames produced for the target chapter buckets.
  <!-- Touches: src/transforms/markdown.ts, src/transforms/write-output.ts, tests/unit/issue16-chapter-mode.test.ts, tests/integration/issue16-transform-cli.test.ts -->
- [ ] The fixture-backed chapter-mode transform matrix covers all currently supported numeric titles `1..52` and `54` (with reserved-empty `53` retaining its existing diagnostic behavior) and asserts that every generated categorized chapter file path matches `^chapter-[a-z0-9-]+\.md$`, contains a slugified heading suffix when that chapter has heading metadata, and produces no filenames containing spaces, quotes, em dashes, or uppercase letters.
  <!-- Touches: tests/integration/issue16-transform-cli.test.ts, existing title-matrix fixture helpers -->

### Non-Functional
- [ ] Determinism: running the same chapter-mode transform twice against the same fixture input produces byte-identical file contents and identical descriptive chapter filenames.
- [ ] Security: the change adds no network access, no new dependencies, and no path components derived from unsanitized chapter headings.

## Out of Scope
- Renaming `_title.md`, `_uncategorized.md`, or section-per-file output paths.
- Changing chapter frontmatter keys or chapter body rendering semantics beyond any link target updates required by the renamed files.
- Altering title-directory naming, title metadata generation, or OLRC acquisition/backfill behavior.
- Retrospective mass file migration tooling outside the existing transform command.

## Dependencies
- Issue #16 chapter-mode output contracts in `docs/specs/16-spec.md`
- Issue #20 descriptive title-directory slug rules (existing approved normalization contract)
- `src/domain/normalize.ts`
- `src/transforms/write-output.ts`
- `src/transforms/markdown.ts`
- `tests/unit/issue16-chapter-mode.test.ts`
- `tests/integration/issue16-transform-cli.test.ts`

## Acceptance Tests (human-readable)
1. Run a unit test for the shared filename helper and verify `047` + `Fraud and False Statements` yields `chapter-047-fraud-and-false-statements.md`.
2. Run the same helper with `IV` + `Program Administration` and verify it yields `chapter-iv-program-administration.md`.
3. Run the helper with a heading containing quotes and punctuation, such as `"Emergency" Powers`, and verify the filename is `chapter-012-emergency-powers.md`.
4. Run chapter-mode transform on the committed Title 1 current-format fixture and verify the output tree contains `_title.md` plus descriptive `chapter-*.md` files and no `section-*.md` files.
5. Verify `_title.md` and `_uncategorized.md` keep their current filenames and frontmatter contracts.
6. Open a generated descriptive chapter file and verify its body still contains the same section headings and prose previously emitted for that chapter.
7. Run the existing collision harness with two distinct chapters whose normalized id+heading pairs map to the same filename and verify the command exits non-zero before any chapter file is written.
8. Run the multi-title fixture matrix for titles `1..52` and `54` and verify every categorized chapter file path is lowercase, hyphenated, and free of spaces/quotes/uppercase characters.
9. Run the same transform twice on the same fixture input and verify the output directory trees are byte-identical.

## Edge Case Catalog
- **Malformed input:** truncated XML, missing chapter nodes, missing `<heading>`, empty heading text, or chapters whose display heading is punctuation-only; the transform must either use the existing fallback filename contract or fail through the existing parse/write error path, never emit malformed filenames.
- **Partial data:** mixed titles where some chapters have headings and others do not; heading-bearing chapters use descriptive filenames while missing-heading chapters fall back to `chapter-{safe-id}.md` without changing section ordering or `_title.md` generation.
- **Delimiter edge cases:** headings containing quotes, apostrophes, slashes, ampersands, em dashes, repeated punctuation, or repeated whitespace must normalize deterministically to one hyphen-delimited lowercase slug.
- **Encoding issues:** headings containing Unicode whitespace, accented letters, emoji, or RTL characters must pass through the same slug normalization contract and produce path-safe ASCII output with repeated separators collapsed.
- **Collision edges:** distinct raw `(chapter id, heading)` pairs can still normalize to the same filename stem (for example punctuation-only differences); those collisions must be detected before writes and surfaced as `OUTPUT_WRITE_FAILED`.
- **Filesystem boundaries:** longest known headings (~80 chars) must remain well below filesystem path limits after prefixing with `chapter-` and the normalized chapter id.
- **Degraded behavior:** if one descriptive chapter file write fails after another succeeds, the existing partial-write non-zero exit contract from issue #16 remains unchanged.
- **Recovery:** rerunning the transform after fixing fixture/output-directory problems automatically regenerates the same descriptive filenames with no extra cleanup semantics.

## Verification Strategy
- **Pure core:** filename normalization should be pure, with one helper for safe chapter ids, one helper for safe heading slugs, and one composition helper for the final descriptive chapter filename.
- **Properties:**
  - For all valid inputs, descriptive chapter filenames match `^chapter-[a-z0-9-]+\.md$`.
  - Numeric chapter identifiers remain zero-padded to width 3 in descriptive filenames.
  - When normalized heading slug is non-empty, the filename ends with `-{slug}.md`; when it is empty or heading metadata is absent, the filename falls back to the existing `chapter-{safe-id}.md` form.
  - `_title.md` and `_uncategorized.md` filenames remain unchanged.
  - Relative cross-reference links in embedded section markdown resolve to filenames that exist in the same output tree after the rename.
- **Purity boundary:** XML parsing, chapter bucket assembly, link rewriting, and filesystem writes remain effectful; slug normalization and filename composition remain unit-testable pure logic.

## Infrastructure Requirements
- **Database:** None.
- **API endpoints:** None.
- **Infrastructure:** Existing transform CLI, fixture-backed OLRC cache harness, and Vitest suites only.
- **Environment variables / secrets:** None.

## Complexity Estimate
M

Reason: the change is localized to chapter filename generation, collision handling, and regression coverage, but it crosses normalization, writer integration, and link-resolution behavior.

## Required Skills
- TypeScript
- Markdown rendering
- Filesystem/path-safety testing
- Vitest
- Regression test design
