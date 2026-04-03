# Security Assessment: GovInfo bulk repository fetch source (#40)

**Date:** 2026-04-03
**Architecture reviewed:** `docs/architecture/40-architecture.md`
**Risk level:** Medium

## Executive Summary
The proposed architecture is reasonably sound for an anonymous, local-only bulk downloader: it keeps the feature additive, constrains network access to `https://www.govinfo.gov/bulkdata/`, uses atomic writes, and requires XML/ZIP validation before artifacts are marked complete. The main remaining risks are operational integrity risks rather than classic auth problems: anonymous upstream content is still untrusted, and large recursive ZIP/XML downloads create realistic denial-of-service and local-state corruption scenarios if extraction and manifest updates are not further constrained.

## Findings

### [MEDIUM] Add explicit extraction and disk-consumption guardrails for ZIP/XML artifacts
- **Category:** Denial of Service / Input Validation
- **Component:** `src/sources/govinfo-bulk.ts`, ZIP extraction flow, cache layout under `data/cache/govinfo-bulk/`
- **Description:** The architecture correctly requires ZIP validation, XML validation, streaming downloads, and bounded concurrency, but it does not define hard limits on extracted size, entry count, compression ratio, or remaining-disk checks before/while expanding anonymous upstream artifacts. GovInfo is a trusted publisher in practice, but from a security standpoint the repository is still an external content source and must be treated as hostile input.
- **Impact:** A malformed, unexpectedly huge, or intentionally abusive ZIP/XML payload could exhaust disk space, consume excessive CPU, or stall the host, especially because the feature is expected to fetch multi-GB historical datasets recursively.
- **Recommendation:** Revise the architecture to require implementation-time safeguards before marking the design complete: enforce per-artifact maximum extracted bytes and maximum entry counts, reject suspicious compression ratios, fail fast when available disk space is below a documented floor, and surface these failures as structured manifest errors without leaving extracted partial trees behind.

### [MEDIUM] Define a single-writer control for `data/manifest.json` and selected cache scope
- **Category:** Tampering / Repudiation / Concurrency Safety
- **Component:** `src/utils/manifest.ts`, `src/sources/govinfo-bulk.ts`
- **Description:** The architecture acknowledges multi-process contention but leaves it as a future enhancement even though this feature is explicitly resumable, long-running, and likely to be retried manually in parallel. Process-specific temp names help protect file artifacts, but they do not fully protect `data/manifest.json` from lost updates or contradictory completion state when two fetches target overlapping collection/congress scopes.
- **Impact:** Concurrent runs can overwrite manifest progress, produce misleading `completed_at` state, or make operators believe an artifact was fully validated when a competing process actually replaced or partially re-extracted it. This weakens the reliability of resume semantics and auditability.
- **Recommendation:** Revise the architecture to require a simple single-writer mechanism for the manifest and selected scope, such as a lockfile or advisory file lock around manifest mutation plus a scope re-check before final rename/commit. If the project deliberately declines locking, the architecture should explicitly define conflict behavior and operator-visible failure modes instead of leaving them implicit.

### [LOW] Avoid logging full upstream URLs and local absolute paths at high volume
- **Category:** Information Disclosure / Operational Security
- **Component:** structured logging, JSON result payloads, runbook guidance
- **Description:** The feature does not handle secrets, but verbose logs for thousands of downloads can still disclose operator filesystem layouts, worktree paths, and complete acquisition scope in shared CI logs or pasted transcripts. The architecture hints at avoiding absolute paths in user-facing JSON, but it does not make log-redaction expectations explicit.
- **Impact:** Low-severity environment disclosure can leak local usernames, directory structures, or the exact progress state of private development environments.
- **Recommendation:** Keep user-facing JSON relative-path oriented, avoid absolute path logging by default, and document that debug logging should truncate or summarize repeated per-file events unless the operator explicitly opts into verbose diagnostics.

### [INFO] Network allowlisting and no-key design materially reduce the attack surface
- **Category:** Spoofing / Attack Surface / Secret Handling
- **Component:** listing traversal, download client, CLI contract
- **Description:** The architecture restricts requests to anonymous HTTPS GETs under `https://www.govinfo.gov/bulkdata/`, forbids shell-outs, and explicitly avoids `API_DATA_GOV_KEY` for this source.
- **Impact:** This sharply limits SSRF-style traversal, secret leakage, and credential-handling mistakes compared with reusing the authenticated GovInfo API path.
- **Recommendation:** Preserve the explicit host/path allowlist and add tests that reject redirects or listing entries that resolve outside the allowed origin/prefix.

