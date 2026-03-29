## [spec-writer] — Revised spec after review
See `docs/specs/25-spec.md` for the canonical spec.

# Transform descriptive chapter filenames and appendix title selection

## Summary
Expand the transform contract in two coordinated ways: chapter-grouped output must rename categorized chapter files to include a slugified chapter heading suffix, and the CLI must treat appendix titles as first-class transform targets so `--title 5A` and `--all` can generate output for the five appendix XML files already present in the OLRC corpus. The result must preserve deterministic output, keep `_title.md` and `_uncategorized.md` stable, and produce a clean full-corpus tree for all 53 numeric titles plus appendix titles `5A`, `11A`, `18A`, `28A`, and `50A`.

## Context
- `src/domain/normalize.ts` already owns path-safe normalization for chapter identifiers and section filenames, and issue #20 already established the slug contract for descriptive directory/path segments.
- `src/transforms/write-output.ts` currently derives chapter filenames from `chapterOutputFilename(chapter)` and writes under numeric-title directories only.
- `src/transforms/markdown.ts` already emits chapter frontmatter with `heading`, so categorized chapter buckets have the metadata needed for descriptive filenames.
- `src/index.ts` currently parses `transform --title <integer> --output <dir> [--group-by ...]` and has no way to request appendix titles or a full-corpus run.
- `src/sources/olrc.ts` currently resolves cached OLRC ZIPs only for numeric titles `1..54`, even though appendix ZIP/XML artifacts such as `usc05A.xml`, `usc11a.xml`, `usc18a.xml`, `usc28a.xml`, and `usc50A.xml` are available in the corpus.
- `_title.md` and `_uncategorized.md` are out of scope for renaming.
- Title 53 remains the existing reserved-empty numeric-title diagnostic case and is still not a successful writable title.

## Acceptance Criteria

### 1. Descriptive chapter filename construction
- [ ] `src/domain/normalize.ts` exposes one shared pure helper that derives a categorized chapter filename from `(chapter identifier, chapter heading?)`, returning `chapter-{safe-chapter-id}-{safe-heading}.md` when the normalized heading slug is non-empty and falling back to `chapter-{safe-chapter-id}.md` when the heading is absent or normalizes empty.
  <!-- Touches: src/domain/normalize.ts, tests/unit/issue16-chapter-mode.test.ts or successor unit file -->
- [ ] The heading suffix uses the same normalization contract approved in issue #20 for descriptive path segments: trim Unicode whitespace; lowercase ASCII letters; strip quotes/apostrophes; replace each maximal run of remaining non-ASCII-alphanumeric characters with a single hyphen; collapse repeated hyphens; trim leading/trailing hyphens; omit the suffix when normalization yields empty.
  <!-- Touches: src/domain/normalize.ts, tests/unit/issue16-chapter-mode.test.ts or successor unit file -->
- [ ] Mechanically testable examples must pass exactly: `047` + `Fraud and False Statements` → `chapter-047-fraud-and-false-statements.md`; `IV` + `Program Administration` → `chapter-iv-program-administration.md`; `12` + `"Emergency" Powers` → `chapter-012-emergency-powers.md`; `A / B` + `General Provisions & Definitions` → `chapter-a-b-general-provisions-definitions.md`.
  <!-- Touches: src/domain/normalize.ts, tests/unit/issue16-chapter-mode.test.ts or successor unit file -->

### 2. Chapter-mode writer integration
- [ ] `src/transforms/write-output.ts` uses the chapter bucket heading associated with each categorized chapter bucket when generating chapter output paths, writes descriptive filenames for categorized chapter buckets in chapter mode, and leaves `_title.md` and `_uncategorized.md` unchanged.
  <!-- Touches: src/transforms/write-output.ts, src/transforms/markdown.ts if helper plumbing is needed, tests/integration/issue16-transform-cli.test.ts -->
- [ ] If two distinct categorized chapter buckets normalize to the same descriptive chapter filename, the transform rejects the collision before any chapter file write, adds an `OUTPUT_WRITE_FAILED` parse error that mentions the colliding filename, and returns non-zero through the existing chapter-mode failure path.
  <!-- Touches: src/transforms/write-output.ts, tests/integration/issue16-transform-cli.test.ts -->
- [ ] Embedded section markdown remains byte-identical to the existing section renderer output apart from chapter-file frontmatter, and any relative cross-reference links emitted inside section bodies resolve to the renamed descriptive chapter filenames in the same output tree.
  <!-- Touches: src/transforms/markdown.ts, src/transforms/write-output.ts, tests/unit/issue16-chapter-mode.test.ts, tests/integration/issue16-transform-cli.test.ts -->

### 3. Transform CLI appendix-title selection
- [ ] `src/index.ts` accepts `transform --title <title-selector>` where `<title-selector>` is either a numeric title (`1`..`54`) or one of the appendix identifiers `5A`, `11A`, `18A`, `28A`, or `50A`, matched case-insensitively and normalized to one canonical internal selector representation.
  <!-- Touches: src/index.ts, src/domain/normalize.ts or new selector helper, tests/unit/bootstrap-and-cli.test.ts or new CLI parse tests -->
