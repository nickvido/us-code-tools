# Architecture — Issue #21: Historical OLRC annual release-point fetch

## Status
Approved-spec implementation architecture for a CLI-only enhancement in `us-code-tools`.

## Review Inputs
- Canonical spec: `docs/specs/21-spec.md`
- Existing implementation surfaces reviewed: `src/commands/fetch.ts`, `src/sources/olrc.ts`, `src/utils/manifest.ts`
- Reviewer feedback status: there is **no** prior `## [security-architect]` or `## [arch-reviewer]` issue comment for this stage. The latest upstream feedback was `## [spec-review]`, already resolved in the approved spec.
- Repo stack constraints: no `.dark-factory.yml` exists in this worktree, so the effective constraints are the current repository/tooling (`TypeScript`, `Node.js`, local filesystem cache, `vitest`, no database service).

---

## 1. Data Model

This issue does **not** introduce a database. The production persistence model for this repository remains:

1. local filesystem cache under `data/cache/`, and
2. the operational manifest at `data/manifest.json`.

That is the correct production design for this scope because `us-code-tools` is a single-process CLI, not a multi-user network service. Adding Postgres, Redis, or a queue would be unjustified complexity for deterministic batch downloads to disk.

### 1.1 Filesystem layout

Historical OLRC state must be isolated by vintage so retries, partial failures, and future downstream history generation remain deterministic.

```text
data/
  manifest.json
  cache/
    olrc/
      vintages/
        118-200/
          title-01/
            xml_usc01@118-200.zip
            extracted/
              usc01.xml
          ...
        117-284/
          title-01/
            xml_usc01@117-284.zip
            extracted/
              usc01.xml
          ...
```

Rules:
- Plain `fetch --source=olrc` continues to write only under the newest discovered vintage directory.
- `--vintage=<pl-number>` writes only inside `data/cache/olrc/vintages/<pl-number>/`.
- `--all-vintages` writes each vintage independently into its own subtree.
- `--list-vintages` performs **no** cache writes.
- No title ZIP or extracted XML may be written outside the selected vintage subtree for historical modes.

### 1.2 Manifest schema evolution

The current manifest stores OLRC state as:
- `sources.olrc.selected_vintage`
- `sources.olrc.titles`

That shape is insufficient for representing multiple historical vintages without collisions because the top-level `titles` map is title-number keyed and therefore can only represent one title state per title.

The architecture extends OLRC manifest state additively while preserving compatibility for existing latest-mode consumers.

### 1.3 Canonical OLRC manifest contract

```json
{
  "version": 1,
  "updated_at": "2026-03-29T23:00:00.000Z",
  "sources": {
    "olrc": {
      "selected_vintage": "118-200",
      "last_success_at": "2026-03-29T23:00:00.000Z",
      "last_failure": null,
      "titles": {
        "1": {
          "title": 1,
          "vintage": "118-200",
          "status": "downloaded",
          "zip_path": "data/cache/olrc/vintages/118-200/title-01/xml_usc01@118-200.zip",
          "extraction_path": "data/cache/olrc/vintages/118-200/title-01/extracted",
          "byte_count": 12345,
          "fetched_at": "2026-03-29T23:00:00.000Z",
          "extracted_xml_artifacts": [
            {
              "path": "data/cache/olrc/vintages/118-200/title-01/extracted/usc01.xml",
              "byte_count": 45678,
              "checksum_sha256": "<sha256>",
              "fetched_at": "2026-03-29T23:00:00.000Z"
            }
          ]
        }
      },
      "vintages": {
        "118-200": {
          "vintage": "118-200",
          "listing_url": "https://uscode.house.gov/download/download.shtml",
          "discovered_at": "2026-03-29T22:59:30.000Z",
          "completed_at": "2026-03-29T23:00:00.000Z",
          "status": "complete",
          "missing_titles": [],
          "titles_downloaded": 53,
          "titles": {
            "1": {
              "title": 1,
              "vintage": "118-200",
              "status": "downloaded",
              "zip_path": "data/cache/olrc/vintages/118-200/title-01/xml_usc01@118-200.zip",
              "extraction_path": "data/cache/olrc/vintages/118-200/title-01/extracted",
              "byte_count": 12345,
              "fetched_at": "2026-03-29T23:00:00.000Z",
              "extracted_xml_artifacts": []
            },
            "53": {
              "title": 53,
              "vintage": "118-200",
              "status": "reserved_empty",
              "skipped_at": "2026-03-29T23:00:00.000Z",
              "source_url": "https://...",
              "classification_reason": "empty_zip"
            }
          }
        },
        "117-284": {
          "vintage": "117-284",
          "listing_url": "https://uscode.house.gov/download/releasepoints/",
          "discovered_at": "2026-03-29T22:58:00.000Z",
          "completed_at": null,
          "status": "failed",
          "missing_titles": [12],
          "titles_downloaded": 11,
          "titles": {},
          "failure": {
            "code": "upstream_request_failed",
            "message": "timeout fetching title 12"
          }
        }
      },
      "available_vintages": {
        "values": ["118-200", "117-284", "117-163"],
        "discovered_at": "2026-03-29T22:59:30.000Z",
        "listing_url": "https://uscode.house.gov/download/download.shtml"
      }
    }
  },
  "runs": []
}
```

