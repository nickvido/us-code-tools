# USLM XML to Markdown Transformer

## Summary
Build the first production-ready `transform` pipeline for `us-code-tools` so a single United States Code title can be downloaded from OLRC, cached locally, parsed from USLM XML into a deterministic intermediate representation, and emitted as per-section markdown files plus title metadata. This establishes the file format and transformer behavior that later sync, diff, and commit workflows will depend on.

## Context
- The repository currently contains the product-level `SPEC.md` and `README.md`, but no implementation code yet.
- `SPEC.md` defines the canonical output shape for section markdown files (`uscode/title-{NN}/section-{NNN}.md`) and title metadata files (`_title.md`).
- The OLRC publishes title ZIP archives containing USLM XML; this transformer is the first ingestion path into the repo’s markdown representation.
- The transformer must run on Node.js 22+ with npm, TypeScript strict mode, Vitest, `fast-xml-parser`, and `gray-matter`.
- This issue is limited to title download, parse, transform, and file emission. Later sync jobs, bill/PR workflows, and historical ingestion are explicitly out of scope.

## Acceptance Criteria

### 1. Project bootstrap and CLI surface
- [ ] `package.json` exists at the repository root and defines a package named `us-code-tools`, an npm `build` script, and a CLI entry that supports `npx us-code-tools transform --title <number> --output <dir>`.
  <!-- Touches: package.json -->
- [ ] `tsconfig.json` exists at the repository root with `"strict": true`, and `npm run build` exits with status 0 on Node.js 22+.
  <!-- Touches: tsconfig.json, src/**/*.ts -->
