# Issue #40 Architecture — GovInfo Bulk Repository Fetch Source

## Status
Approved spec input: `docs/specs/40-spec.md`

No prior `docs/architecture/40-architecture.md` existed at the time of drafting.
No `.dark-factory.yml` file exists in this worktree, so implementation constraints are derived from the approved spec and the current repository layout (`src/commands`, `src/sources`, `src/utils`, Vitest-based test suite, TypeScript CLI package).

---

## 1. Data Model

### 1.1 Persistence decision
This feature remains a **single-process CLI ingestion path**. It does **not** add a database, service, queue, or remote state store. The authoritative persistence layer is:

1. `data/cache/govinfo-bulk/...` for downloaded and extracted artifacts
2. `data/manifest.json` for resumable state and failure tracking

A relational database is intentionally **not introduced** because:
- the product is currently a local CLI, not a multi-user service
- the spec explicitly says no new infrastructure is required
- resumable state is already standardized in `src/utils/manifest.ts`
- filesystem + manifest is sufficient, testable, and operationally simpler for multi-GB bulk downloads

### 1.2 Manifest schema changes
Extend `SourceName` with `govinfo-bulk` and add a dedicated manifest subtree.

#### Type additions in `src/utils/manifest.ts`
```ts
export type SourceName =
  | 'olrc'
  | 'congress'
  | 'govinfo'
  | 'govinfo-bulk'
  | 'voteview'
  | 'legislators';

export type GovInfoBulkCollection = 'BILLSTATUS' | 'BILLS' | 'BILLSUM' | 'PLAW';

export interface GovInfoBulkFileState {
  source_url: string;
  relative_cache_path: string;
  congress: number;
  collection: GovInfoBulkCollection;
  listing_path: string[];
  upstream_byte_size: number | null;
  fetched_at: string | null;
  completed_at: string | null;
  download_status: 'pending' | 'downloaded' | 'extracted' | 'failed';
  validation_status: 'not_checked' | 'xml_valid' | 'zip_valid' | 'invalid_payload';
  file_kind: 'zip' | 'xml' | 'unknown';
  extraction_root: string | null;
  error: FailureSummary | null;
}

export interface GovInfoBulkCongressState {
  congress: number;
  discovered_at: string;
  completed_at: string | null;
  status: 'pending' | 'partial' | 'complete' | 'failed';
  directories_visited: number;
  files_discovered: number;
  files_downloaded: number;
  files_skipped: number;
  files_failed: number;
  file_keys: string[];
}

export interface GovInfoBulkCollectionState {
  collection: GovInfoBulkCollection;
  discovered_at: string;
  completed_at: string | null;
  status: 'pending' | 'partial' | 'complete' | 'failed';
  discovered_congresses: number[];
  congress_runs: Record<string, GovInfoBulkCongressState>;
}

export interface GovInfoBulkCheckpointState {
  selected_collections: GovInfoBulkCollection[];
  selected_congress: number | null;
  pending_directory_urls: string[];
  active_file_urls: string[];
  updated_at: string;
}

export interface GovInfoBulkManifestState extends SourceStatusSummary {
  checkpoints: Record<string, GovInfoBulkCheckpointState>;
  collections: Record<GovInfoBulkCollection, GovInfoBulkCollectionState>;
  files: Record<string, GovInfoBulkFileState>;
}
```

#### `FetchManifest` addition
```ts
export interface FetchManifest {
  version: 1;
  updated_at: string;
  sources: {
    olrc: OlrcManifestState;
    congress: CongressManifestState;
    govinfo: GovInfoManifestState;
    'govinfo-bulk': GovInfoBulkManifestState;
    voteview: SourceStatusSummary & { files?: Record<string, unknown>; indexes?: unknown[] };
    legislators: LegislatorsManifestState;
  };
  runs: unknown[];
}
```

### 1.3 File keying strategy
Each downloadable artifact must have a stable manifest key:

```ts
const manifestFileKey = `${collection}:${congress}:${relativeCachePath}`;
```

Why:
- unique across collections and congresses
- deterministic across reruns
- unaffected by transient temp-file names
- safe for resume checks and `--force` scope clearing

### 1.4 On-disk cache layout
Canonical cache root:

```text
data/cache/govinfo-bulk/{collection}/{congress}/...
```

Path derivation rule:
- derive from the GovInfo URL path after `/bulkdata/{collection}/{congress}/`
- preserve all remaining directory segments exactly
- never flatten filenames

