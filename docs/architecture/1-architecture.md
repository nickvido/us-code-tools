# Architecture — Issue #1: USLM XML to Markdown Transformer

## Status
Approved spec input: `docs/specs/1-spec.md`

## Inputs Reviewed
- `docs/specs/1-spec.md`
- `SPEC.md`
- `README.md`
- GitHub issue #1 and issue comments

## Review Feedback Addressed
- `## [security-architect]` revision reviewed from `docs/architecture/1-uslm-transformer-security.md`.
- The architecture below now explicitly addresses:
  - ZIP path traversal and special-entry rejection during XML materialization
  - deterministic handling of ZIP archives containing multiple XML files
  - CI-safe integration testing without mandatory live network access
  - atomic cache writes and invalid cache recovery for concurrent title requests
  - concrete XML parser hardening and output-root symlink refusal rules

## 1. Data Model

This issue is a local CLI transformer. **No relational database is introduced** for this phase. Persisting parsed law data to Postgres would be premature and would violate the approved issue scope, which is file-based transformation only.

The production data model for this ticket is therefore:
1. on-disk cache artifacts
2. extracted XML workspace files
3. an in-memory intermediate representation (IR)
4. emitted markdown files under the output directory

### 1.1 Filesystem Persistence Model

#### Cache layout
```text
.cache/
└── olrc/
    └── title-01/
        ├── manifest.json
        ├── xml_usc01@118-200.zip
        └── xml_usc01@118-200.zip.sha256
```

#### Extraction workspace layout
```text
tmp/
└── us-code-tools/
    └── extract-
        └── <run-id>/
            ├── usc01.xml
            └── nested/path/other.xml
```

#### Output layout
```text
<output>/
└── uscode/
    └── title-01/
        ├── _title.md
        ├── section-1.md
        ├── section-2.md
        └── section-36B.md
```

### 1.2 Cache Manifest Schema

`manifest.json`
```json
{
  "title": 1,
  "source_url": "https://uscode.house.gov/download/releasepoints/us/pl/118/200/xml_usc01@118-200.zip",
  "cache_key": "title-01__xml_usc01@118-200",
  "zip_filename": "xml_usc01@118-200.zip",
  "sha256": "<hex>",
  "bytes": 123456,
  "downloaded_at": "2026-03-28T13:00:00.000Z",
  "content_type": "application/zip"
}
```

Constraints:
- `title` is integer `1..54`
- `sha256` must be present for every valid cached ZIP
- `bytes > 0`
- `source_url` must exactly match the URL used for download
- a cached artifact is valid only when ZIP file, manifest, and SHA file all agree

### 1.3 Intermediate Representation Types

```ts
export interface ParseReport {
  sectionsFound: number;
  filesWritten: number;
  parseErrors: ParseError[];
}

export interface ParseError {
  code:
    | 'MISSING_SECTION_NUMBER'
    | 'INVALID_XML'
    | 'UNSUPPORTED_STRUCTURE'
    | 'EMPTY_SECTION'
    | 'OUTPUT_WRITE_FAILED';
  message: string;
  xmlPath?: string;
  sectionHint?: string;
}

export interface TitleIR {
  titleNumber: number;
  heading: string;
  positiveLaw: boolean | null;
  chapters: ChapterIR[];
  sections: SectionIR[];
  sourceUrlTemplate: string;
}

export interface ChapterIR {
  number: string;
  heading: string;
}

export interface SectionIR {
  titleNumber: number;
  sectionNumber: string;
  heading: string;
  status: 'in-force' | 'repealed' | 'transferred' | 'omitted';
  source: string;
  enacted?: string;
  publicLaw?: string;
  lastAmended?: string;
  lastAmendedBy?: string;
  sourceCredits?: string[];
  editorialNotes?: NoteIR[];
  content: ContentNode[];
}

export interface NoteIR {
  kind: 'editorial' | 'cross-reference' | 'source-credit' | 'misc';
  text: string;
}

export type ContentNode =
  | SubsectionNode
  | ParagraphNode
  | SubparagraphNode
  | ClauseNode
  | ItemNode
  | TextBlockNode;

interface BaseLabeledNode {
  type: 'subsection' | 'paragraph' | 'subparagraph' | 'clause' | 'item';
  label: string;
  heading?: string;
  text?: string;
  children: ContentNode[];
}

export interface SubsectionNode extends BaseLabeledNode { type: 'subsection'; }
export interface ParagraphNode extends BaseLabeledNode { type: 'paragraph'; }
export interface SubparagraphNode extends BaseLabeledNode { type: 'subparagraph'; }
export interface ClauseNode extends BaseLabeledNode { type: 'clause'; }
export interface ItemNode extends BaseLabeledNode { type: 'item'; }

export interface TextBlockNode {
  type: 'text';
  text: string;
}
```