### 1.4 TypeScript model changes

Add the following OLRC-specific types in `src/utils/manifest.ts`.

```ts
export interface OlrcVintageState extends SourceStatusSummary {
  vintage: string;
  listing_url: string;
  discovered_at: string;
  completed_at: string | null;
  status: 'complete' | 'partial' | 'failed';
  missing_titles: number[];
  titles_downloaded: number;
  titles: Record<string, OlrcTitleState>;
}

export interface OlrcAvailableVintagesState {
  values: string[];
  discovered_at: string;
  listing_url: string;
}

export interface OlrcManifestState extends SourceStatusSummary {
  selected_vintage: string | null;
  titles: Record<string, OlrcTitleState>; // compatibility mirror for selected_vintage only
  vintages: Record<string, OlrcVintageState>;
  available_vintages: OlrcAvailableVintagesState | null;
}
```

Design rules:
- `sources.olrc.titles` remains the compatibility mirror for the current `selected_vintage` only.
- `sources.olrc.vintages[<pl-number>].titles` is the canonical per-vintage state.
- `sources.olrc.available_vintages` is informational discovery metadata only; `--list-vintages` must not update it because the spec forbids manifest mutation for listing mode.
- `selected_vintage` remains the compatibility field that latest-mode code and downstream readers can continue to consume.

### 1.5 Normalization and backward compatibility

`readManifest()` must continue to load manifests written before this feature.

Required normalization behavior:
1. If `sources.olrc.vintages` is missing or invalid, normalize to `{}`.
2. If `sources.olrc.available_vintages` is missing or invalid, normalize to `null`.
3. Preserve the legacy `sources.olrc.titles` map exactly as today.
4. Do **not** require an on-disk migration step.
5. When writing a successful latest-mode OLRC fetch, populate both:
   - `sources.olrc.selected_vintage`
   - `sources.olrc.titles`
   - `sources.olrc.vintages[selected_vintage]`

### 1.6 File-path persistence rules

Persist manifest paths relative to `data/` where possible rather than absolute workstation paths.

Required behavior:
- `zip_path`, `extraction_path`, and `extracted_xml_artifacts[].path` should remain rooted under `data/cache/...`.
- No cookie material, HTTP headers, or session bootstrap artifacts may appear anywhere in manifest JSON.
- Per-title records are immutable snapshots of the last successful fetch for that vintage/title pair.

### 1.7 “Migration files” equivalent for a CLI repository

This repository has no SQL migrations. The equivalent migration artifact is the additive manifest-schema evolution implemented in code.

Implementation sequence:
1. Extend TypeScript interfaces.
2. Extend normalization helpers to backfill missing `vintages` and `available_vintages` to empty state.
3. Update OLRC write paths so historical fetches populate the new per-vintage map.
4. Keep `version: 1`; no manifest version bump is needed because normalization can safely absorb old manifests.

### 1.8 Seed data for dev/test

No production seed data is required. Test fixtures should provide:
- one listing fixture with at least 3 valid vintages,
- one fixture containing duplicate links for dedupe tests,
- one fixture where a middle vintage partially fails,
- one fixture where the requested vintage is absent,
- one manifest fixture using the pre-feature schema to verify compatibility normalization.

### 1.9 Index/lookup rationale

