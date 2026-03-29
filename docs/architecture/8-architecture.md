# Issue #8 Architecture — OLRC cookie bootstrap + current uscDoc compatibility

## Status
Approved spec input: `docs/specs/8-spec.md`

## 1. Data Model

### 1.1 Architectural decision
This issue remains **filesystem-first**. No new database is introduced.

Rationale:
- `us-code-tools` is a single-user/local CLI, not a multi-tenant service.
- Existing persistence already lives in `data/cache/**` and `data/manifest.json`.
- The issue scope is transport compatibility, cache-state classification, and parser compatibility; adding a database would increase operational complexity without solving the underlying defects.
- The project’s own constraints already define manifest-backed caching as the persistence model for fetch flows.

Per the project’s CLI nature, the concrete persisted model for this issue is the manifest JSON contract plus on-disk cache layout.

### 1.2 Persisted manifest contract changes
File: `data/manifest.json`
Writer/owner: `src/utils/manifest.ts`
Primary OLRC writer: `src/sources/olrc.ts`

Current OLRC manifest shape is too weakly typed for Title 53 reserved-empty classification. This issue should harden it to a concrete structure.

#### Canonical TypeScript contract
```ts
export interface DownloadedXmlArtifact {
  path: string;
  byte_count: number;
  checksum_sha256: string;
  fetched_at: string;
}

export interface OlrcTitleSuccessState {
  title: number;
  vintage: string;
  status: 'downloaded';
  zip_path: string;
  extraction_path: string;
  byte_count: number;
  fetched_at: string;
  extracted_xml_artifacts: DownloadedXmlArtifact[];
}

export interface OlrcTitleReservedEmptyState {
  title: number;
  vintage: string;
  status: 'reserved_empty';
  skipped_at: string;
  source_url: string;
  classification_reason: 'html_payload' | 'not_zip' | 'empty_zip' | 'no_xml_entries';
}

export type OlrcTitleState = OlrcTitleSuccessState | OlrcTitleReservedEmptyState;

export interface OlrcManifestState extends SourceStatusSummary {
  selected_vintage: string | null;
  titles: Record<string, OlrcTitleState>;
}
```

### 1.3 Manifest JSON example
```json
{
  "sources": {
    "olrc": {
      "selected_vintage": "119-73",
      "last_success_at": "2026-03-28T21:00:00.000Z",
      "last_failure": null,
      "titles": {
        "1": {
          "title": 1,
          "vintage": "119-73",
          "status": "downloaded",
          "zip_path": "data/cache/olrc/vintages/119-73/title-01/xml_usc01@119-73.zip",
          "extraction_path": "data/cache/olrc/vintages/119-73/title-01/extracted",
          "byte_count": 345678,
          "fetched_at": "2026-03-28T21:00:00.000Z",
          "extracted_xml_artifacts": [
            {
              "path": "data/cache/olrc/vintages/119-73/title-01/extracted/usc01.xml",
              "byte_count": 456789,
              "checksum_sha256": "...",
              "fetched_at": "2026-03-28T21:00:00.000Z"
            }
          ]
        },
        "53": {
          "title": 53,
          "vintage": "119-73",
          "status": "reserved_empty",
          "skipped_at": "2026-03-28T21:00:05.000Z",
          "source_url": "https://uscode.house.gov/download/releasepoints/us/pl/119/73/xml_usc53@119-73.zip",
          "classification_reason": "html_payload"
        }
      }
    }
  }
}
```

### 1.4 On-disk cache layout
No layout rewrite is required. Continue using the existing cache contract.

```text
data/
  cache/
    olrc/
      vintages/
        119-73/
          title-01/
            xml_usc01@119-73.zip
            extracted/
              usc01.xml
          ...
          title-53/
            # intentionally absent when reserved_empty
  manifest.json
```

Rules:
- Successful numeric titles write ZIP + extracted XML.
- Reserved-empty Title 53 writes **manifest state only**.
- No unreadable HTML body, no invalid ZIP, and no placeholder file is persisted for Title 53.
- Session cookies are never persisted.

### 1.5 File write/atomicity requirements
No migration files are needed because there is no SQL schema in scope. Persistence changes are additive inside manifest normalization.