### 1.4 Output Document Contract

#### Section document frontmatter
```yaml
---
title: 1
section: "1"
heading: "Words denoting number, gender, and so forth"
enacted: "1947-07-30"
public_law: "PL 80-772"
last_amended: "1998-11-13"
last_amended_by: "PL 105-277"
status: "in-force"
source: "https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title1-section1"
---
```

Rules:
- `section` remains a string throughout parsing, rendering, and path derivation
- file path normalization is limited to `/` → `-`
- headings may be empty in XML; emitted markdown still includes a valid H1 with available data

#### Title metadata document frontmatter
```yaml
---
title: 1
heading: "General Provisions"
positive_law: true
chapters: 5
sections: 30
---
```

### 1.5 Migrations / Seeds
No SQL migrations or seed data apply to this phase because the approved scope explicitly requires filesystem-based transformation only.

## 2. API Contract

This phase ships a **CLI contract, not an HTTP API**. No REST service, OpenAPI surface, auth token flow, or browser-facing API should be introduced.

To satisfy the requirement for a complete contract, the canonical public interface is the CLI command and its machine-readable stdout report.

### 2.1 CLI Surface

```bash
npx us-code-tools transform --title <number> --output <dir>
```

Flags:
- `--title <number>`: required; integer `1..54`
- `--output <dir>`: required; base output directory

Exit codes:
- `0`: at least one section markdown file written successfully
- `1`: invalid CLI usage or runtime failure before any writable section output

### 2.2 CLI Request/Response Contract

#### Valid invocation
```bash
npx us-code-tools transform --title 1 --output ./out
```

#### Success stdout
```json
{
  "title": 1,
  "source_url": "https://uscode.house.gov/download/releasepoints/us/pl/118/200/xml_usc01@118-200.zip",
  "sections_found": 30,
  "files_written": 31,
  "parse_errors": []
}
```

Notes:
- `files_written` counts section files plus `_title.md`
- `parse_errors` is an array; it may be non-empty on exit code `0`

#### Partial-success stdout
```json
{
  "title": 1,
  "source_url": "https://uscode.house.gov/download/releasepoints/us/pl/118/200/xml_usc01@118-200.zip",
  "sections_found": 30,
  "files_written": 28,
  "parse_errors": [
    {
      "code": "MISSING_SECTION_NUMBER",
      "message": "Section omitted because identifier is missing",
      "xmlPath": "usc01.xml",
      "sectionHint": "Definitions"
    }
  ]
}
```

#### Validation failure stderr
```text
Usage: transform --title <number> --output <dir>
Error: --title must be an integer between 1 and 54
```

#### Download failure stderr
```text
Error: failed to download title 1 from https://uscode.house.gov/download/releasepoints/us/pl/118/200/xml_usc01@118-200.zip (HTTP 404)
```

### 2.3 Rate Limiting Policy
No application-level rate limiting is added in this phase because:
- the CLI performs one title download per invocation
- there is no multi-tenant HTTP surface
- OLRC access is anonymous and low-volume for this use case

Implementation requirement:
- do not retry aggressively; use at most one bounded retry for transient network errors
- never spin in an unbounded retry loop

### 2.4 Pagination Strategy
Not applicable. The CLI processes a single title per invocation.

## 3. Service Boundaries

The transformer remains a single-process Node.js CLI with strict module boundaries.

### 3.1 Module Layout
```text
src/
├── index.ts                     # CLI entry point, argument validation, exit codes
├── cli/
│   └── transform-command.ts     # command orchestration
├── sources/
│   └── olrc.ts                  # URL resolution, download, ZIP extraction
├── transforms/
│   ├── uslm-to-ir.ts            # XML parsing → TitleIR
│   ├── markdown.ts              # TitleIR/SectionIR → markdown strings
│   └── write-output.ts          # deterministic path derivation and writes
├── domain/
│   ├── model.ts                 # IR type definitions
│   └── normalize.ts             # whitespace/text normalization helpers
└── utils/
    ├── cache.ts                 # cache validation, atomic writes, hash checks
    ├── zip.ts                   # ZIP listing/extraction abstraction
    ├── fs.ts                    # atomic write helpers
    └── logger.ts                # structured stderr logging helpers
```