Examples:

```text
https://www.govinfo.gov/bulkdata/BILLSTATUS/119/hr/BILLSTATUS-119hr.xml.zip
→ data/cache/govinfo-bulk/BILLSTATUS/119/hr/BILLSTATUS-119hr.xml.zip
→ extracted to data/cache/govinfo-bulk/BILLSTATUS/119/hr/extracted/

https://www.govinfo.gov/bulkdata/PLAW/118/public/PLAW-118publ52.xml
→ data/cache/govinfo-bulk/PLAW/118/public/PLAW-118publ52.xml
```

### 1.5 Atomic write model
Every file download uses a temp path in the target directory:

```text
<target>.tmp-<pid>-<timestamp>
```

Write sequence:
1. create parent directory
2. stream response body into temp file
3. validate payload type/content
4. if ZIP, extract into temp extraction dir
5. if BILLSTATUS XML, parse at least one XML artifact successfully
6. rename temp file to final file path
7. rename temp extraction directory to final extraction root
8. update manifest entry to completed state

The manifest entry must **never** be marked complete before all validation and renames succeed.

### 1.6 Resume semantics
A file is resumable/skippable when all of the following are true:
- manifest entry exists
- `download_status` is `downloaded` or `extracted`
- `completed_at` is non-null
- cached file exists
- cached byte count equals `upstream_byte_size` when that value is known
- required extraction root exists for ZIP artifacts
- validation status is not `invalid_payload`

Otherwise the file is treated as incomplete and re-fetched.

### 1.7 Manifest normalization rules
`normalizeManifest()` must default missing `govinfo-bulk` data safely:

```ts
'govinfo-bulk': {
  last_success_at: null,
  last_failure: null,
  checkpoints: {},
  collections: {},
  files: {},
}
```

### 1.8 Seed / fixture data for tests
No production seed data is required. Test fixtures should include:
- root XML listing with all four allowed collections
- collection listing with congress directories
- nested listing examples for:
  - `BILLSTATUS/{congress}/{bill-type}/...`
  - `BILLS/{congress}/{bill-type}/...`
  - `BILLSUM/{congress}/{bill-type}/...`
  - `PLAW/{congress}/public/...` and `private/...`
- one valid ZIP fixture containing XML
- one valid raw XML fixture
- one HTML error fixture mislabeled as XML/ZIP
- one partial manifest fixture with incomplete file state

### 1.9 Index rationale
There are no database indexes because this feature does not add a database. Instead, performance relies on:
- O(1) manifest lookup by file key in `files: Record<string, GovInfoBulkFileState>`
- path-local extraction directories for cheap existence checks
- bounded in-memory traversal queue rather than loading the full repository tree

---

## 2. API Contract

This feature adds **no HTTP server endpoints**. The public contract is the **CLI surface and JSON stdout payloads**.

To satisfy machine-readable contract requirements, the architecture defines a minimal OpenAPI document for the project’s externally exposed HTTP API surface after this change: **none**.

### 2.1 OpenAPI 3.1 document
```yaml
openapi: 3.1.0
info:
  title: us-code-tools internal HTTP API surface
  version: 0.1.0
  description: |
    The us-code-tools project remains a local TypeScript CLI. Issue #40 adds no
    network-listening HTTP endpoints. The externally consumable contract for this
    feature is CLI invocation plus JSON stdout/stderr behavior.
servers: []
paths: {}
components:
  schemas:
    FetchGovInfoBulkResult:
      type: object
      required:
        - source
        - ok
        - collections
        - directories_visited
        - files_discovered
        - files_downloaded
        - files_skipped
      properties:
        source:
          type: string
          const: govinfo-bulk
        ok:
          type: boolean
        collection:
          type: string
          enum: [BILLSTATUS, BILLS, BILLSUM, PLAW]
        collections:
          type: array
          items:
            type: string
            enum: [BILLSTATUS, BILLS, BILLSUM, PLAW]
        congress:
          type:
            - integer
            - 'null'
          minimum: 1
        discovered_congresses:
          type: array
          items:
            type: integer
            minimum: 1
        directories_visited:
          type: integer
          minimum: 0
        files_discovered:
          type: integer
          minimum: 0
        files_downloaded:
          type: integer
          minimum: 0
        files_skipped:
          type: integer
          minimum: 0
        files_failed:
          type: integer
          minimum: 0
        error:
          $ref: '#/components/schemas/StructuredError'
    StructuredError:
      type: object
      required: [code, message]
      properties:
        code:
          type: string
        message:
          type: string
```