Required write behavior:
- `manifest.json` remains atomic temp-file + rename via `writeManifest()`.
- ZIP writes remain temp-file + rename.
- Extracted XML writes remain explicit file writes under the per-title extraction directory.
- On failure after partial success, already-valid cached titles remain intact.

### 1.6 Size-limit decision for Title 42
Current limit: `MAX_XML_ENTRY_BYTES = 64 * 1024 * 1024`

Architecture decision:
- Increase the per-entry cap to **128 MiB**.
- Keep `MAX_TOTAL_XML_BYTES` bounded.
- Do **not** introduce streaming XML parsing in this issue.

Rationale:
- The spec only requires current Title 42 compatibility.
- The existing code already reads extracted XML into memory for parser input, so a streaming extractor/parser split would be a broader refactor than this issue requires.
- 128 MiB covers the known OLRC Title 42 case with modest headroom while preserving an explicit extraction safety ceiling.

### 1.7 Indexes / lookup strategy
There are no database indexes in this issue.

Equivalent lookup constraints in the manifest/cache model:
- `titles[titleNumber]` is the constant-time lookup structure for per-title state.
- `selected_vintage` remains a top-level OLRC field to avoid scanning title entries for the active vintage.
- `classification_reason` is a fixed enum so tests and operators can distinguish `reserved_empty` from generic failure without log parsing.

### 1.8 Dev/test seed artifacts
Tests should add committed fixtures/mocks for:
- current `download.shtml` HTML with multiple vintages
- homepage response containing `Set-Cookie`
- Title 53 HTML/non-ZIP payload
- current `uscDoc` Title 1 fixture with 53 sections
- large-entry Title 42 ZIP fixture
- existing legacy `<uslm>` fixtures remain unchanged

## 2. Interface Contract

This repository exposes a CLI, not an HTTP service. Therefore **no OpenAPI surface exists for this issue**.

The external contract to preserve is the CLI contract plus the internal manifest contract.

### 2.1 CLI contract in scope

#### Fetch command
```text
us-code-tools fetch --source=olrc [--force]
us-code-tools fetch --all [--force]
```

Behavioral requirements:
- `fetch --source=olrc` must bootstrap an OLRC session from `https://uscode.house.gov/`.
- It must scrape `https://uscode.house.gov/download/download.shtml`.
- It must choose the newest vintage using `compareVintageDescending()`.
- It must download numeric titles 1..54.
- It must classify Title 53 reserved-empty as non-fatal.
- It must return non-zero only for transport/classification failures outside the allowed Title 53 skip case.

#### Transform command
```text
us-code-tools transform --title <1..54> --output <dir>
```

Behavioral requirements:
- Integer-only title validation remains unchanged.
- Given current OLRC XML under `uscDoc > main > title`, transform must succeed for Title 1.
- Titles `1..52` and `54` succeed when valid cache exists.
- Title 53 may fail transform with an explicit reserved-empty/non-zip diagnostic because no XML exists.

### 2.2 Internal functional contract updates

#### `fetchWithRetry(url, ...)`
Required behavior:
1. Before the first OLRC listing or title request, perform a bootstrap GET to `https://uscode.house.gov/`.
2. Capture response `Set-Cookie` headers into an in-memory cookie jar for the active fetch operation.
3. Attach the resulting `Cookie` header to:
   - `download.shtml` requests
   - releasepoint ZIP requests
   - retries issued during the same operation
4. Never write cookie values into manifest, logs, cache metadata, or extracted artifacts.

#### `fetchOlrcVintagePlan()`
Required behavior:
- Read only `download.shtml`.
- Parse links matching:
  - `releasepoints/us/pl/{congress}/{law}/xml_usc{NN}@{congress}-{law}.zip`
- Accept both relative and absolute URLs.
- Ignore:
  - appendix-title ZIPs (`5a`, `11a`, etc.)
  - malformed links
  - duplicates after first valid numeric title URL per vintage/title pair

