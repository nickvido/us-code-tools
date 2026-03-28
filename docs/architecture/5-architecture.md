# Architecture — Issue #5: Data Acquisition — API Clients & Initial Source Download

## Status
Approved spec input: `docs/specs/5-spec.md`

## Inputs Reviewed
- `docs/specs/5-spec.md`
- GitHub issue #5 and full review thread through final approved spec
- `README.md`
- `package.json`
- `src/index.ts`
- `src/sources/olrc.ts`
- `.gitignore`
- Existing architecture documents: `docs/architecture/1-architecture.md`, `docs/architecture/3-architecture.md`

## Constraints and Operating Assumptions
- No `.dark-factory.yml` was present in the repo root or worktree at architecture time. Effective constraints therefore come from the approved spec and the existing repository/toolchain.
- This issue extends the existing Node.js TypeScript CLI; it does **not** introduce a long-running service.
- The approved spec explicitly requires **no database** and **no internal HTTP API** for this issue. The production persistence layer for this ticket is the local filesystem under `data/`.
- Congress.gov and GovInfo share one `API_DATA_GOV_KEY` and therefore one coordinated rolling-hour request budget.
- Acquisition must be resumable and crash-safe at the manifest/artifact level.
- Raw artifacts are intentionally local and Git-ignored. They are production data for the operator’s machine, but not repository content.

## Review Feedback Addressed
The architecture below explicitly incorporates the final approved-review chain, including:
- deterministic OLRC latest-vintage selection and incomplete-vintage failure behavior
- `fetch --all` as a valid bare command with historical bulk scope
- runtime `getCurrentCongress()` resolution via Congress.gov with explicit degraded fallback signaling
- one reusable Congress global-member snapshot instead of per-congress duplicate member crawls
- Congress bulk-history resume/checkpoint semantics
- GovInfo page-order, interleaving, exhaustion, and resume semantics
- explicit skip-only legislators cross-reference behavior for missing/stale/incomplete Congress snapshots
- all-sources fail-open behavior for `fetch --all`
- atomic cache/manifest safety and deterministic concurrent-writer outcomes
- explicit disk, extraction, and temporary-workspace ceilings for large artifacts
- upstream-origin allowlisting plus persisted integrity metadata for all downloaded artifacts
- allowlist-only structured logging rules that forbid raw request/response/exception serialization
- tighter default cache permissions on shared hosts
- explicit dependency review and vulnerability-scan requirements for implementation completion

---

## 1. Data Model

This issue does **not** introduce Postgres, SQLite, or any other relational database. That is the correct production choice here because the deliverable is a local acquisition CLI whose source of truth is raw downloaded artifacts plus a durable manifest. Adding a DB would increase operational burden without solving a real requirement in this phase.

The concrete production data model is therefore:
1. raw source artifacts under `data/cache/{source}/`
2. one manifest file at `data/manifest.json`
3. typed in-process state machines for resumable source execution
4. optional persisted secondary lookup artifacts where needed (`bioguide-crosswalk.json`, VoteView indexes if chosen)

### 1.1 Filesystem Storage Layout

```text
data/
├── cache/
│   ├── olrc/
│   │   └── vintages/{vintage}/title-{NN}/
│   │       ├── title-{NN}.zip
│   │       └── extracted/
│   │           └── *.xml
│   ├── congress/
│   │   ├── bills/{congress}/pages/{page-key}.json
│   │   ├── bills/{congress}/{billType}/{billNumber}/detail.json
│   │   ├── bills/{congress}/{billType}/{billNumber}/actions.json
│   │   ├── bills/{congress}/{billType}/{billNumber}/cosponsors.json
│   │   ├── committees/{congress}/pages/{page-key}.json
│   │   └── members/snapshots/{snapshot-id}/
│   │       ├── pages/{page-key}.json
│   │       ├── details/{bioguideId}.json
│   │       └── snapshot.json
│   ├── govinfo/
│   │   ├── collections/plaw/{scope-hash}/pages/{page-key}.json
│   │   └── packages/{packageId}/
│   │       ├── summary.json
│   │       └── granules.json
│   ├── voteview/
│   │   ├── HSall_members.csv
│   │   ├── HSall_votes.csv
│   │   ├── HSall_rollcalls.csv
│   │   └── indexes/
│   │       ├── members-by-congress.json
│   │       ├── votes-by-congress.json
│   │       └── rollcalls-by-member.json
│   └── legislators/
│       ├── legislators-current.yaml
│       ├── legislators-historical.yaml
│       ├── committees-current.yaml
│       └── bioguide-crosswalk.json
└── manifest.json
```