- [ ] Invalid appendix-like selectors such as `0A`, `6A`, `5AA`, `appendix`, empty `--title`, or duplicate `--title` flags fail argument parsing before any output files are written and produce an error message that names the accepted appendix selectors.
  <!-- Touches: src/index.ts, tests/unit/bootstrap-and-cli.test.ts or new CLI parse tests -->
- [ ] `src/index.ts` accepts a new `--all` flag for `transform`; `--all` is mutually exclusive with `--title`; duplicate `--all` flags fail; and a successful `--all` run transforms every successful numeric title plus all five appendix titles in one invocation while preserving the existing reserved-empty failure semantics for title `53` in the aggregated report.
  <!-- Touches: src/index.ts, src/sources/olrc.ts, tests/integration/transform-cli.test.ts -->

### 4. Appendix artifact resolution and output directories
- [ ] Production code adds one shared pure title-selector normalization boundary that can derive: (a) the cache/XML selection key for numeric and appendix titles, (b) the report identifier to emit, and (c) the output directory segment. Numeric titles keep the existing `title-{NN}` base form; appendix titles must write under `title-{NNa}-appendix/` using a lowercase appendix suffix and two-digit numeric padding (`5A` → `title-05a-appendix`, `11A` → `title-11a-appendix`).
  <!-- Touches: src/domain/normalize.ts, src/index.ts, src/sources/olrc.ts, src/transforms/write-output.ts, tests/unit/domain/normalize-*.test.ts -->
- [ ] `src/sources/olrc.ts` can resolve cached OLRC ZIP/XML artifacts for the five appendix selectors using the actual appendix filenames already present in the corpus, without introducing new network requirements or a second appendix-only acquisition flow.
  <!-- Touches: src/sources/olrc.ts, tests/integration/transform-cli.test.ts -->
- [ ] Running `transform --title 5A --group-by chapter` writes output only for Title 5 Appendix under `out/uscode/title-05a-appendix/`, including `_title.md` plus descriptive `chapter-*.md` files, and returns `0` when that appendix fixture has writable sections.
  <!-- Touches: src/index.ts, src/transforms/write-output.ts, tests/integration/issue16-transform-cli.test.ts or new appendix-focused integration test -->

### 5. Corpus-wide regression coverage
- [ ] The fixture-backed transform matrix covers successful numeric titles `1..52` and `54` plus appendix titles `5A`, `11A`, `18A`, `28A`, and `50A`, and asserts that each successful output tree contains filesystem-safe paths only, while title `53` retains its existing reserved-empty diagnostic behavior.
  <!-- Touches: tests/integration/transform-cli.test.ts, tests/integration/issue16-transform-cli.test.ts, fixture helpers -->
- [ ] The same matrix asserts that categorized chapter filenames match `^chapter-[a-z0-9-]+\.md$`, include a heading slug suffix whenever heading metadata exists, and contain no spaces, quotes, em dashes, or uppercase letters across both numeric-title and appendix-title outputs.
  <!-- Touches: tests/integration/issue16-transform-cli.test.ts -->
- [ ] A full-corpus `transform --all --group-by chapter` acceptance test proves the command completes with clean output trees for all successful titles and appendices, includes appendix directory names in the result set, and reports title `53` through the existing reserved-empty diagnostic rather than silently skipping it.
  <!-- Touches: src/index.ts, tests/integration/transform-cli.test.ts -->

### Non-Functional
- [ ] Determinism: repeated runs on the same fixture corpus produce identical reports, directory names, chapter filenames, and file bytes for numeric-title and appendix-title outputs alike.
- [ ] Security: the change introduces no new dependencies, no new network calls for appendix support beyond existing OLRC access paths, and no path components derived from unsanitized chapter headings or raw appendix selectors.

## Out of Scope
- Renaming `_title.md`, `_uncategorized.md`, or section-per-file output filenames.
- Adding appendix selectors other than `5A`, `11A`, `18A`, `28A`, and `50A`.
- Changing section markdown semantics beyond link-target/path updates required by renamed chapter files or appendix directory support.
- Adding a new acquisition command for appendix titles separate from the existing OLRC source flow.
- Cross-repo migration or downstream publishing changes.

## Dependencies
- `docs/specs/16-spec.md`
- Issue #20 descriptive path-segment slug contract
- `src/index.ts`
- `src/domain/normalize.ts`
- `src/sources/olrc.ts`
- `src/transforms/write-output.ts`
- `src/transforms/markdown.ts`
- `tests/integration/transform-cli.test.ts`
- `tests/integration/issue16-transform-cli.test.ts`
- Relevant unit tests under `tests/unit/**`