#### `extractXmlEntriesFromZip()`
Required behavior:
- Continue rejecting unsafe paths, non-regular entries, duplicate normalized destinations, and invalid ZIPs.
- Accept the larger Title 42 fixture without size-limit failure.
- Keep lexical ordering of extracted XML entries.

#### `parseUslmToIr()`
Required behavior:
- Accept both:
  - `document.uslm.title`
  - `document.uscDoc.main.title`
- Namespace handling must be internal to parser config or parser-side normalization.
- Callers continue passing raw XML strings.

### 2.3 Error contract
Reserved-empty Title 53 is a **classified skip state**, not a generic success blob and not a hard failure.

Required result classes:
- `ok: true` with `titles[53].status = 'reserved_empty'` when only Title 53 is non-zip/empty
- `ok: false` when:
  - homepage bootstrap fails
  - listing fetch fails
  - non-53 title fetch fails
  - retry budget is exhausted
  - ZIP is unreadable for non-53 titles

Error messages for title-specific failures must include:
- title number
- failing URL
- root reason

## 3. Service Boundaries

### 3.1 Monolith/module decision
Remain a single-process CLI package. No service split.

Rationale:
- OLRC fetch + parse + write is synchronous operator-invoked work.
- No independent scaling or deployment boundary exists.
- Adding workers or services would not reduce the complexity at the actual failure seams.

### 3.2 Module ownership

#### `src/sources/olrc.ts`
Owns:
- OLRC homepage bootstrap
- in-memory cookie jar lifecycle
- listing-page retrieval and releasepoint parsing
- title ZIP download/retry behavior
- ZIP readability validation
- XML extraction limits
- Title 53 reserved-empty classification
- manifest updates for `sources.olrc.*`

#### `src/utils/manifest.ts`
Owns:
- OLRC manifest state normalization
- backward-compatible reads of existing manifest JSON
- canonical write shape for new `OlrcTitleState`

#### `src/transforms/uslm-to-ir.ts`
Owns:
- raw XML parsing
- namespace tolerance
- root discovery (`uscDoc` vs legacy `uslm`)
- conversion to existing `TitleIR`

#### `src/index.ts`
Owns:
- CLI validation for `transform`
- CLI exit code behavior
- no appendix-title expansion in this issue

### 3.3 Dependency direction
```text
src/index.ts
  -> src/sources/olrc.ts
  -> src/transforms/uslm-to-ir.ts
  -> src/transforms/write-output.ts

src/sources/olrc.ts
  -> src/domain/model.ts
  -> src/domain/normalize.ts
  -> src/utils/manifest.ts
  -> src/utils/cache.ts
  -> src/utils/logger.ts

src/transforms/uslm-to-ir.ts
  -> src/domain/model.ts
  -> src/domain/normalize.ts
```

Rules:
- Parser code does not import fetch/cache modules.
- Manifest normalization does not import network/parsing modules.
- Title 53 classification is performed in the OLRC source layer, not in CLI code and not in parser code.

### 3.4 Communication pattern
Direct in-process function calls only. No queue, no event bus, no background daemon.

## 4. Infrastructure Requirements

### 4.1 Production/runtime requirements
For this CLI, “production” means a local or CI runtime capable of invoking the tool.

Required runtime:
- Node.js 22+
- Writable filesystem for `data/`
- HTTPS egress to:
  - `https://uscode.house.gov/`
  - `https://uscode.house.gov/download/download.shtml`
  - selected OLRC releasepoint ZIP URLs

No additional infrastructure required:
- no database
- no queue
- no Redis/cache server
- no object storage
- no DNS/cert management owned by this project

### 4.2 Observability requirements
Existing logging remains sufficient if extended carefully.

Required observability behavior:
- Continue structured network logs via `logNetworkEvent()`.
- Do not log session-cookie values.
- When a title request fails, log/return title number and URL.
- Manifest state remains the machine-readable operational record for selected vintage and per-title outcomes.

### 4.3 Dev/test requirements
- `npm install`
- `npm run build`
- `npm test`

Fixture-driven tests must run without live outbound access.

Recommended test matrix:
- unit: listing parsing + cookie bootstrap + reserved-empty classification
- unit: `uscDoc` and legacy `uslm` parser compatibility
- integration: built CLI transform using fixture-backed cache