### 2.2 CLI contract
#### Accepted invocations
```bash
node dist/index.js fetch --source=govinfo-bulk
node dist/index.js fetch --source=govinfo-bulk --collection=BILLSTATUS
node dist/index.js fetch --source=govinfo-bulk --congress=119
node dist/index.js fetch --source=govinfo-bulk --collection=PLAW --congress=118
node dist/index.js fetch --source=govinfo-bulk --collection=BILLSTATUS --congress=119 --force
node dist/index.js fetch --status
```

#### Validation rules
- `--source=govinfo-bulk` is a valid source
- `--collection` may appear **at most once**
- valid `--collection` values: `BILLSTATUS`, `BILLS`, `BILLSUM`, `PLAW`
- `--collection` without `--source=govinfo-bulk` is invalid
- `--congress=<integer>` is allowed with `govinfo-bulk`
- `--all` may not implicitly include `govinfo-bulk` until the project intentionally opts into multi-GB bulk behavior; architecture recommendation is to **exclude it from `--all`** in this phase to prevent surprising large downloads

### 2.3 Success payload
Single-source success payload:

```json
{
  "source": "govinfo-bulk",
  "ok": true,
  "collections": ["BILLSTATUS"],
  "congress": 119,
  "discovered_congresses": [119],
  "directories_visited": 12,
  "files_discovered": 48,
  "files_downloaded": 48,
  "files_skipped": 0,
  "files_failed": 0
}
```

### 2.4 Failure payload
```json
{
  "source": "govinfo-bulk",
  "ok": false,
  "collections": ["BILLSTATUS"],
  "congress": 119,
  "discovered_congresses": [119],
  "directories_visited": 5,
  "files_discovered": 16,
  "files_downloaded": 14,
  "files_skipped": 0,
  "files_failed": 2,
  "error": {
    "code": "upstream_request_failed",
    "message": "GovInfo bulk listing request failed with HTTP 503"
  }
}
```

### 2.5 `fetch --status` contract
`fetch --status` must include a top-level `govinfo-bulk` source object with:
- `last_success_at`
- `last_failure`
- collection summaries
- optionally current checkpoints

Example:
```json
{
  "sources": {
    "govinfo-bulk": {
      "last_success_at": "2026-04-03T15:00:00.000Z",
      "last_failure": null,
      "collections": {
        "BILLSTATUS": {
          "collection": "BILLSTATUS",
          "status": "partial",
          "discovered_congresses": [108,109,110,111,112,113,114,115,116,117,118,119]
        }
      },
      "checkpoints": {}
    }
  }
}
```

### 2.6 Auth, rate limits, pagination
- **Auth:** none for `govinfo-bulk`
- **Rate limiting:** no shared `API_DATA_GOV_KEY` budget; local implementation enforces max concurrency 2
- **Pagination:** not applicable; discovery uses recursive XML directory traversal instead of paginated API responses

---

## 3. Service Boundaries

### 3.1 Module layout
Add two new modules and keep the feature inside the existing monolithic CLI:

1. `src/sources/govinfo-bulk.ts`
   - orchestrates selection, traversal, downloads, extraction, manifest updates, result aggregation
2. `src/utils/govinfo-bulk-listing.ts`
   - fetches and parses GovInfo XML directory listings into typed entries

Optional helper if the source file becomes too large:
3. `src/utils/govinfo-bulk-files.ts`
   - atomic download/extract/validation helpers

### 3.2 Ownership boundaries
- `src/commands/fetch.ts`
  - owns CLI parsing and validation
  - dispatches to `fetchGovInfoBulkSource()`
- `src/sources/govinfo-bulk.ts`
  - owns runtime workflow and result payload
  - owns bounded concurrency queue
  - owns checkpoint lifecycle
- `src/utils/govinfo-bulk-listing.ts`
  - owns XML parsing, entry classification, and traversal safety
- `src/utils/manifest.ts`
  - owns persistence schema and normalization
- `docs/DATA-ACQUISITION-RUNBOOK.md`
  - owns operator instructions