Notes:
- Directory naming is deterministic from request identity; no time-based random paths.
- JSON API cache entries store the exact raw upstream body plus small sidecar metadata inside the manifest, not rewritten normalized payloads.
- Permanent downloads (ZIP/CSV/YAML) are overwritten only on `--force` or when the prior artifact is incomplete/corrupt.
- API caches are TTL-governed by manifest metadata rather than filename changes.

### 1.2 Manifest Schema

Canonical file:
```text
data/manifest.json
```

Canonical top-level shape:
```ts
export interface FetchManifest {
  version: 1;
  updated_at: string; // ISO-8601
  sources: {
    olrc: OlrcManifestState;
    congress: CongressManifestState;
    govinfo: GovInfoManifestState;
    voteview: VoteViewManifestState;
    legislators: LegislatorsManifestState;
  };
  runs: FetchRunRecord[];
}
```

Common reusable shapes:
```ts
export interface ArtifactRecord {
  artifact_id: string;
  path: string;
  source: 'olrc' | 'congress' | 'govinfo' | 'voteview' | 'legislators';
  content_type: string;
  byte_count: number;
  checksum_sha256: string;
  fetched_at: string;
  expires_at: string | null;
  request: {
    method: 'GET';
    url: string;
    cache_key: string;
  };
}

export interface SourceFailureRecord {
  recorded_at: string;
  code:
    | 'invalid_arguments'
    | 'missing_api_data_gov_key'
    | 'upstream_auth_rejected'
    | 'rate_limit_exhausted'
    | 'missing_from_vintage'
    | 'conflict_in_progress'
    | 'upstream_request_failed'
    | 'artifact_write_failed'
    | 'manifest_write_failed';
  message: string;
  details?: Record<string, string | number | boolean | string[]>;
}
```

#### 1.2.1 OLRC manifest state
```ts
export interface OlrcManifestState {
  selected_vintage: string | null;
  last_success_at: string | null;
  last_failure: SourceFailureRecord | null;
  titles: Record<string, {
    title: number;
    vintage: string;
    zip_artifact: ArtifactRecord;
    extraction_dir: string;
    extracted_xml_artifacts: ArtifactRecord[];
  }>;
}
```

#### 1.2.2 Congress manifest state
```ts
export interface CongressManifestState {
  last_success_at: string | null;
  last_failure: SourceFailureRecord | null;
  bulk_scope: {
    congress: {
      start: number;           // e.g. 93
      current: number;         // resolved CURRENT_CONGRESS
      resolution: 'live' | 'override' | 'fallback';
      fallback_value: number | null;  // non-null only when resolution='fallback'
      operator_review_required: boolean; // true when resolution='fallback'
    };
    resolved_at: string;
  } | null;  // null when not a bulk run
  member_snapshot: {
    snapshot_id: string | null;
    status: 'missing' | 'complete' | 'incomplete' | 'stale';
    snapshot_completed_at: string | null;
    cache_ttl_ms: number | null;
    member_page_count: number;
    member_detail_count: number;
    failed_member_details: string[];
    artifacts: string[]; // artifact_ids
  };
  congress_runs: Record<string, {
    congress: number;
    completed_at: string | null;
    bill_page_count: number;
    bill_detail_count: number;
    bill_action_count: number;
    bill_cosponsor_count: number;
    committee_page_count: number;
    failed_bills: string[];
  }>;
  bulk_history_checkpoint: {
    scope: 'all';
    current: number | null;
    start: 93;
    next_congress: number | null;
    in_progress?: {
      congress: number;
      next_bill_page_url: string | null;
      pending_bill_keys: string[];
      next_committee_page_url: string | null;
      pending_member_snapshot_work: boolean;
    };
    updated_at: string | null;
  } | null;
}
```

#### 1.2.3 GovInfo manifest state
```ts
export interface GovInfoManifestState {
  last_success_at: string | null;
  last_failure: SourceFailureRecord | null;
  query_scopes: Record<string, {
    query_scope: 'unfiltered' | `congress=${number}`;
    termination: 'complete' | 'rate_limit_exhausted';
    listed_package_count: number;
    retained_package_count: number;
    summary_count: number;
    granule_count: number;
    malformed_package_ids: string[];
    completed_at: string | null;
  }>;
  checkpoints: Record<string, {
    query_scope: 'unfiltered' | `congress=${number}`;
    next_page_url: string | null;
    retained_not_finalized: string[];
    finalized_package_ids: string[];
    updated_at: string;
  }>;
}
```