### [INFO] Atomic writes plus post-download validation are the correct integrity controls
- **Category:** Tampering
- **Component:** temp-file/temp-directory write model, manifest completion semantics
- **Description:** The architecture requires temp-path writes, ZIP/XML validation, and manifest completion only after final rename. That is the right control set for resumable bulk acquisition from an untrusted upstream.
- **Impact:** These controls significantly reduce the chance of partial, HTML, or otherwise invalid payloads poisoning resume state.
- **Recommendation:** Keep these invariants centralized and cover them with integration tests that simulate mid-download aborts, HTML error bodies, and failed extraction.

## Threat Modeling Notes
- **Spoofing:** Primary spoofing risk is hostile or misresolved listing/file URLs. The architecture mitigates this with a strict `www.govinfo.gov` + `/bulkdata/` allowlist, but redirect and off-prefix resolution tests should be mandatory.
- **Tampering:** Main tampering risks are malformed listings, HTML masquerading as XML/ZIP, and concurrent manifest mutation. Atomic writes and payload validation address the first two; explicit locking or conflict handling is still needed for the third.
- **Repudiation:** This is a local CLI, so normal git history and manifest history are the main audit trail. Concurrent-run ambiguity currently weakens operator confidence in who completed what.
- **Information Disclosure:** No secrets are introduced, but logs can still leak local absolute paths and acquisition details if verbosity is uncontrolled.
- **Denial of Service:** This is the dominant threat class. Large recursive anonymous downloads plus extraction can exhaust disk, CPU, file descriptors, or runtime if hard limits are not specified.
- **Elevation of Privilege:** No role model, session boundary, or privilege-escalation path is introduced beyond the local user already running the CLI.

## Data Classification
- **Public:** GovInfo bulk listings, downloaded bill/law XML, result counts, runbook content.
- **Internal:** `data/manifest.json`, local cache layout, temp files, structured logs, CI/worktree paths.
- **Secrets / PII / Financial:** None intentionally in scope.

Items that should never be logged:
- environment variables and unrelated process environment
- absolute local filesystem paths unless explicitly debugging
- raw partial payload bodies from failed downloads when a summarized error is sufficient

## Auth/Authz Review
Not applicable in the usual web-service sense. The feature adds no authentication, authorization, sessions, tokens, or roles. The key security property here is actually the absence of credentials: `govinfo-bulk` should remain fully anonymous and isolated from `API_DATA_GOV_KEY` logic.

## Input Validation Review
- **Trust boundary:** remote XML directory listings and downloaded XML/ZIP artifacts entering the local filesystem.
- **Required validation at the boundary:** allowed-origin URL resolution, XML parseability, HTML/error-body rejection, ZIP entry path normalization, and post-download validation before completion state is persisted.
- **Gap:** architecture should also require extraction-size and concurrency-safe manifest validation as first-class boundary checks, not implementation afterthoughts.

## Dependency Risk Review
- **`fast-xml-parser`:** acceptable reuse for listing parsing and XML validation; keep pinned within existing project policy and avoid permissive parsing modes that silently coerce invalid bodies into success.
- **`yauzl`:** reasonable existing dependency for ZIP inspection/extraction; ensure symlink handling, entry normalization, and size-based extraction limits are explicitly enforced by the calling code.
- **New dependencies:** none proposed, which is preferable here. Avoid adding downloader/extractor packages unless the existing stack cannot enforce the required safety checks.

## Encryption Requirements
- **In transit:** HTTPS to `www.govinfo.gov` is required and correctly specified. Redirects should not be allowed to downgrade or escape the host/prefix allowlist.
- **At rest:** No regulated sensitive data is expected, so encryption-at-rest is not a feature requirement. Standard workstation/disk protections remain sufficient.
- **Secret storage:** No secrets should be introduced or read for this source.
- **Key management:** Not applicable.

## Attack Surface Review
- **Public endpoints:** None; this remains a local CLI.
- **Admin interfaces:** None.
- **Internal APIs:** In-process module calls only.
- **External systems:** Anonymous GovInfo bulkdata endpoints only.
- **Primary exposed surfaces:** XML listing parser, ZIP extractor, manifest writer, and local filesystem.

## Compliance Considerations
No material GDPR, PCI-DSS, HIPAA, or SOC 2 expansion is introduced. The dataset is public government legislative material. Standard repository hygiene still applies to logs and local artifacts.

## Notes on Repository Inputs
The requested `.dark-factory/config.yaml` file was not present in this worktree, so this assessment used `docs/specs/40-spec.md`, `docs/architecture/40-architecture.md`, and the repository’s established documentation patterns as the authoritative review inputs.

## Verdict

**Status:** APPROVED

- [x] All Critical findings addressed
- [x] All High findings addressed
- [x] Medium findings tracked