### 3.3 Dependency direction
```text
src/commands/fetch.ts
  -> src/sources/govinfo-bulk.ts
      -> src/utils/govinfo-bulk-listing.ts
      -> src/utils/manifest.ts
      -> src/utils/cache.ts (only if reusing raw-response caching for listings)
      -> src/utils/logger.ts (optional structured network logging)
```

Rules:
- `manifest.ts` must not import source-specific modules
- `govinfo-bulk-listing.ts` must remain pure except for the explicit HTTP fetch function passed into it or contained within a narrow effect layer
- no circular dependency with existing `govinfo.ts`

### 3.4 Processing model
Recommended execution flow:

1. validate selectors in `parseFetchArgs()`
2. choose selected collections
3. discover available congresses from each collection listing
4. apply optional congress filter
5. breadth-first traverse selected directory trees
6. enqueue downloadable files
7. process downloads with concurrency limit = 2
8. validate payloads
9. extract ZIPs when applicable
10. write manifest updates after each file completion/failure
11. compute aggregate result and return JSON payload

### 3.5 Queue decision
No external queue is added. A simple in-process promise pool is sufficient because:
- max concurrency is explicitly small
- job durability already exists in manifest checkpoints
- this is CLI execution, not a background distributed worker system

### 3.6 `--all` boundary decision
Architecture recommendation: **do not include `govinfo-bulk` in `fetch --all` for this issue**.

Rationale:
- bulk downloads are materially larger and longer-running than current sources
- operators use `govinfo-bulk` as a deliberate historical backfill workflow, not as a routine refresh
- keeping it opt-in prevents accidental multi-GB downloads in CI or local smoke tests

If product wants parity later, that should be a separate issue with an explicit UX decision.

---

## 4. Infrastructure Requirements

### 4.1 Production/runtime requirements
There is no deployed service. “Production” for this feature means a local or automation host running the CLI.

Required runtime stack:
- Node.js 22+
- HTTPS egress to `https://www.govinfo.gov/bulkdata/`
- local writable filesystem with several GB free for cache/extraction

Storage expectations:
- BILLSTATUS: ~2–5 GB
- PLAW: ~0.5–1 GB
- BILLS: ~10–20 GB
- BILLSUM: ~0.5 GB

Operational recommendation:
- require operators to treat `data/` as ephemeral cache, not git-tracked content
- recommend at least 25 GB free before running all four collections

### 4.2 External endpoints used
Allowed remote requests:
- `GET https://www.govinfo.gov/bulkdata/`
- recursive anonymous `GET` requests only below that path

Disallowed for this feature:
- any `api.govinfo.gov` usage
- any `api.congress.gov` usage
- any shell-out to `curl`, `wget`, or unzip binaries

### 4.3 Local filesystem requirements
Create as needed:
- `data/cache/govinfo-bulk/`
- manifest temp files in `data/`
- temp download files colocated with final targets
- temp extraction directories colocated with final extraction roots

### 4.4 Observability
Use existing structured logging style where available. Minimum events:
- listing request start/success/failure
- file download start/success/failure
- invalid payload rejection
- manifest checkpoint written
- collection completed

Metrics can remain implicit in JSON result counts for now; no new monitoring backend is needed.

### 4.5 Development/testing requirements
No Docker or database required.

Dev/test stack:
- Node.js 22+
- TypeScript 5.8+
- Vitest 3.x

Test organization:
- `tests/cli/fetch.test.ts` for argument validation and status output
- `tests/unit/sources/govinfo-bulk.test.ts` for traversal, resume, and filtering logic
- `tests/integration/govinfo-bulk.test.ts` for end-to-end cache + manifest behavior using fixture HTTP responses and temp directories

### 4.6 CI requirements
CI jobs must:
- run unit and integration tests without contacting live GovInfo by default
- use fixture XML listings and fixture ZIP/XML bodies
- avoid `API_DATA_GOV_KEY`
- verify one BILLSTATUS XML parse succeeds during integration testing

Optional separate manual smoke test:
- live run against `--collection=BILLSTATUS --congress=119`

---

## 5. Dependency Decisions

### 5.1 `fast-xml-parser` `^4.5.0`
- **Use:** parse XML directory listings and validate downloaded XML artifacts
- **Why:** already present in repo; avoids new dependency surface; supports fast non-DOM parsing
- **License:** MIT-compatible
- **Maintenance:** active enough for this project tier; already accepted dependency
- **Decision:** keep and reuse