#### 1.2.4 VoteView manifest state
```ts
export interface VoteViewManifestState {
  last_success_at: string | null;
  last_failure: SourceFailureRecord | null;
  files: {
    HSall_members_csv?: ArtifactRecord;
    HSall_votes_csv?: ArtifactRecord;
    HSall_rollcalls_csv?: ArtifactRecord;
  };
  indexes: Array<{
    name: string;
    artifact: ArtifactRecord;
    kind: 'by-congress' | 'by-member';
  }>;
}
```

#### 1.2.5 Legislators manifest state
```ts
export interface LegislatorsManifestState {
  last_success_at: string | null;
  last_failure: SourceFailureRecord | null;
  files: {
    legislators_current_yaml?: ArtifactRecord;
    legislators_historical_yaml?: ArtifactRecord;
    committees_current_yaml?: ArtifactRecord;
  };
  cross_reference: {
    status:
      | 'completed'
      | 'skipped_missing_congress_cache'
      | 'skipped_stale_congress_snapshot'
      | 'skipped_incomplete_congress_snapshot';
    based_on_snapshot_id: string | null;
    crosswalk_artifact_id: string | null;
    matched_bioguide_ids: number;
    unmatched_legislator_bioguide_ids: number;
    unmatched_congress_bioguide_ids: number;
    updated_at: string | null;
  };
}
```

### 1.3 Atomic Write Contract

All writes use write-to-temp + fsync + rename semantics in the same filesystem:

```ts
export interface AtomicWritePlan {
  temp_path: string;
  final_path: string;
  mode: number; // 0o600 manifest/locks, 0o640 cache artifacts by default
  fsync_parent_directory: boolean;
}
```

Rules:
- No manifest success entry is written before its referenced artifact rename succeeds.
- Manifest replacement is a single rename.
- Failed writes must remove temp files best-effort.
- Concurrent writers acquire a source-scoped lock file under `data/.locks/{source}.lock`; loser exits with `conflict_in_progress`.

### 1.4 TTL Policy

```ts
export interface CachePolicy {
  apiResponseTtlMs: {
    congress: number;
    govinfo: number;
  };
  permanentDownloads: {
    olrc: true;
    voteview: true;
    legislators: true;
  };
}
```

Recommended defaults:
- Congress API TTL: `24h`
- GovInfo API TTL: `24h`
- Permanent-download sources: no TTL; only `--force` refreshes

Rationale:
- The issue explicitly requires TTL-backed raw API response reuse.
- Congress global-member snapshot freshness must be derived from **all referenced artifacts** still being within the configured Congress TTL.

### 1.5 Resource and Storage Ceiling Policy

Large upstream artifacts are a first-class operational risk in this issue, so the implementation must enforce explicit ceilings instead of trusting upstream sizes.

```ts
export interface ResourceCeilings {
  maxDownloadBytes: {
    olrcZip: number;
    voteviewCsv: number;
    legislatorsYaml: number;
    apiResponseBody: number;
  };
  maxExtractedBytesPerOlrcTitle: number;
  maxTemporaryBytesPerSourceRun: number;
  minFreeDiskBytesBeforeLargeWrite: number;
}
```

Required default ceilings:
- `maxDownloadBytes.olrcZip = 512 * 1024 * 1024`
- `maxDownloadBytes.voteviewCsv = 2 * 1024 * 1024 * 1024`
- `maxDownloadBytes.legislatorsYaml = 64 * 1024 * 1024`
- `maxDownloadBytes.apiResponseBody = 64 * 1024 * 1024`
- `maxExtractedBytesPerOlrcTitle = 2 * 1024 * 1024 * 1024`
- `maxTemporaryBytesPerSourceRun = 4 * 1024 * 1024 * 1024`
- `minFreeDiskBytesBeforeLargeWrite = 8 * 1024 * 1024 * 1024`

Enforcement rules:
- The downloader must reject any artifact whose declared or observed size exceeds the applicable ceiling.
- OLRC extraction must maintain a running extracted-byte counter and abort before exceeding the per-title ceiling.
- Before starting OLRC extraction, VoteView downloads, or index generation, the CLI must perform a free-disk preflight and fail fast with a machine-readable runtime error if the minimum free-disk threshold is not met.
- Temp files created during download/extraction/indexing count toward the source-run temporary-workspace ceiling.
- A run that fails due to any resource ceiling must leave no manifest success entry pointing at partial artifacts.