### 3.2 Dependency Direction
Allowed dependency direction only:
- `index.ts` → `cli/*`
- `cli/*` → `sources/*`, `transforms/*`, `utils/*`, `domain/*`
- `sources/*` → `utils/*`, `domain/*`
- `transforms/*` → `domain/*`, `utils/*`
- `domain/*` → no downstream dependencies
- `utils/*` → platform libraries only

Forbidden:
- parser modules importing CLI code
- renderer importing downloader code
- write-output importing network code
- circular dependencies between parser and renderer

### 3.3 Responsibility Split

#### `sources/olrc.ts`
Owns:
- title number → OLRC URL resolution
- HTTP fetch with timeout and content validation
- cache lookup and cache invalidation
- ZIP listing and deterministic XML ordering

Does not own:
- XML parsing semantics
- markdown rendering
- final output paths

#### `transforms/uslm-to-ir.ts`
Owns:
- XML to IR conversion
- one-vs-many child normalization
- section-level parse error collection
- preservation of string identifiers and legal hierarchy

Does not own:
- network or file I/O

#### `transforms/markdown.ts`
Owns:
- frontmatter assembly
- markdown hierarchy formatting
- title metadata rendering
- note rendering

Does not own:
- filesystem writes

#### `transforms/write-output.ts`
Owns:
- path normalization
- directory creation
- atomic file writes to final output tree

### 3.4 Communication Pattern
No queues, no event bus, no separate service. The flow is synchronous and direct:
1. CLI validates input
2. OLRC source resolves or downloads ZIP
3. ZIP extractor returns XML payloads in lexical path order
4. parser converts merged XML payloads into `TitleIR`
5. markdown renderer produces strings
6. writer emits files atomically
7. CLI prints JSON report and exits

## 4. Infrastructure Requirements

### 4.1 Production / Runtime Requirements

For this ticket, “production” means a machine capable of running the CLI deterministically.

#### Runtime
- Node.js `22.x LTS` minimum
- npm `10+`
- macOS or Linux supported; Windows is best-effort but not a release blocker for this issue

#### Network
- outbound HTTPS access to `uscode.house.gov:443`
- TLS 1.2+

#### Storage
- writable local cache directory
- writable temporary extraction directory
- writable output directory specified by `--output`

#### Observability
- structured stderr error messages for failures
- final JSON report on stdout
- no external telemetry vendor required for this phase

#### Logging fields
Every fatal or user-visible warning should include:
- `title`
- `source_url` where relevant
- `cache_key` where relevant
- `xml_path` where relevant
- `error_code`

### 4.2 Cache and Filesystem Guarantees

#### Atomic cache write algorithm
1. download to `<zip>.tmp-<pid>-<timestamp>`
2. verify non-zero size
3. verify ZIP central directory can be opened
4. compute SHA-256
5. write manifest temp file
6. `rename()` ZIP temp file to final ZIP name
7. `rename()` manifest temp file to final manifest name
8. write `.sha256` file last

Invalid cache detection:
- zero-byte ZIP
- unreadable ZIP
- manifest missing or SHA mismatch
- content-type clearly not ZIP and file content not ZIP magic bytes

On invalid cache:
- delete invalid artifact set
- redownload once

#### Output write algorithm
- render markdown in memory first
- ensure title directory exists
- write each output document to `*.tmp`
- rename into place
- if `_title.md` write fails after some sections succeeded, report failure but preserve already-written valid sections

### 4.3 Dev / Testing Requirements

#### Local development
No Docker Compose is required for this issue because there is no database or supporting service.

Required tools:
- Node.js 22+
- npm

#### Test strategy
- unit tests for parser, renderer, cache, and writer
- integration tests use committed fixtures and/or HTTP mocking
- default `npm test` must run with **no outbound network access**
- optional live verification, if later added, must be a separate opt-in test command

