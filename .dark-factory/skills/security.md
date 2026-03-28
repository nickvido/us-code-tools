# Security Notes

## Trust Boundary
- Untrusted inputs:
  - CLI flags (`--title`, `--output`)
  - remote OLRC ZIP payloads
  - XML content inside accepted ZIP entries
  - filesystem state under cache/output roots
- No secrets, auth tokens, or PII in this phase.

## Implemented Controls

### Download / Network
- `src/sources/olrc.ts`
  - `resolveTitleUrl()` constrains fetches to OLRC releasepoint URLs.
  - `fetchWithRetry()` applies a 30s timeout via `AbortController`.
  - retries transient timeout / connection-reset failures exactly once.
  - download errors are rethrown with title number + URL context.

### Cache Integrity
- Full cache artifact set is validated before trusting reuse:
  - ZIP file exists and is non-zero
  - `manifest.json` exists and parses
  - `<zip>.sha256` exists and matches computed SHA-256
  - manifest title/source URL/cache key/filename/size/SHA must agree with the ZIP
- Invalid cache sets are deleted before redownload.
- Note: cache SHA protects local integrity / torn writes, not upstream authenticity.

### ZIP / XML Hardening
- `extractXmlEntriesFromZip()` in `src/sources/olrc.ts`:
  - accepts only `.xml` entries
  - rejects unsafe paths, duplicate normalized destinations, and non-regular entries
  - rejects symlink-like/special entries using `externalFileAttributes`
  - enforces 64 MiB max per XML entry and 256 MiB total extracted bytes
  - returns XML entries sorted lexically by normalized path
- `parseUslmToIr()` in `src/transforms/uslm-to-ir.ts`:
  - uses explicit `fast-xml-parser` config
  - strips UTF-8 BOM
  - caps normalized field text at 1 MiB
  - emits bounded `UNSUPPORTED_STRUCTURE` / `INVALID_XML` parse errors instead of crashing

### Output Filesystem Safety
- `validateOutputDirectory()` in `src/index.ts` rejects existing non-directory `--output` targets before download/transform work.
- `assertSafeOutputPath()` in `src/utils/fs.ts`:
  - verifies resolved target stays under output root
  - refuses symlinked intermediate directories
- `atomicWriteFile()` uses temp file + rename to avoid partial output files.

## Security Decisions with Rationale
- **No blind ZIP extraction** — required to avoid path traversal and special-entry writes from untrusted archives.
- **Minimal section filename normalization** — only `/` → `-`, preserving legal identifiers while blocking path escapes.
- **Network-free default tests** — keeps CI deterministic and avoids treating third-party availability as security/reliability proof.
- **Bounded parser behavior** — malformed or oversized fields become parse errors, not crashes or unbounded allocations.

## Things Future Agents Should Not Mislabel as Bugs
- Lack of database/auth/RLS is intentional; this feature is a local CLI only.
- Fixture-backed integration tests are intentional; live network is deferred from default CI.
- Hardcoded OLRC releasepoint pattern is acceptable for Phase 1; dynamic releasepoint discovery is future work.

## Phase 1 Scope (Current)
- What's implemented:
  - archive path and entry-type hardening
  - bounded extraction and parser limits
  - output-root containment and symlink refusal
  - early CLI validation for invalid output targets
- What's intentionally deferred:
  - upstream signature/checksum verification from OLRC (not available in current scope)
  - sandboxing or process isolation for parsing
  - broader supply-chain verification beyond npm lockfile / CI norms
- What's a test double vs production:
  - mocked fetch and fixture ZIPs validate security-sensitive failure paths in CI
  - production path is the same parser/writer/download code, just fed by live OLRC instead of fixtures