### 1.6 Seed / Migration Equivalents

No SQL migrations apply.

The seed-equivalent artifacts for this issue are:
- fixture payloads under `tests/fixtures/`
- an empty initialized manifest created on first write:

```json
{
  "version": 1,
  "updated_at": "1970-01-01T00:00:00.000Z",
  "sources": {
    "olrc": { "selected_vintage": null, "last_success_at": null, "last_failure": null, "titles": {} },
    "congress": {
      "last_success_at": null,
      "last_failure": null,
      "bulk_scope": null,
      "member_snapshot": {
        "snapshot_id": null,
        "status": "missing",
        "snapshot_completed_at": null,
        "cache_ttl_ms": null,
        "member_page_count": 0,
        "member_detail_count": 0,
        "failed_member_details": [],
        "artifacts": []
      },
      "congress_runs": {},
      "bulk_history_checkpoint": null
    },
    "govinfo": { "last_success_at": null, "last_failure": null, "query_scopes": {}, "checkpoints": {} },
    "voteview": { "last_success_at": null, "last_failure": null, "files": {}, "indexes": [] },
    "legislators": {
      "last_success_at": null,
      "last_failure": null,
      "files": {},
      "cross_reference": {
        "status": "skipped_missing_congress_cache",
        "based_on_snapshot_id": null,
        "crosswalk_artifact_id": null,
        "matched_bioguide_ids": 0,
        "unmatched_legislator_bioguide_ids": 0,
        "unmatched_congress_bioguide_ids": 0,
        "updated_at": null
      }
    }
  },
  "runs": []
}
```

---

## 2. API Contract

This issue introduces a **CLI contract**, not an HTTP API. No OpenAPI server should be added.

To keep the public interface concrete and testable, the canonical contract is the `fetch` command, its JSON stdout/stderr, and exit codes.

### 2.1 CLI Surface

```bash
npx us-code-tools fetch --status
npx us-code-tools fetch --source=olrc
npx us-code-tools fetch --source=olrc --force
npx us-code-tools fetch --source=congress --congress=<integer>
npx us-code-tools fetch --source=congress --congress=<integer> --force
npx us-code-tools fetch --source=govinfo
npx us-code-tools fetch --source=govinfo --force
npx us-code-tools fetch --source=govinfo --congress=<integer>
npx us-code-tools fetch --source=govinfo --congress=<integer> --force
npx us-code-tools fetch --source=voteview
npx us-code-tools fetch --source=voteview --force
npx us-code-tools fetch --source=legislators
npx us-code-tools fetch --source=legislators --force
npx us-code-tools fetch --all
npx us-code-tools fetch --all --force
npx us-code-tools fetch --all --congress=<integer>
npx us-code-tools fetch --all --congress=<integer> --force
```

### 2.2 Exit Code Contract

- `0` — requested operation completed successfully for all requested sources
- `1` — valid command, but one or more requested sources failed at runtime
- `2` — invalid CLI arguments; no manifest or cache mutation

### 2.3 JSON Result Shapes

#### 2.3.1 `fetch --status`
Stdout: single JSON object
```json
{
  "sources": {
    "olrc": { "last_success_at": null, "last_failure": null },
    "congress": { "last_success_at": null, "last_failure": null },
    "govinfo": { "last_success_at": null, "last_failure": null },
    "voteview": { "last_success_at": null, "last_failure": null },
    "legislators": { "last_success_at": null, "last_failure": null }
  }
}
```

#### 2.3.2 Source fetch success
```json
{
  "source": "congress",
  "ok": true,
  "requested_scope": { "congress": 119 },
  "bulk_scope": null,
  "counts": {
    "bill_pages": 18,
    "bill_details": 9012,
    "bill_actions": 9012,
    "bill_cosponsors": 9012,
    "committee_pages": 4,
    "member_pages": 23,
    "member_details": 535
  },
  "rate_limit_exhausted": false,
  "next_request_at": null,
  "degraded": false,
  "errors": []
}
```

#### 2.3.2b Bulk run result (fetch --all)
```json
{
  "source": "congress",
  "ok": true,
  "requested_scope": { "congress": "93..119" },
  "bulk_scope": {
    "congress": {
      "start": 93,
      "current": 119,
      "resolution": "live",
      "fallback_value": null,
      "operator_review_required": false
    },
    "resolved_at": "2026-03-28T20:00:00.000Z"
  },
  "counts": { "...": "..." },
  "rate_limit_exhausted": false,
  "next_request_at": null,
  "errors": []
}
```