#### CI requirements
- Node.js 22 runner
- network disabled or unused for default tests
- filesystem permissions for temp directories
- snapshot support enabled in Vitest

## 5. Dependency Decisions

Pinned dependency families below are intentional and minimal.

| Dependency | Target Version | Why | License | Maintenance / Notes |
|---|---:|---|---|---|
| `typescript` | `^5.8.0` | Strict typing, mature Node 22 support, predictable build pipeline | Apache-2.0 | Actively maintained; standard choice |
| `vitest` | `^3.0.0` | Fast TS-native tests and snapshots without Jest overhead | MIT | Actively maintained by Vite ecosystem |
| `fast-xml-parser` | `^4.5.0` | Required by spec; fast, no native bindings, handles attribute/text parsing well | MIT | Actively maintained; widely used |
| `gray-matter` | `^4.0.3` | Required by spec; stable frontmatter generation/validation path | MIT | Mature and stable |
| `yauzl` or `unzipper` | `yauzl@^3.1.0` preferred | ZIP validation and deterministic entry enumeration without shelling out to `unzip` | MIT | Mature; avoid platform-specific CLI dependency |

### 5.1 Dependency choices not made
- **No database client**: out of scope
- **No ORM**: no database in this phase
- **No CLI framework**: prefer minimal hand-rolled arg parsing for one command and two flags
- **No logging SaaS SDK**: local CLI does not need vendor lock-in
- **No retry/backoff library**: one bounded download path does not justify extra dependency weight

## 6. Integration Points

### 6.1 Existing Repo Integrations
This ticket integrates with the repository’s documented long-term layout but only implements the OLRC transformer slice.

Touched or expected paths:
- `SPEC.md` for output contract
- `README.md` for command documentation
- `docs/specs/1-spec.md` as canonical scope
- future code paths under `src/` and `tests/`

### 6.2 Third-Party Integration: OLRC

#### Endpoint pattern
The downloader must support the OLRC releasepoint URL pattern for title ZIP archives, for example:
```text
https://uscode.house.gov/download/releasepoints/us/pl/118/200/xml_usc01@118-200.zip
```

#### Contract
- perform HTTPS GET
- require 2xx
- require ZIP payload by magic bytes (`PK\x03\x04`) or successful ZIP parsing
- fail with title number and URL in the error message

### 6.3 Data Flow
```text
CLI args
  → title validator
  → OLRC URL resolver
  → cache lookup / atomic redownload
  → ZIP lexical XML enumeration
  → XML parser
  → merged TitleIR
  → markdown renderer
  → atomic output writer
  → JSON report
```

### 6.4 Multiple XML Files
Approved architecture decision:
- process **all** `.xml` files in lexical pathname order, including nested paths
- parse each file into partial IR
- merge into one `TitleIR` for the requested title
- de-duplicate sections by exact `sectionNumber`; if duplicates occur, fail the run because output determinism would otherwise be ambiguous

Duplicate section failure shape:
```json
{
  "code": "INVALID_XML",
  "message": "Duplicate section number '12' encountered across XML files",
  "xmlPath": "nested/usc01b.xml"
}
```

### 6.5 Test Fixture Integration
The integration suite must commit:
- a Title 1 fixture ZIP or extracted XML set
- a manifest of expected emitted filenames
- representative markdown assertions or snapshots

This ensures CI determinism and avoids live dependency on OLRC availability.

## 7. Security Considerations

### 7.1 Trust Boundary
The only untrusted input sources in this phase are:
- CLI arguments
- remote ZIP payload from `uscode.house.gov`
- XML content contained inside the ZIP
- target output path provided by the user

### 7.2 Input Validation

#### CLI validation
- `--title` must be integer `1..54`
- `--output` must be a path whose existing target is either absent or a directory
- reject missing flags before any network or filesystem side effects

#### ZIP validation
- do not trust `Content-Type` alone
- validate ZIP signature / openability
- ignore non-XML entries
- reject archives with zero XML entries
- cap maximum uncompressed XML size per entry at a safe upper bound (e.g. 64 MiB) to reduce ZIP bomb risk
- cap total extracted XML bytes per run at a safe upper bound (e.g. 256 MiB)
- **do not perform blind archive extraction**; enumerate entries first and materialize only accepted `.xml` regular-file entries
- reject any entry whose normalized archive path is absolute, contains `..` segments, contains a Windows drive prefix, or resolves outside the designated extraction root after canonicalization
- reject symlinks, hardlinks, device files, and any non-regular entry type even if the ZIP library exposes them as extractable entries
- reject duplicate normalized XML destinations so two archive entries cannot alias to the same extracted path
- require a post-resolution containment check that every materialized XML path remains under the extraction root before opening it