### 4.4 CI requirements
CI must:
1. build TypeScript
2. run full Vitest suite
3. not depend on live `uscode.house.gov`

Optional but recommended:
- add a focused integration test for `transform --title 1`
- add fixture-backed multi-title transform coverage including Title 53 diagnostic behavior

## 5. Dependency Decisions

### 5.1 Native `fetch` (existing)
- Version: Node.js built-in runtime fetch (Node 22+)
- Why: already in use; sufficient for homepage bootstrap, listing fetch, and ZIP download
- Alternatives rejected: `axios`, `got`, `node-fetch`
- License: Node runtime bundled
- Maintenance: tied to Node LTS/current maintenance
- Decision: keep native fetch and add thin in-memory cookie handling in `src/sources/olrc.ts`

### 5.2 `fast-xml-parser` (existing)
- Version: `^4.5.0`
- Why: already integrated; can support namespace-tolerant parsing without replacing the parser stack
- Alternatives rejected: `xml2js`, SAX-based parser for this issue
- License: MIT
- Maintenance: active and widely used
- Decision: keep and update parser configuration/root-discovery logic rather than replacing the XML stack

### 5.3 `yauzl` (existing)
- Version: `^3.1.0`
- Why: already used for safe ZIP inspection/extraction and adequate for current bounded extraction model
- Alternatives rejected: `adm-zip` and larger ZIP abstraction rewrites
- License: MIT
- Maintenance: stable, mature
- Decision: keep; increase safe extraction cap instead of rewriting ZIP handling

### 5.4 No new cookie-jar dependency
Decision: **do not add** `tough-cookie`, `fetch-cookie`, or similar.

Rationale:
- OLRC requires only a short-lived session cookie for one process-local fetch operation.
- A minimal in-memory jar is easy to reason about and simpler to verify as non-persistent.
- Avoids unnecessary dependency surface for a single-site compatibility fix.

## 6. Integration Points

### 6.1 Existing repo integrations
- `fetch --source=olrc` writes to existing cache/manifest layout.
- `transform` consumes OLRC ZIPs via `getTitleZipPath()` and `extractXmlEntriesFromZip()`.
- `write-output.ts` remains unchanged; it consumes `TitleIR` and parse errors.

### 6.2 Third-party integration
Only third-party dependency in scope is OLRC:
- homepage bootstrap: `https://uscode.house.gov/`
- listing page: `https://uscode.house.gov/download/download.shtml`
- selected releasepoint ZIP URLs under `/download/releasepoints/us/pl/...`

### 6.3 Data flow
```text
fetch --source=olrc
  -> GET https://uscode.house.gov/
  -> capture Set-Cookie in memory
  -> GET download.shtml with Cookie header
  -> parse newest numeric-title vintage
  -> GET per-title ZIP with Cookie header
  -> validate ZIP
  -> extract XML entries
  -> write ZIP + extracted XML
  -> write manifest selected_vintage + per-title state

transform --title N
  -> locate cached ZIP
  -> extract XML
  -> parse raw XML (uscDoc or uslm)
  -> merge sections
  -> write markdown output
```

### 6.4 Backward compatibility points
- Legacy `document.uslm.title` parsing must continue working.
- Existing integer-only `--title` contract remains unchanged.
- Existing manifest readers must tolerate older OLRC title entries and normalize them forward.

## 7. Security Considerations

### 7.1 Session-cookie handling
Security requirement:
- Cookies are memory-only and scoped to the active OLRC fetch operation.

Forbidden sinks:
- `manifest.json`
- stderr/network logs
- cache metadata files
- extracted XML
- generated markdown

Implementation guidance:
- Create the cookie jar inside the OLRC fetch module/function scope.
- Build the outbound `Cookie` header from parsed `Set-Cookie` values.
- Discard jar contents after the fetch invocation returns.

### 7.2 Input validation
Untrusted inputs in scope:
- OLRC HTML listing page
- OLRC ZIP payloads
- XML contents inside ZIP entries
- CLI `--title` / `--output` args
- existing manifest contents on disk