There are no database indexes. Equivalent lookup structures are:
- `Record<string, OlrcVintageState>` keyed by vintage for O(1) manifest access,
- `Record<string, OlrcTitleState>` keyed by title number for O(1) per-title status lookup,
- `string[] available_vintages` stored in descending order to avoid repeated sorting when reporting results.

---

## 2. API Contract

This feature adds **no HTTP server endpoints**. The public contract is the CLI JSON I/O contract.

### 2.1 Command surface

```bash
us-code-tools fetch --source=olrc
us-code-tools fetch --source=olrc --list-vintages
us-code-tools fetch --source=olrc --vintage=<pl-number>
us-code-tools fetch --source=olrc --all-vintages
```

### 2.2 CLI argument contract

Add these fields to `FetchArgs` in `src/commands/fetch.ts`:

```ts
interface FetchArgs {
  status: boolean;
  force: boolean;
  all: boolean;
  source: SourceName | null;
  congress: number | null;
  listVintages: boolean;
  vintage: string | null;
  allVintages: boolean;
}
```

Validation rules are normative and must run before any OLRC discovery begins.

#### Valid selectors
- `--source=olrc`
- `--source=olrc --list-vintages`
- `--source=olrc --vintage=<pl-number>`
- `--source=olrc --all-vintages`
- `--source=olrc --force`
- plain latest mode with no OLRC historical selectors remains valid

#### Invalid combinations
- any OLRC historical selector without `--source=olrc`
- `--list-vintages` with `--vintage`, `--all-vintages`, `--all`, `--status`, `--congress`, or `--force`
- `--all-vintages` with `--vintage`, `--all`, `--status`, or `--congress`
- repeated `--vintage=<pl-number>` even when values are identical
- malformed `--vintage` values not matching `/^\d+-\d+$/`

### 2.3 CLI response schemas

#### 2.3.1 `--list-vintages` success

```json
{
  "source": "olrc",
  "ok": true,
  "available_vintages": ["118-200", "117-284", "117-163"],
  "latest_vintage": "118-200"
}
```

#### 2.3.2 `--list-vintages` failure

```json
{
  "source": "olrc",
  "ok": false,
  "error": {
    "code": "upstream_request_failed",
    "message": "OLRC listing did not expose any releasepoint title ZIP links"
  }
}
```

#### 2.3.3 single-vintage success

```json
{
  "source": "olrc",
  "ok": true,
  "requested_scope": { "titles": "1..54" },
  "selected_vintage": "113-1",
  "counts": { "titles_downloaded": 53 },
  "missing_titles": [],
  "reserved_empty_titles": [
    { "title": 53, "status": "reserved_empty", "classification_reason": "empty_zip" }
  ]
}
```

#### 2.3.4 single-vintage unknown vintage

```json
{
  "source": "olrc",
  "ok": false,
  "requested_scope": { "titles": "1..54" },
  "selected_vintage": "999-999",
  "error": {
    "code": "unknown_vintage",
    "message": "Requested OLRC vintage 999-999 was not present in the releasepoint listing"
  }
}
```

#### 2.3.5 `--all-vintages` aggregate result

```json
{
  "source": "olrc",
  "ok": false,
  "mode": "all_vintages",
  "available_vintages": ["118-200", "117-284", "117-163"],
  "results": [
    {
      "vintage": "118-200",
      "ok": true,
      "counts": { "titles_downloaded": 53 },
      "missing_titles": []
    },
    {
      "vintage": "117-284",
      "ok": false,
      "error": {
        "code": "upstream_request_failed",
        "message": "timeout fetching title 12"
      }
    },
    {
      "vintage": "117-163",
      "ok": true,
      "counts": { "titles_downloaded": 53 },
      "missing_titles": []
    }
  ]
}
```

#### 2.3.6 invalid argument response

Written to **stderr** with exit code `2`.

```json
{
  "error": {
    "code": "invalid_arguments",
    "message": "--list-vintages cannot be combined with --force"
  }
}
```

### 2.4 Exit-code contract

- `0`: requested operation succeeded
- `1`: runtime/upstream failure or unknown requested vintage
- `2`: argument validation failure

### 2.5 Auth requirements

No user authentication exists because this is a local CLI. The only external access control is OLRC’s cookie/bootstrap session, which is transport/session state rather than user auth.

### 2.6 Rate limiting and headers