### 5.2 `yauzl` `^3.1.0`
- **Use:** inspect and extract ZIP artifacts without shelling out
- **Why:** already present; streaming ZIP support; avoids external unzip dependency
- **License:** MIT-compatible
- **Maintenance:** mature and stable
- **Decision:** reuse for ZIP extraction/validation

### 5.3 Native `fetch`, `fs/promises`, `path`
- **Use:** HTTPS requests, atomic file writes, directory management
- **Why:** built into Node 22; boring and sufficient
- **Decision:** prefer native APIs over axios/got/adm-zip additions

### 5.4 No new concurrency library
- **Why not `p-limit` or queue packages:** concurrency ceiling is 2 and can be implemented in <30 lines with explicit promise worker logic
- **Decision:** no new dependency

### 5.5 No checksum dependency
- **Why:** upstream listings do not guarantee checksum metadata, and acceptance criteria only require size/date + validation semantics
- **Decision:** do not add hashing requirement for this phase

---

## 6. Integration Points

### 6.1 Existing CLI integration
Files to change:
- `src/commands/fetch.ts`
- `src/utils/manifest.ts`
- `docs/DATA-ACQUISITION-RUNBOOK.md`

New files:
- `src/sources/govinfo-bulk.ts`
- `src/utils/govinfo-bulk-listing.ts`
- tests under `tests/unit/sources/` and `tests/integration/`

### 6.2 Relationship to existing sources
- `govinfo-bulk` is additive and separate from `govinfo`
- `govinfo` remains the API-based, key-requiring, resumable incremental path
- `govinfo-bulk` becomes the preferred historical backfill path for BILLSTATUS/PLAW/BILLS/BILLSUM

### 6.3 Manifest compatibility
`normalizeManifest()` must remain backward-compatible with existing manifest files lacking `govinfo-bulk`.

### 6.4 Data flow
```text
CLI args
-> parseFetchArgs
-> fetchGovInfoBulkSource
-> discover collection listing(s)
-> discover congress directory/directories
-> recursively traverse subdirectories
-> enqueue file downloads
-> validate + extract artifacts
-> update manifest.json
-> emit result JSON
```

### 6.5 Error flow
Failures are localized per file whenever possible.

Rules:
- invalid listing XML: fail selected scope immediately
- invalid file payload: record file failure and continue unless failure budget/policy says otherwise
- manifest write failure: fail run immediately because resumability can no longer be trusted
- extraction failure: file remains failed/incomplete; temp data cleaned up best-effort

### 6.6 Runbook integration
Update `docs/DATA-ACQUISITION-RUNBOOK.md` to:
- insert `govinfo-bulk` as a first-class acquisition phase before API GovInfo/Congress historical crawling
- document no-key behavior
- document `--collection` and `--congress`
- document resume and `--force`
- document cache location and expected disk usage
- recommend acquisition order: BILLSTATUS → PLAW → BILLSUM → BILLS

---

## 7. Security Considerations

### 7.1 Trust boundary
Remote content from `www.govinfo.gov` is **untrusted input** even though it comes from an official government domain. The implementation must validate all listings and downloaded artifacts before marking them complete.

### 7.2 Allowed network scope
Hard-allow only:
- protocol: `https:`
- host: `www.govinfo.gov`
- path prefix: `/bulkdata/`

Reject any listing entry whose resolved URL escapes that boundary.

### 7.3 Input validation strategy
#### Listing validation
For each listing response:
- require HTTP 2xx
- require body parseable as XML
- reject HTML payloads (`<!DOCTYPE html>`, `<html`, content-type mismatch when obvious)
- require entry names and hrefs to be non-empty
- normalize and resolve relative URLs safely

#### File validation
For downloaded files:
- if suffix is `.zip`, verify ZIP central directory opens successfully
- if collection is `BILLSTATUS`, require at least one extracted XML file to parse via `fast-xml-parser`
- if suffix is `.xml`, parse directly as XML before marking complete
- reject HTML/error bodies even if filename ends in `.xml` or `.zip`

### 7.4 Path traversal defense
When extracting ZIP entries:
- normalize each entry path
- reject absolute paths
- reject `..` traversal
- reject symlinks if surfaced by the ZIP library
- write only beneath the designated extraction root

### 7.5 Partial-file safety
Never expose partial files as complete:
- temp file + rename only
- temp extraction dir + rename only
- manifest completion only after both succeed