Controls to preserve:
- reject malformed/non-zip payloads for non-53 titles
- reject unsafe ZIP entry paths
- reject duplicate normalized XML destinations
- preserve title validation `1..54`
- preserve parser error accumulation instead of crashing on per-section defects

### 7.3 Title 53 classification hardening
Security/correctness decision:
- Only Title 53 may be downgraded from hard failure to `reserved_empty` classification.
- The downgrade must require a machine-detectable reason such as HTML payload, unreadable/non-zip body, empty zip, or no XML entries.
- Equivalent behavior must **not** automatically apply to other titles.

This prevents broad failure masking where upstream corruption could otherwise be misclassified as acceptable.

### 7.4 Resource-exhaustion controls
Keep explicit extraction ceilings even after increasing the limit:
- per-entry max: 128 MiB
- total extracted XML max: retain bounded total cap
- continue processing ZIP entries in bounded fashion

Reason:
- OLRC data is untrusted remote content.
- The known Title 42 case requires a higher cap, not removal of size controls.

### 7.5 Logging and diagnostics
Allowed diagnostics:
- title number
- URL
- status code
- retry attempt
- selected vintage
- reserved-empty classification reason

Disallowed diagnostics:
- raw cookie headers
- full HTML error body dumps from OLRC

### 7.6 Filesystem safety
Preserve existing safety posture:
- atomic manifest writes
- atomic ZIP writes
- no placeholder artifacts for invalid/non-zip Title 53 responses
- extracted XML only from validated readable ZIPs

## 8. Implementation Plan

### 8.1 `src/utils/manifest.ts`
- Introduce concrete OLRC title-state types.
- Normalize older `titles` entries into the new shape where possible.
- Preserve additive/backward-compatible reads.

### 8.2 `src/sources/olrc.ts`
- Change `OLRC_LISTING_URL` to `download.shtml`.
- Add homepage bootstrap helper for cookie acquisition.
- Thread cookie-aware request headers through listing and ZIP fetches.
- Parse releasepoint links using a stricter numeric-title regex.
- Ignore appendix-title links.
- Increase XML entry size ceiling to 128 MiB.
- Add explicit Title 53 reserved-empty classification path.
- Keep other titles fatal on equivalent non-zip/unreadable responses.

### 8.3 `src/transforms/uslm-to-ir.ts`
- Update parser config for namespace tolerance.
- Add root discovery helper:
  - `uscDoc.main.title`
  - fallback `uslm.title`
- Preserve existing `TitleIR` and parse error model.

### 8.4 Tests
Add or update tests for:
- cookie bootstrap and follow-on Cookie header use
- `download.shtml` parsing and newest-vintage selection
- appendix-title ignore behavior
- Title 53 reserved-empty manifest state and no-artifact guarantee
- non-53 fetch failure containing title + URL
- Title 42 large-entry extraction
- current `uscDoc` Title 1 fixture with 53 sections
- unchanged legacy fixture compatibility
- CLI transform success for Title 1 fixture cache

## 9. Reviewer Feedback Addressed

### [spec-writer]
Addressed in this architecture:
- switched canonical listing endpoint to `download.shtml`
- made cookie bootstrap part of the source-layer contract
- treated Title 53 as a machine-readable skip state, not generic success/failure ambiguity
- required namespace-tolerant `uscDoc > main > title` parsing with legacy fallback
- explicitly chose a bounded larger-entry strategy for Title 42
- kept appendix-title CLI expansion out of scope

## 10. Key Decisions Summary

| Decision | Rationale |
|---|---|
| Keep filesystem/manifest persistence; no DB | CLI scope does not justify new infrastructure |
| Add in-memory cookie jar only | Solves OLRC session requirement without persisting sensitive state |
| Parse `download.shtml` releasepoint links | Matches current OLRC site behavior |
| Treat only Title 53 as `reserved_empty` | Prevents broad masking of upstream failures |
| Raise XML entry cap to 128 MiB | Meets Title 42 requirement without a parser rewrite |
| Keep parser backward-compatible with legacy `uslm` | Required by spec and existing fixtures |
| Keep integer-only CLI contract | Appendix-title support is explicitly out of scope |