#### XML parsing safety
- use `fast-xml-parser` in a non-validating, non-executing configuration: `ignoreAttributes: false`, `attributeNamePrefix: '@_'`, `trimValues: false`, `parseTagValue: false`, `parseAttributeValue: false`, `processEntities: true`, `allowBooleanAttributes: false`
- do not enable any custom entity resolution, external resource loading, or schema fetching; parsing operates only on the local XML bytes already extracted from the trusted-to-be-contained workspace
- preserve text content only; ignore unexpected executable constructs
- cap accepted text node length per normalized field (for example 1 MiB) and convert oversize or malformed structures into bounded parse errors rather than process crashes
- treat malformed sections as parse errors, not process crashes

### 7.3 Filesystem Safety
- write cache and output files atomically
- never write outside the user-specified output directory for emitted markdown
- normalize section identifiers only for `/` → `-`; do not permit path traversal from section identifiers
- use `path.join` / `path.resolve` and verify resolved output stays under the requested base path
- resolve the output root once before writes begin; if the supplied output path exists and is not a directory, fail the run before any files are emitted
- treat symlinked intermediate directories under the output root as unsafe for this phase: refuse to descend through them and require a real operator-controlled directory tree for emitted files

### 7.4 Network Security
- HTTPS only
- default request timeout: 30 seconds
- one bounded retry for transient connection reset or timeout only
- no credential handling required

### 7.5 Sensitive Data Handling
No PII, secrets, tokens, or credentials are required for this phase.

Implications:
- no `.env` needed for `transform`
- no secrets should appear in logs
- no secret-scanning exception is required for this issue

### 7.6 Denial-of-Service / Resource Controls
- bounded XML entry size
- bounded total extraction size
- bounded request timeout
- no unbounded retries
- no parallel parsing fan-out in v1; single-title serial flow is safer and sufficient

### 7.7 CORS Policy
Not applicable. No HTTP server is introduced.

## 8. Implementation Plan

### Slice A — Bootstrap
- create `package.json`, `tsconfig.json`, `vitest.config.ts`
- add build/test scripts
- add `bin` entry for `us-code-tools`

### Slice B — OLRC Ingestion
- implement URL resolver
- implement cache validation and atomic write path
- implement ZIP enumeration/extraction with lexical XML ordering

### Slice C — USLM Parse Core
- implement XML normalization helpers
- implement title/chapter/section extraction
- implement nested content tree mapping and parse error collection

### Slice D — Markdown + Output
- implement frontmatter generation
- implement hierarchy-preserving markdown renderer
- implement deterministic path derivation and atomic output writes

### Slice E — Test Hardening
- unit tests for parser/renderer/writer/cache
- snapshot tests for flat, nested, and notes-heavy sections
- fixture-backed Title 1 CLI integration test

## 9. Acceptance Mapping

| Spec Requirement | Architectural Decision |
|---|---|
| Single-title transform CLI | one public `transform` command with strict argument validation |
| Cache downloads locally | manifest-backed cache under `.cache/olrc/` |
| Concurrent same-title safety | temp-file download + hash verification + atomic rename |
| Multiple XML files in ZIP | parse all in lexical order and merge deterministically |
| Section identifiers remain strings | `sectionNumber: string` in IR and path derivation |
| Partial failure allowed | parser accumulates `ParseError[]` and writer proceeds for valid sections |
| Deterministic tests | committed Title 1 fixtures; no live network in default CI |

## 10. Open Questions Resolved by Architecture
- **Do we add a database because the generic architecture template mentions one?** No. The approved spec explicitly says database: none.
- **Do we expose an HTTP API?** No. The only public contract in this phase is the CLI.
- **How do we handle multiple XML files?** Parse all XML files in lexical path order and merge.
- **How do we prevent torn cache artifacts?** Atomic temp-file writes plus ZIP/hash validation.
- **Can tests hit OLRC live in CI?** No; default tests must be fixture-backed or mocked.