- [ ] The initial implementation introduces a CLI module that rejects a missing `--title` argument or missing `--output` argument with a non-zero exit code and a usage message containing the literal string `transform --title <number> --output <dir>`.
  <!-- Touches: src/index.ts, tests/cli/*.test.ts -->
- [ ] The CLI rejects a `--title` value that is not a positive integer from 1 through 54 with a non-zero exit code and does not create the output directory.
  <!-- Touches: src/index.ts, tests/cli/*.test.ts -->

### 2. OLRC download and cache
- [ ] A new OLRC source module downloads exactly one ZIP archive for the requested title using the OLRC releasepoint URL pattern configured by the implementation, stores the ZIP under a local cache directory, and returns the cached path to downstream code.
  <!-- Touches: src/sources/olrc.ts, src/utils/cache.ts, tests/sources/olrc.test.ts -->
- [ ] When a cached ZIP already exists for the requested title and cache key, the transformer reuses the cached file without making a second HTTP request during the same run.
  <!-- Touches: src/sources/olrc.ts, tests/sources/olrc.test.ts -->
- [ ] Cache writes are atomic for a given title/cache key: concurrent transforms for the same title must not consume a partially written ZIP, and a zero-byte or invalid cached artifact must be discarded and re-downloaded before parsing begins.
  <!-- Touches: src/sources/olrc.ts, src/utils/cache.ts, tests/sources/olrc.test.ts, tests/integration/transform-cli.test.ts -->
- [ ] If the download request returns a non-2xx response, times out, or yields a non-ZIP payload, the CLI exits non-zero, writes no section markdown files, and prints an error message that includes the title number and the failing download URL.
  <!-- Touches: src/sources/olrc.ts, src/index.ts, tests/sources/olrc.test.ts, tests/integration/transform-cli.test.ts -->
- [ ] The transformer extracts XML files from the downloaded ZIP and fails with a non-zero exit code if no `.xml` file is present in the archive.
  <!-- Touches: src/sources/olrc.ts, tests/sources/olrc.test.ts -->
- [ ] If the ZIP contains more than one `.xml` file, the transformer processes all `.xml` files in lexical pathname order (including nested paths), merges the parsed sections into a single title result, and fails non-zero only if the merged set yields zero writable sections.
  <!-- Touches: src/sources/olrc.ts, src/transforms/uslm-to-ir.ts, tests/sources/olrc.test.ts, tests/integration/transform-cli.test.ts -->

### 3. USLM parse to intermediate representation
- [ ] A new transform parser module converts the extracted USLM XML into an intermediate representation containing title metadata, zero or more chapter records, and one record per `<section>` element.
  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/transforms/uslm-to-ir.test.ts -->
- [ ] For each parsed section, the intermediate representation stores the section number as a string, section heading text, status when present, source credits when present, editorial notes when present, and the ordered content tree for subsection/paragraph descendants.
  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/transforms/uslm-to-ir.test.ts -->
- [ ] The parser preserves hierarchy for the following USLM elements when present: `<subsection>`, `<paragraph>`, `<subparagraph>`, `<clause>`, and `<item>`, and records their labels exactly as strings so that values such as `(a)`, `(1)`, `(A)`, `(i)`, and `(I)` remain distinguishable in output.
  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/transforms/uslm-to-ir.test.ts -->
- [ ] The parser normalizes a single child and repeated children to the same array-based representation so fixture XML containing one subsection and fixture XML containing multiple subsections produce the same IR shape.
  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/transforms/uslm-to-ir.test.ts -->
- [ ] The parser tolerates section identifiers that contain letters, hyphens, or mixed alphanumeric values (for example `36B`) without numeric coercion.
  <!-- Touches: src/transforms/uslm-to-ir.ts, tests/transforms/uslm-to-ir.test.ts -->
- [ ] If a section is missing a section number, the parser records a parse error for that section and excludes that section from emitted markdown files while continuing to process other valid sections in the same title.
  <!-- Touches: src/transforms/uslm-to-ir.ts, src/index.ts, tests/transforms/uslm-to-ir.test.ts, tests/integration/transform-cli.test.ts -->

### 4. Markdown generation
- [ ] A new markdown generator module converts one parsed section into a markdown document whose frontmatter is parseable by `gray-matter` and includes at minimum `title`, `section`, `heading`, `status`, and `source` keys.
  <!-- Touches: src/transforms/markdown.ts, tests/transforms/markdown.test.ts -->
- [ ] When present in the parsed metadata, the generator also emits `enacted`, `public_law`, `last_amended`, and `last_amended_by` frontmatter keys using the names defined in `SPEC.md`.
  <!-- Touches: src/transforms/markdown.ts, tests/transforms/markdown.test.ts -->
- [ ] The markdown body begins with an H1 in the form `# § {section}. {heading}` for normal sections and preserves the legal hierarchy using the following layout rules:
  - subsection → `## ({label}) {heading?}`
  - paragraph → line begins with `({label}) ` indented 0 spaces
  - subparagraph → line begins with `({label}) ` indented 2 spaces
  - clause → line begins with `({label}) ` indented 4 spaces
  - item → line begins with `({label}) ` indented 6 spaces
  <!-- Touches: src/transforms/markdown.ts, tests/transforms/markdown.test.ts -->
- [ ] Cross-references and inline editorial note text present in the parsed content are rendered as readable markdown text and are not dropped silently.
  <!-- Touches: src/transforms/markdown.ts, tests/transforms/markdown.test.ts -->
- [ ] The generator emits a title metadata file at `uscode/title-{NN}/_title.md` whose frontmatter is parseable by `gray-matter` and includes `title`, `heading`, `positive_law`, and `sections`; `chapters` is included when chapter data is present.
  <!-- Touches: src/transforms/markdown.ts, tests/transforms/markdown.test.ts -->

### 5. File output and reporting
- [ ] Running `npx us-code-tools transform --title 1 --output ./out` writes one markdown file per successfully parsed section under `./out/uscode/title-01/` using the path pattern `section-{section}.md` and writes `./out/uscode/title-01/_title.md`.
  <!-- Touches: src/index.ts, src/transforms/write-output.ts, tests/integration/transform-cli.test.ts -->
- [ ] File names preserve the exact section identifier string except for filesystem-safe normalization limited to replacing `/` with `-`; no other alphanumeric characters are removed or lowercased.
  <!-- Touches: src/transforms/write-output.ts, tests/transforms/write-output.test.ts -->
- [ ] The CLI prints a final report containing numeric counts for `sections_found`, `files_written`, and `parse_errors`, and the counts match the files and errors produced during the run.
  <!-- Touches: src/index.ts, tests/integration/transform-cli.test.ts -->
- [ ] ⚡ If one or more sections fail to parse but at least one section is written successfully, the CLI exits with status 0 and reports the failed sections in `parse_errors`; if zero section files are written, the CLI exits non-zero.
  <!-- Cross-module: src/transforms/uslm-to-ir.ts -> src/transforms/write-output.ts -> src/index.ts; Touches: tests/integration/transform-cli.test.ts -->

### 6. Test coverage and fixtures
- [ ] The repository includes Vitest unit tests for OLRC download/cache behavior, XML-to-IR parsing, markdown generation, and output writing using fixture XML snippets committed under `tests/fixtures/`.
  <!-- Touches: tests/**/*.test.ts, tests/fixtures/**/* -->
- [ ] The repository includes snapshot tests for at least three representative section shapes: a flat section, a section with nested subsection/paragraph structure, and a section containing notes or cross-reference text.
  <!-- Touches: tests/transforms/*.test.ts, tests/fixtures/**/* -->
- [ ] The repository includes a committed fixture manifest for the Title 1 integration case that defines the expected emitted filename set and at least three representative file assertions (`_title.md`, one flat section, and one nested section); the CLI integration test asserts against that committed manifest rather than deriving expectations from live network responses.
  <!-- Touches: tests/integration/transform-cli.test.ts, tests/fixtures/title-01/**/* -->