### 7.6 Secret handling
This feature must not:
- read `API_DATA_GOV_KEY`
- require any credential
- log environment variables
- emit local absolute paths in user-facing JSON unless already consistent with project norms

### 7.7 Concurrency safety
Bound concurrency to 2. This reduces:
- accidental upstream load spikes
- local descriptor pressure
- race conditions around manifest writes

Manifest writes remain serialized in-process.

### 7.8 Multi-process contention
The project does not yet provide cross-process locks. For this issue:
- temp filenames must be process-specific
- manifest should only record completed artifacts after final rename
- if two processes race, the loser must re-check final file existence and manifest state before overwriting

Future enhancement: manifest lockfile or advisory file lock. Not required for this issue, but current implementation must avoid corrupting final artifacts.

### 7.9 Denial-of-service considerations
- traversal must be iterative, not deeply recursive on call stack
- avoid reading entire large ZIPs or all extracted XML into memory at once
- stream downloads to disk
- enforce reasonable request timeout

### 7.10 CORS
Not applicable. This is not a browser-facing service.

---

## 8. Implementation Plan

### 8.1 CLI parsing
Modify `src/commands/fetch.ts`:
- extend `FetchArgs` with `collection: GovInfoBulkCollection | null`
- validate `--collection`
- add `govinfo-bulk` to `isSourceName()`
- dispatch to `fetchGovInfoBulkSource({ force, congress, collection, mode: 'single' })`
- include `govinfo-bulk` in `fetch --status`

### 8.2 Listing parser
Create `src/utils/govinfo-bulk-listing.ts` with:
- `parseGovInfoBulkListing(xml: string): ListingEntry[]`
- `classifyListingEntry(entry): 'directory' | 'file'`
- `resolveGovInfoBulkUrl(baseUrl, href): URL | Error`
- `isAllowedGovInfoBulkUrl(url): boolean`

Return typed entries:
```ts
interface ListingEntry {
  name: string;
  href: string;
  url: string;
  kind: 'directory' | 'file';
}
```

### 8.3 Source orchestrator
Create `src/sources/govinfo-bulk.ts` with exported function:
```ts
export async function fetchGovInfoBulkSource(invocation: {
  force: boolean;
  congress: number | null;
  collection: GovInfoBulkCollection | null;
}): Promise<GovInfoBulkResult>
```

### 8.4 Traversal algorithm
Use iterative BFS queue per selected collection:
- enqueue collection root
- discover congress dirs
- enqueue matching congress dirs
- walk until files found
- aggregate stats in collection/congress counters

### 8.5 Download algorithm
For each discovered file:
- consult manifest resume state
- skip or download
- validate and extract
- update file state and counters

### 8.6 Testing plan
Must cover:
- CLI validation for new source/collection rules
- manifest normalization backward compatibility
- scope filtering by collection and congress
- recursive traversal across heterogeneous directory shapes
- bounded concurrency enforcement
- resume behavior for completed vs incomplete files
- HTML payload rejection
- ZIP extraction path safety
- successful BILLSTATUS XML parse proof

---

## 9. Key Decisions Summary

| Decision | Rationale |
|---|---|
| Add new source instead of extending `govinfo` | Keeps anonymous bulk backfill separate from API-key incremental flow |
| Reuse manifest.json instead of adding DB | Single-user CLI, existing persistence pattern, no new infra needed |
| Keep host/path allowlist to `https://www.govinfo.gov/bulkdata/` | Prevents traversal-driven SSRF or host escape |
| Validate XML/ZIP before marking complete | Prevents HTML/error payloads from poisoning resume state |
| Default concurrency = 2 | Meets spec and stays polite to upstream |
| Exclude `govinfo-bulk` from `fetch --all` in this phase | Avoids accidental multi-GB downloads and CI surprises |
| Preserve remote directory structure under cache | Makes paths deterministic and reviewable |

---

## 10. Reviewer-Focused Notes

### Security concerns proactively addressed
- anonymous HTTPS only
- strict GovInfo bulk host/path allowlist
- no new secrets
- XML/ZIP payload validation
- path traversal-safe extraction
- atomic writes
- manifest completion only after validation

### Human architecture review concerns proactively addressed
- additive design only; no regression to existing `govinfo`
- no new infrastructure burden
- bounded scope and explicit module ownership
- runbook updated for operator usability
- opt-in bulk behavior instead of surprise inclusion in `--all`