There is no inbound rate limit because there is no server API. Outbound etiquette requirements are:
- one listing discovery request per invocation for `--list-vintages` and `--all-vintages`,
- reuse the in-memory cookie/bootstrap context for all downstream OLRC requests in the same invocation,
- keep existing retry policy unless implementation evidence requires adjustment.

### 2.7 Pagination strategy

Not applicable. OLRC listing discovery is page fetch + HTML parse, not paginated API traversal.

---

## 3. Service Boundaries

This feature remains a **single-process monolith** with clearer internal module boundaries. No new service split is warranted.

### 3.1 Module ownership

#### `src/commands/fetch.ts`
Owns:
- CLI parsing
- selector validation
- exit-code mapping
- stdout/stderr JSON routing
- dispatch into OLRC modes

Must not own:
- HTML parsing
- URL discovery
- manifest mutation logic
- ZIP extraction logic

#### `src/sources/olrc.ts`
Owns:
- releasepoint listing fetch
- listing fallback behavior (`current` vs `legacy`)
- vintage extraction/dedup/sort
- requested vintage lookup
- download and extraction orchestration
- per-vintage result aggregation
- cookie bootstrap reuse

Must not own:
- generic CLI parsing
- manifest normalization implementation details outside OLRC-specific write intent

#### `src/utils/manifest.ts`
Owns:
- manifest type definitions
- create/read/write/normalize behavior
- backward compatibility with pre-feature manifests

Must not own:
- OLRC network I/O
- vintage sorting rules
- CLI validation

### 3.2 New internal seams

To keep implementation testable, split the current OLRC source flow into explicit pure and impure seams.

#### Pure functions
Add or extract functions similar to:

```ts
parseOlrcHistoricalSelectors(args: FetchArgs): OlrcMode
extractVintageFromReleasepointUrl(url: string): string | null
collectAvailableVintages(links: Iterable<ReleasepointLink>): string[]
selectRequestedVintage(available: string[], requested: string): { ok: true } | { ok: false }
reduceAllVintageExitCode(results: OlrcPerVintageResult[]): 0 | 1
buildVintageManifestState(input: ...): OlrcVintageState
```

These functions should be unit-tested without filesystem or network side effects.

#### Impure functions
The impure orchestration should be limited to:
- `fetchPreferredOlrcListing()`
- `getOrCreateZipPath()`
- `extractXmlEntriesFromZip()`
- `writeManifest()`
- directory creation and cleanup

### 3.3 Dependency direction

Required dependency flow:

```text
commands/fetch.ts
  -> sources/olrc.ts
    -> utils/manifest.ts
    -> utils/cache.ts
    -> utils/logger.ts
    -> domain/normalize.ts
```

Prohibited:
- `manifest.ts` importing OLRC source logic
- CLI parser depending on ZIP extraction helpers
- circular imports between command and source layers

### 3.4 Communication pattern

All communication is direct in-process function invocation. No queue, worker, event bus, or child process is needed.

---

## 4. Infrastructure Requirements

## 4.1 Production/runtime requirements

Because this is a local CLI, “production” means the operator workstation or CI runner executing `us-code-tools`.

### Runtime
- Node.js 22+
- writable local filesystem under `data/`
- outbound HTTPS access to:
  - `https://uscode.house.gov/`
  - `https://uscode.house.gov/download/download.shtml`
  - `https://uscode.house.gov/download/annualtitlefiles.shtml`
  - `https://uscode.house.gov/download/releasepoints/`

### Storage
- historical OLRC cache footprint expected at ~5–6 GB for a full backfill
- operators need enough disk for ZIPs plus extracted XML
- the CLI must not require cloud object storage, CDN, or external cache service

### Monitoring and logging
Existing local logging is sufficient if it records:
- listing URL selected (`current` or `legacy`)
- requested mode (`latest`, `list`, `single_vintage`, `all_vintages`)
- selected vintage per fetch
- per-vintage failure summary

Logs must not record:
- bootstrap cookies
- raw `Cookie` headers
- full HTML listing payloads unless explicitly debug-gated and scrubbed

### Alerting
No persistent alerting system is required for this repository. CI failure or non-zero process exit is the alert mechanism.

## 4.2 Dev/testing requirements

### Local development
- existing Node/npm workflow remains sufficient
- no Docker Compose required
- no database service required