#### 2.3.2c Bulk run with degraded fallback
```json
{
  "source": "congress",
  "ok": true,
  "requested_scope": { "congress": "93..119" },
  "bulk_scope": {
    "congress": {
      "start": 93,
      "current": 119,
      "resolution": "fallback",
      "fallback_value": 119,
      "operator_review_required": true
    },
    "resolved_at": "2026-03-28T20:00:00.000Z"
  },
  "counts": { "...": "..." },
  "rate_limit_exhausted": false,
  "next_request_at": null,
  "errors": []
}
```

#### 2.3.3 Source fetch failure
```json
{
  "source": "govinfo",
  "ok": false,
  "requested_scope": { "query_scope": "unfiltered" },
  "counts": {
    "listed_packages": 750,
    "retained_packages": 750,
    "summaries": 740,
    "granules": 740
  },
  "rate_limit_exhausted": true,
  "next_request_at": "2026-03-29T02:00:00.000Z",
  "error": {
    "code": "rate_limit_exhausted",
    "message": "Shared Congress/GovInfo budget exhausted before completion"
  }
}
```

#### 2.3.4 `fetch --all`
Stdout: one deterministic top-level result object per source, in order:
```json
[
  { "source": "olrc", "ok": true },
  { "source": "congress", "ok": true },
  { "source": "govinfo", "ok": false },
  { "source": "voteview", "ok": true },
  { "source": "legislators", "ok": true }
]
```

### 2.4 CLI Validation Matrix

Invalid combinations must emit exactly one JSON error object to stderr and exit `2`:

```json
{
  "error": {
    "code": "invalid_arguments",
    "message": "--status cannot be combined with --force"
  }
}
```

Required validation rules:
- bare `fetch` invalid
- `--status --force` invalid
- `--source=congress` requires `--congress=<n>`
- `--source=olrc --congress=<n>` invalid
- `--source=voteview --congress=<n>` invalid
- `--source=legislators --congress=<n>` invalid
- `--all --source=...` invalid
- congress value must be positive safe integer in base-10 digits only

### 2.5 Runtime Auth Contract

Congress and GovInfo only:
- required credential source: `API_DATA_GOV_KEY`
- no alternate env var names or config-file fallbacks
- missing/empty key: source fails before any outbound request with `missing_api_data_gov_key`
- `401` or `403`: source fails with `upstream_auth_rejected`
- in `fetch --all`, auth failure is source-scoped and later sources still run

### 2.6 Pagination and Bulk Contract

#### Congress
- `fetch --source=congress --congress=<n>` acquires one congress plus the reusable global member snapshot if needed.
- bare `fetch --all` covers congress range `93..getCurrentCongress()`.
- `fetch --all --congress=<n>` narrows to exactly congress `<n>` and does **not** advance the multi-congress checkpoint.
- when current-congress resolution falls back, result must be machine-identifiable as degraded.

#### GovInfo
- initial request: collection `PLAW`, no sort override
- subsequent pagination: follow exact `nextPage` URL/cursor returned by the API
- page-by-page interleaving: fetch one listing page, finalize retained packages from that page, then proceed
- terminal states: `complete` or `rate_limit_exhausted`

#### OLRC
- scrape annual-title listing
- choose the single latest vintage visible on the page
- use that same vintage for all titles `1..54`
- if latest vintage omits one or more titles, fail with `missing_from_vintage` and do not cross-fallback

---

## 3. Service Boundaries

This should remain a **single-process CLI monolith** with clear internal modules. No service split is justified at this stage.

### 3.1 Module Map

```text
src/
├── index.ts                     # CLI entry point + command routing
├── commands/
│   └── fetch.ts                 # fetch argument parsing + orchestration
├── sources/
│   ├── base-client.ts           # shared fetch/retry/cache/logging wrapper
│   ├── olrc.ts
│   ├── congress.ts
│   ├── govinfo.ts
│   ├── voteview.ts
│   └── unitedstates.ts
├── utils/
│   ├── cache.ts                 # atomic cache IO + cache key derivation
│   ├── manifest.ts              # manifest load/merge/write
│   ├── logger.ts                # structured logs, redaction
│   ├── retry.ts                 # retry/backoff + Retry-After support
│   ├── rate-limit.ts            # shared limiter implementation
│   ├── fetch-config.ts          # env parsing, getCurrentCongress, TTL constants
│   ├── lock.ts                  # source-scoped file locks
│   ├── checksum.ts              # SHA-256 hashing
│   └── json.ts                  # safe parse/stringify helpers
└── types/
    └── fetch.ts                 # result/manifest/source interfaces
```