- [ ] The default `npm test` suite runs without outbound network access by using committed Title 1 fixture/cache artifacts or HTTP mocking; any optional live-download verification for OLRC is excluded from the default `npm test` path.
  <!-- Touches: package.json, vitest.config.ts, tests/integration/transform-cli.test.ts, tests/fixtures/title-01/**/* -->
- [ ] `npm test` exits with status 0 and all default tests pass in CI on Node.js 22+.
  <!-- Touches: package.json, vitest.config.ts, tests/**/*.test.ts -->

## Out of Scope
- Diffing two OLRC snapshots or generating git diffs
- Creating commits, branches, PRs, or comments in the downstream `us-code` repository
- Downloading or transforming more than one title in a single CLI invocation
- Congress.gov, GovInfo, VoteView, or @unitedstates integrations
- Historical backfill workflows beyond the single-title transform path
- Persisting parse results in a database or external service

## Dependencies
- OLRC title ZIP archives published at `uscode.house.gov`
- `fast-xml-parser` for XML parsing
- `gray-matter` for validating and generating YAML frontmatter
- A ZIP extraction library chosen by the implementation
- Vitest for unit, integration, and snapshot tests

## Acceptance Tests (human-readable)
1. Run `npm install`.
2. Run `npm run build`; verify the command exits 0.
3. Run `npx us-code-tools transform --title 1 --output ./out`.
4. Verify `./out/uscode/title-01/_title.md` exists and its frontmatter parses with `gray-matter`.
5. Verify every emitted `section-*.md` file under `./out/uscode/title-01/` parses with `gray-matter` and contains an H1 beginning with `# §`.
6. Verify the command output includes `sections_found`, `files_written`, and `parse_errors` counts.
7. Run `npm test`; verify unit, snapshot, and integration tests pass.
8. Simulate a cached second run for the same title and verify the download layer does not make a second network request.
9. Simulate a ZIP without XML and verify the CLI exits non-zero and writes no markdown files.

## Edge Case Catalog
- Invalid CLI inputs: missing flags, title `0`, title `55`, negative title, non-numeric title, repeated flags, output path that already exists as a file.
- Download failures: DNS failure, timeout, HTTP 404/500, interrupted response stream, payload returned as HTML instead of ZIP.
- Cache edge cases: partially written ZIP from a prior failed run, stale cache file with zero bytes, concurrent runs requesting the same title.
- ZIP extraction edge cases: archive contains multiple XML files, nested directories, no XML files, corrupted ZIP central directory.
- XML structure edge cases: one child vs. many children, empty heading, missing section identifier, missing title heading, missing chapter data, editorial note elements without body text.
- Encoding issues: UTF-8 BOM, XML entities, smart quotes, em dashes, section headings with accented characters, mixed whitespace, line breaks inside inline text.
- Section identifier edge cases: `36B`, `78u-6`, identifiers containing slash characters that require `/` → `-` normalization for file output.
- Content hierarchy edge cases: subsection without heading text, paragraph text plus nested children, deeply nested clause/item structures, inline cross-references embedded between plain text nodes.
- Partial failure behavior: one malformed section in an otherwise valid title, malformed note block, missing metadata for a valid section.
- Recovery behavior: cached ZIP becomes valid after redownload on next run, rerunning after a partial-write failure recreates missing files deterministically.

## Verification Strategy
- **Pure core:** XML-to-IR parsing, IR-to-markdown rendering, frontmatter assembly, path derivation, and final report counting should be implemented as pure functions.
- **Properties:**
  - For every valid parsed section, emitted frontmatter parses through `gray-matter` without throwing.
  - For every valid parsed section, output path is deterministic for the same title and section identifier.
  - For every nested content node, indentation depth in markdown is derived solely from node type.
  - Section identifiers are preserved as strings end-to-end and are never numerically reformatted.
  - Re-running the transformer with identical input and output directory yields byte-identical markdown files.
- **Purity boundary:** HTTP download, filesystem cache reads/writes, ZIP extraction, and CLI stdout/stderr are the effectful shell; all parsing and rendering logic should be isolated from I/O so they can be unit-tested with fixtures.

## Infrastructure Requirements
- **Database:** None.
- **API endpoints:** None.
- **Infrastructure:** Local filesystem cache directory for downloaded ZIP archives and temporary extraction workspace.
- **Environment variables / secrets:** None required for OLRC access.

## Complexity Estimate
L

Reason: the work spans new CLI, download/cache, ZIP extraction, XML parsing, markdown rendering, deterministic file output, and a mixed unit/integration/snapshot test suite. The acceptance criteria are grouped to support later decomposition into bootstrap/CLI, source ingestion, parsing/rendering, and integration-hardening tasks.

## Required Skills
- TypeScript
- Node.js 22+
- CLI design
- XML parsing
- Markdown/YAML generation
- Vitest