## Acceptance Tests (human-readable)
1. Unit-test the descriptive chapter filename helper with the normative examples and verify the expected filenames exactly.
2. Run chapter-mode transform on the Title 1 fixture and verify `_title.md` plus descriptive `chapter-*.md` outputs, with no `section-*.md` files.
3. Verify `_title.md` and `_uncategorized.md` retain their current filenames/contracts.
4. Run a collision fixture where two `(chapter id, heading)` pairs normalize to the same descriptive chapter filename and verify the command exits non-zero before any chapter file is written.
5. Run `transform --title 5A --output ./out --group-by chapter` and verify output lands under `out/uscode/title-05a-appendix/` with `_title.md` and descriptive `chapter-*.md` files.
6. Run the same command with `--title 5a` and verify the output tree and report identifier are identical to the uppercase invocation.
7. Run invalid selector cases such as `--title 6A`, `--title 5AA`, and `--title appendix`; verify each fails before writes and names the accepted appendix selectors in the error text.
8. Run `transform --all --output ./out --group-by chapter` against the fixture corpus and verify successful output trees exist for numeric titles `1..52`, `54`, and appendix titles `5A`, `11A`, `18A`, `28A`, `50A`, while title `53` is reported through the existing reserved-empty diagnostic path.
9. Verify every categorized chapter filename in the numeric-plus-appendix corpus matrix is lowercase, hyphenated, path-safe, and includes the heading slug suffix whenever chapter heading metadata exists.
10. Run the same full-corpus transform twice and verify identical directory trees and file bytes.

## Edge Case Catalog
- **Malformed input:** missing `--title` value, duplicate `--title`, duplicate `--all`, `--title` plus `--all` together, or unsupported appendix-like selectors (`0A`, `6A`, `5AA`) must fail before writes.
- **Partial data:** mixed corpora where some chapter buckets have headings and some do not; heading-bearing buckets use descriptive filenames while missing-heading buckets fall back to `chapter-{safe-id}.md` without changing section order or `_title.md` generation.
- **Delimiter edge cases:** chapter headings containing quotes, apostrophes, slashes, ampersands, em dashes, repeated punctuation, or repeated whitespace normalize deterministically to one hyphen-delimited lowercase suffix.
- **Encoding issues:** chapter headings containing Unicode whitespace, accented letters, emoji, or RTL characters still normalize to ASCII-safe filename suffixes with repeated separators collapsed.
- **Selector normalization:** appendix selectors are case-insensitive on input but canonicalized to lowercase path segments and one stable internal representation (`5A`, `5a` → same selector/result).
- **Collision edges:** distinct raw `(chapter id, heading)` pairs can normalize to the same descriptive filename and must be rejected before writes with `OUTPUT_WRITE_FAILED`.
- **Filesystem boundaries:** known chapter headings remain well below path limits after prefixing with `chapter-` and the safe chapter id; appendix directory names remain bounded and deterministic.
- **Subsystem failure:** if one chapter or title write fails after another succeeds, the existing non-zero output-write behavior remains unchanged; appendix support does not introduce best-effort silent skips.
- **Recovery:** rerunning the transform after fixing fixture or output-directory problems regenerates the same descriptive chapter filenames and appendix directory names with no manual cleanup semantics beyond the existing clean-output expectation.

## Verification Strategy
- **Pure core:** normalize chapter heading slugs, compose descriptive chapter filenames, normalize title selectors (`numeric` vs `appendix`), and derive output directory segments from canonical selector metadata.
- **Properties:**
  - Descriptive chapter filenames always match `^chapter-[a-z0-9-]+\.md$`.
  - Numeric chapter identifiers remain zero-padded to width 3 in descriptive filenames.
  - When the normalized heading slug is non-empty, the filename ends with `-{slug}.md`; otherwise it falls back to `chapter-{safe-id}.md`.
  - Appendix selectors are case-insensitive at input time but map to exactly one canonical selector representation and exactly one output directory segment.
  - Successful `--all` output includes every supported appendix selector and every successful numeric title, and never silently omits a supported selector.
  - `_title.md` and `_uncategorized.md` filenames remain unchanged.
  - Relative cross-reference links in embedded section markdown resolve to files that exist after the rename.
- **Purity boundary:** CLI argument parsing, OLRC cache resolution, XML parsing, report emission, link rewriting, and filesystem writes remain effectful; selector normalization and filename/path composition remain unit-testable pure logic.

## Infrastructure Requirements
- **Database:** None.
- **API endpoints:** None.
- **Infrastructure:** Existing transform CLI, OLRC cache layout, and fixture-backed Vitest suites only.
- **Environment variables / secrets:** None.

## Complexity Estimate
L

Reason: this issue now spans CLI argument parsing, cache artifact resolution, output path derivation, chapter-file naming, full-corpus regression coverage, and `--all` aggregation behavior across numeric and appendix titles.

## Required Skills
- TypeScript
- CLI argument parsing
- Path normalization
- Markdown/link rendering
- Filesystem/path-safety testing
- Vitest regression design