### 3.2 Ownership Boundaries

- `commands/fetch.ts` owns CLI validation and deterministic source-order execution.
- `sources/base-client.ts` owns HTTP execution policy, but **not** source-specific pagination/state machines.
- Each source module owns:
  - upstream URL construction
  - response typing/parsing
  - source-specific checkpoint semantics
  - source-specific manifest fragments
- `utils/manifest.ts` owns only persistence and merge rules; it does not know upstream semantics.
- `utils/rate-limit.ts` owns the shared Congress/GovInfo budget.

### 3.3 Dependency Direction

Allowed direction:
```text
index.ts / commands -> sources -> utils
index.ts / commands -> utils
sources -> types
utils -> types
```

Disallowed:
- source-to-source imports except through explicit typed interfaces passed by orchestration
- `utils/*` importing `sources/*`
- circular imports between source modules and manifest/cache utilities

### 3.4 Communication Patterns

No queues, workers, or IPC are required.

Communication is direct in-process method calls:
- CLI parses request
- orchestrator acquires source lock and creates run context
- source module executes against `BaseClient`
- source emits manifest patch + result object
- orchestrator persists updates and prints output

### 3.5 Concurrency Model

Concurrency stays conservative:
- **between sources in `fetch --all`**: serial execution in deterministic order to simplify shared-manifest safety and shared-rate-budget visibility
- **within a source**: low parallelism allowed only where the source module can preserve manifest atomicity and rate-budget correctness
- recommended max in-flight requests:
  - Congress/GovInfo: `1..4`, globally coordinated through limiter
  - OLRC/VoteView/legislators: `1..6`, source-specific

Rationale: throughput matters less than deterministic, resumable, inspectable behavior.

---

## 4. Infrastructure Requirements

## 4.1 Production Runtime

This issue’s production target is an operator-run CLI on Node.js.

### Required runtime
- Node.js `22.x` LTS or newer
- POSIX-like filesystem semantics assumed for atomic rename; macOS and Linux supported first
- writable local disk for `data/`
- outbound HTTPS access to:
  - `uscode.house.gov`
  - `api.congress.gov`
  - `api.govinfo.gov`
  - `voteview.com`
  - `raw.githubusercontent.com` or GitHub download endpoints for UnitedStates data

### Secrets
- `API_DATA_GOV_KEY` in process environment only
- must never be written to logs, manifest, cache, stdout, or stderr

### Logging
- structured JSON lines to stderr
- allowlist-only event schema; the logger may emit only approved scalar fields and small arrays defined in `src/utils/logger.ts`
- minimum fields: `ts`, `level`, `event`, `source`, `url` (redacted — see below), `method`, `attempt`, `cache_status`, `duration_ms`, `status_code`
- the `url` field is the request URL with sensitive query parameters (e.g., `api_key`) replaced by `[REDACTED]`; this satisfies the spec requirement for a URL field while preventing credential leakage
- forbidden log content: raw headers, raw bodies, raw manifest fragments, raw upstream payloads, and raw exception serialization
- redaction policy: query values for `api_key` and any Authorization-like headers are replaced with `[REDACTED]` before a value reaches the logger boundary
- failures are logged as normalized error records: `error.code`, `error.message`, `retryable`, and selected source identifiers only

### Monitoring / operator visibility
No hosted monitoring stack is required, but the architecture must support:
- machine-readable stdout summaries
- machine-readable manifest status
- deterministic error codes for automation

## 4.2 Development / Test Environment

### Local development
- plain `npm install`
- no Docker required
- fixture-driven tests default to offline mode
- live integration tests gated behind explicit env flag, e.g. `LIVE_FETCH_TESTS=1`

### Test strategy
- unit tests for pure planners, parsers, manifest merge logic, cache freshness, rate arithmetic, OLRC vintage selection, GovInfo package filtering
- fixture-backed integration tests for each source module
- concurrency integration test for same-source writers
- optional live smoke tests: one real call per source

### CI requirements
- Node 22+
- no secret required for default test job
- separate optional job may inject `API_DATA_GOV_KEY` and live-test flag
- cache `node_modules` only; do not cache `data/`

### Filesystem permissions
- `data/manifest.json` written with `0600`
- cached artifacts default to `0640`; make broader readability an explicit operator opt-in rather than the default
- lock files `0600`