### Test strategy
Use fixture-driven tests at three layers:
1. **parser tests** for invalid selector combinations and duplicate `--vintage`
2. **OLRC source tests** for discovery, requested-vintage selection, per-vintage isolation, aggregate result reduction
3. **manifest tests** for backward-compatible normalization and multi-vintage persistence

### Mocking policy
Only third-party OLRC HTTP responses may be mocked in tests. Internal manifest/cache behavior should use the real filesystem in temporary directories.

### CI requirements
CI must run:
- `npm test`
- `npm run build`

Optional but recommended:
- a focused fixture suite for historical OLRC modes separated from live-fetch tests

---

## 5. Dependency Decisions

The correct architecture is to implement this with **no new runtime dependency unless implementation proves the current approach cannot parse the listing deterministically**.

### 5.1 Keep existing dependencies

#### `yauzl` `^3.1.0`
- Purpose: ZIP inspection and extraction already used by OLRC fetch
- Why keep it: already integrated, sufficient for title ZIP processing
- License: MIT-compatible
- Maintenance: established, boring dependency; appropriate for this scope

#### `fast-xml-parser` `^4.5.0`
- Purpose: downstream XML work already present in repo
- Why keep it: no new XML parser needed for this issue
- License: MIT-compatible
- Maintenance: actively used ecosystem package

#### `gray-matter` `^4.0.3`
- Purpose: unrelated existing repo usage
- Impact on this issue: none
- License: MIT-compatible

### 5.2 No new HTML parsing dependency by default

Preferred implementation: continue extracting releasepoint links using the existing OLRC HTML parsing approach or a small internal parser built on stable regex/URL normalization if current logic is already adequate.

Rejected by default:
- `cheerio`
- `jsdom`

Rationale:
- adds runtime weight for a narrow link-extraction problem
- increases supply-chain surface
- not justified unless OLRC markup variability makes the existing parser unreliable

### 5.3 Optional dependency gate

If implementation evidence shows deterministic parsing cannot be maintained with existing code, the only acceptable new parser dependency is:

#### `cheerio` `^1.x` (conditional)
- Why this one: mature, small compared with `jsdom`, well understood for server-side HTML scraping
- Why not `jsdom`: excessive browser emulation for simple anchor extraction
- License: MIT-compatible
- Constraint: add only with a documented failing fixture proving the need

### 5.4 New code, not new packages

Most of the work belongs in:
- new interfaces/types
- new pure helper functions
- expanded tests

This is the lowest-risk path.

---

## 6. Integration Points

### 6.1 Existing source integration

#### `src/commands/fetch.ts`
Integration changes:
- extend `FetchArgs`
- add OLRC-only historical selector validation
- dispatch four OLRC modes:
  - latest (existing)
  - list vintages
  - single requested vintage
  - all vintages

#### `src/sources/olrc.ts`
Integration changes:
- preserve `fetchOlrcSource({ force })` as latest-mode entrypoint
- add internal or exported mode-aware entrypoints such as:

```ts
listOlrcVintages(): Promise<OlrcListVintagesResult>
fetchSpecificOlrcVintage(input: { vintage: string; force?: boolean }): Promise<OlrcFetchResult>
fetchAllOlrcVintages(input: { force?: boolean }): Promise<OlrcAllVintagesResult>
```

- reuse the same discovery codepath for all modes so ordering and dedupe stay consistent

#### `src/utils/manifest.ts`
Integration changes:
- additive OLRC manifest fields
- normalization of pre-feature manifests
- helper to mirror canonical selected vintage into legacy `titles`

### 6.2 External integration: OLRC

The feature continues to integrate only with OLRC endpoints already in scope.

Required flow:
1. bootstrap session against `OLRC_HOME_URL` as today
2. fetch preferred listing URL
3. parse releasepoint links into `(vintage, title, url)` tuples
4. derive descending unique `available_vintages`
5. execute the mode-specific action

### 6.3 Data flow by mode

#### Plain latest mode
```text
CLI -> discover available vintages -> newest vintage -> fetch titles -> write selected_vintage mirror + canonical vintage state
```

#### `--list-vintages`
```text
CLI -> discover available vintages -> print JSON -> exit
```

#### `--vintage=<pl-number>`
```text
CLI -> validate requested format -> discover available vintages -> verify requested vintage exists -> fetch titles for that vintage only -> write manifest only for that vintage -> print result
```