---

## 5. Dependency Decisions

The goal is minimal, boring dependencies.

### 5.1 Keep existing dependencies

#### `fast-xml-parser` `^4.5.0`
- **Why:** already present, maintained, suitable for XML response parsing where needed
- **License:** MIT
- **Maintenance:** active package, broadly used
- **Use in this issue:** optional for XML payload handling if GovInfo or OLRC metadata parsing needs it

#### `yauzl` `^3.1.0`
- **Why:** already present; streaming ZIP extraction without loading full archives into memory
- **License:** MIT
- **Maintenance:** mature, stable
- **Use in this issue:** OLRC ZIP extraction

### 5.2 Additions recommended

#### `yaml` `^2.x`
- **Why this one:** mature ESM-compatible YAML parser/stringifier with strong TypeScript support; cleaner than older `js-yaml`
- **License:** ISC
- **Maintenance:** active and widely used
- **Use:** parse `legislators-*.yaml` and `committees-current.yaml`

#### `csv-parse` `^5.x`
- **Why this one:** streaming parser from the Node CSV project; safer for 500MB+ VoteView files than ad hoc splitting
- **License:** MIT
- **Maintenance:** active, proven
- **Use:** VoteView CSV parsing/index build

#### No external rate-limit library
- **Decision:** implement local token/sliding-window limiter in `src/utils/rate-limit.ts`
- **Why:** requirement is simple, auditable, and shared across exactly two sources; external libraries add indirection and state semantics we do not need

#### No HTTP client library
- **Decision:** use native `fetch`
- **Why:** required by spec and already available in Node 22+

### 5.3 Do not add
- Redis — unnecessary for a single-process local CLI
- SQLite/Postgres — out of scope for this issue
- BullMQ / queue framework — no async job system needed
- pino / winston — structured logging can remain a small internal adapter unless logging complexity materially grows later

---

## 6. Integration Points

### 6.1 Existing repository integration
- `src/index.ts` gains a new `fetch` command alongside existing commands
- `src/sources/olrc.ts` is either refactored into the new acquisition boundary or wrapped behind the new base client and manifest contracts
- tests integrate with Vitest and current fixture conventions
- `.gitignore` already excludes `data/`; keep that contract intact

### 6.2 Upstream integrations

#### OLRC
- HTML scrape of `https://uscode.house.gov/download/annualtitlefiles.shtml`
- download ZIP artifacts for the selected vintage
- extract XML entries only after ZIP checksum/file completion

#### Congress.gov
- `GET /v3/congress/current`
- `GET /v3/bill/{congress}`
- `GET /v3/bill/{congress}/{type}/{number}`
- `GET /v3/bill/{congress}/{type}/{number}/actions`
- `GET /v3/bill/{congress}/{type}/{number}/cosponsors`
- `GET /v3/member`
- `GET /v3/member/{bioguideId}`
- `GET /v3/committee/{congress}`

#### GovInfo
- `GET /collections/PLAW`
- `GET /packages/{packageId}/summary`
- `GET /packages/{packageId}/granules`

#### VoteView
- static file downloads for the three required CSVs

#### UnitedStates legislators
- raw file download from the canonical repo for the three required YAML files

### 6.3 Cross-source data flow

Cross-source dependency exists in exactly one place in this issue:
- `legislators` may consume the latest successful complete Congress global-member snapshot
- no other source depends on another source’s artifacts

That dependency is read-only and manifest-mediated:
1. Congress completes a global member snapshot and records artifact identities
2. Legislators verifies latest snapshot eligibility (`complete` and all referenced artifacts fresh)
3. If eligible, legislators builds `bioguide-crosswalk.json`
4. If not eligible, legislators records one explicit skip status and still succeeds

### 6.4 Future compatibility

This architecture intentionally preserves raw-source boundaries so downstream phases can consume:
- OLRC XML for Title markdown backfill
- Congress bill/actions/cosponsors/member detail JSON for bill/member work
- GovInfo public-law metadata for public-law history
- VoteView indexes for vote/member lookups
- legislators YAML + crosswalk for profile enrichment

---

## 7. Security Considerations

### 7.1 Auth model

There is no end-user auth surface because this is a local CLI.

Security focus is therefore:
- secret handling for `API_DATA_GOV_KEY`
- integrity of cached raw artifacts
- correctness under concurrent execution
- prevention of path traversal / unsafe filesystem writes

### 7.2 Secret handling

- `API_DATA_GOV_KEY` read only from environment
- never interpolated into persisted URLs in manifest; manifest may store a redacted URL or cache key derived without raw secret
- structured logger redacts `api_key` query parameter values
- test fixtures must never contain real keys

### 7.3 Filesystem safety

- all artifact paths are derived from validated source-controlled naming functions, not raw upstream filenames alone
- normalize and reject path segments containing `..`, path separators, or control characters
- extraction from ZIP must reject directory traversal entries and symlink entries
- manifest writes are atomic
- lock files prevent dual-writer corruption on same source scope

### 7.4 Input validation

Validate before side effects:
- CLI args
- congress values
- required env vars
- upstream content type / shape where practical
- GovInfo `packageId` parsing uses a strict deterministic rule
- OLRC title numbers strictly `1..54`

### 7.5 Network hardening

- HTTPS only
- set explicit request timeout via `AbortController`
- bounded retries with exponential backoff + jitter
- honor `Retry-After`
- do not retry `401` / `403`
- rate-limit exhaustion is terminal for interactive run rather than busy-waiting into the next hour

### 7.6 Data integrity and upstream trust policy

- compute SHA-256 for downloaded permanent artifacts and persisted indexes
- record byte count, checksum, origin host, origin URL path, fetch timestamp, and response validators (`ETag` / `Last-Modified` when present) in the manifest
- restrict all outbound fetches to an explicit host allowlist: `uscode.house.gov`, `api.congress.gov`, `api.govinfo.gov`, `voteview.com`, `github.com`, and `raw.githubusercontent.com`
- follow redirects only when the destination remains on that allowlist; otherwise fail the request
- treat checksum mismatch / truncated file as failure and do not reference artifact in success state
- rebuild corrupted API cache entry on next run or `--force`
- where an upstream source publishes checksums, signed release assets, or other authenticity metadata in the future, the client boundary must support validating that metadata before promoting an artifact to manifest success state
- until upstream-published signatures/checksums exist for every required source, the explicit trust posture for this phase is: TLS transport + host allowlist + persisted origin metadata + persisted local checksum, with that trust level visible in implementation docs and operator logs

### 7.7 Privacy / sensitive data

This issue does not process user PII beyond public legislator/member metadata. Primary sensitive datum is the API key.

### 7.8 CORS policy

Not applicable. No browser-facing HTTP service is introduced.

---

## Recommended Implementation Sequence

1. `src/utils/fetch-config.ts`, `cache.ts`, `manifest.ts`, `logger.ts`, `retry.ts`, `rate-limit.ts`, `lock.ts`
2. `src/commands/fetch.ts` with CLI validation and `--status`
3. OLRC source implementation with deterministic vintage selection
4. Congress source with global member snapshot + single-congress fetch
5. Congress bulk-history checkpoint/resume in `fetch --all`
6. GovInfo source with checkpoint/resume and page-by-page interleaving
7. VoteView source + index build
8. UnitedStates source + crosswalk eligibility rules
9. cross-source integration tests and concurrency tests

## Key Architectural Decisions

| Decision | Rationale |
|---|---|
| No database for this issue | Approved spec says none; filesystem manifest is the real production persistence model here |
| Single-process CLI monolith | Avoids premature service split and simplifies correctness under a shared local manifest |
| Serial `fetch --all` source order | Easier fail-open reporting, lock safety, and shared-rate-limit accounting |
| Congress global-member snapshot is separate | Prevents redundant global member re-download on every congress fetch |
| GovInfo and Congress share one limiter | Required by the shared `API_DATA_GOV_KEY` budget |
| Local file locks plus atomic renames | Smallest reliable way to satisfy concurrent-writer safety |
| Degraded fallback for current congress is explicit | Prevents silent incomplete historical backfill |
| Legislators crosswalk only from complete fresh Congress snapshot | Keeps cross-reference deterministic and testable |

## Architecture Acceptance Checklist

- [ ] `docs/architecture/5-architecture.md` is the canonical architecture artifact
- [ ] No new service or DB introduced beyond approved scope
- [ ] Manifest schema and checkpoint semantics are concrete enough for implementation
- [ ] CLI contract, exit codes, and fail-open behavior are explicit
- [ ] Shared-rate-limit, degraded current-congress fallback, and concurrent-writer safety are explicit
- [ ] Security handling for API key, ZIP extraction, path safety, resource ceilings, integrity provenance, and allowlist-only logging is explicit
- [ ] Any new parsing dependency lands with lockfile changes, provenance review noted in the PR, and a vulnerability scan run before merge