#### `--all-vintages`
```text
CLI -> discover available vintages once -> iterate descending -> fetch each vintage independently -> persist each vintage outcome -> print aggregate result
```

### 6.4 Failure propagation

- parser validation failures stop before any OLRC discovery or disk mutation
- listing discovery failures stop mode execution immediately except latest-mode fallback behavior already present in OLRC logic
- per-vintage failures under `--all-vintages` are recorded and do not block later vintages
- successful earlier vintages remain persisted after later failures

---

## 7. Security Considerations

### 7.1 Trust boundary

Untrusted inputs are:
- CLI arguments
- OLRC HTML listing pages
- OLRC ZIP payloads
- filesystem state already on disk

Everything from OLRC must be treated as untrusted remote content.

### 7.2 Input validation

Required validations before side effects:
- `--vintage` format matches `/^\d+-\d+$/`
- repeated `--vintage` is rejected
- invalid selector combinations are rejected
- requested vintage must be selected from discovered `available_vintages`, never interpolated directly into fetch logic without lookup

### 7.3 Path safety

All output paths must be derived from validated title numbers and validated vintage identifiers.

Required constraints:
- vintage identifiers persisted to disk must match `/^\d+-\d+$/`
- title directories must be generated from numeric title input only
- ZIP extraction must continue to reject path traversal and oversized entries as current OLRC logic already attempts to do
- no user-controlled relative path segments may be joined into output paths

### 7.4 Cookie handling

Issue #8’s cookie bootstrap remains in force.

Requirements:
- cookies live in memory only for the lifetime of the process
- do not serialize cookies into manifest, cache metadata, logs, stdout JSON, or stderr JSON
- reuse the same in-memory request context during one invocation to avoid unnecessary session churn

### 7.5 Partial-write safety

Historical backfill increases the chance of interrupted runs.

Mitigations:
- write manifest atomically using the existing temp-file + rename strategy
- only mark a vintage `status: "complete"` after its full title loop succeeds
- on per-title reserved-empty handling, delete any transient title directory before writing reserved-empty state
- on failure under `--all-vintages`, keep already completed vintage directories untouched

### 7.6 Resource exhaustion

Historical fetches are large.

Controls:
- preserve current XML entry byte ceilings and total extracted byte ceilings
- avoid loading more than one title ZIP’s extracted contents into durable memory at once
- `--list-vintages` must never trigger ZIP download or extraction work

### 7.7 Logging and disclosure minimization

Safe to log:
- selected listing URL
- selected vintage
- title number
- high-level error code

Unsafe to log:
- cookies
- response headers containing session material
- full downloaded XML payloads
- manifest paths outside the repo root if absolute-path logging can be avoided

### 7.8 Concurrency posture

Concurrent OLRC invocations against the same `data/` directory are unsafe today because cache directories and manifest writes can race.

Current architecture decision:
- **do not add cross-process locking in this issue**
- explicitly document that concurrent OLRC historical fetches against the same data directory are unsupported
- tests should validate correctness for single-process execution only

That keeps scope aligned with the approved spec while making the operational limitation explicit.

---

## Implementation Plan

1. Extend `FetchArgs` and parser validation in `src/commands/fetch.ts`.
2. Add a mode-dispatch layer for OLRC historical operations.
3. Extract reusable vintage discovery that returns descending unique `available_vintages` plus per-vintage title maps.
4. Add single-vintage fetch entrypoint using requested-vintage lookup.
5. Add all-vintages orchestration that persists each vintage independently and returns aggregate JSON.
6. Extend manifest interfaces and normalization for `sources.olrc.vintages` and `available_vintages`.
7. Mirror latest-mode state into legacy `selected_vintage` + `titles` fields.
8. Add fixture-driven tests for parser validation, listing mode, unknown vintage, all-vintages partial failure, and old-manifest compatibility.

## Acceptance Mapping

- `--list-vintages` support: covered by Sections 2.3.1, 4.2, 6.3
- `--vintage` support: covered by Sections 1.3, 2.3.3, 6.3
- `--all-vintages` support: covered by Sections 2.3.5, 6.3, 7.5
- per-vintage cache directories: covered by Section 1.1
- manifest vintage metadata: covered by Sections 1.3–1.5
- unchanged latest behavior: covered by Sections 1.4, 6.3
- duplicate `--vintage` invalidation: covered by Sections 2.2 and 7.2
