# Security Assessment: Data Acquisition — API Clients & Initial Source Download (#5)

**Date:** 2026-03-28
**Architecture reviewed:** docs/architecture/5-architecture.md
**Risk level:** Medium

## Executive Summary
The proposed architecture is generally sound for a local single-process acquisition CLI: it keeps the trust surface narrow, uses atomic writes and source-scoped locks, avoids introducing unnecessary services, and explicitly addresses several important filesystem and secret-handling risks. I did not find any Critical or High issues that require sending the work back to spec or architecture.

The main remaining security concerns are implementation-phase controls around resource exhaustion, authenticity/integrity verification of unauthenticated upstream content, and disciplined redaction/validation at all trust boundaries. These are important, but they can be tracked as Medium/Low items without blocking the architecture.

## Findings

### [MEDIUM] Unbounded upstream artifact size and extraction volume could permit local disk exhaustion
- **Category:** Denial of Service
- **Component:** `src/sources/olrc.ts`, `src/sources/voteview.ts`, `src/sources/unitedstates.ts`, `src/utils/cache.ts`
- **Description:** The architecture correctly calls out large artifacts and mentions ZIP hardening, but it does not define explicit byte ceilings, extracted-size ceilings, or available-disk preflight rules for permanent downloads and extraction flows in this issue’s new acquisition pipeline. A malicious, corrupted, or unexpectedly expanded upstream artifact could consume excessive local disk during download, decompression, or index generation.
- **Impact:** The operator machine could run out of disk space or hit severe resource pressure, leaving partial artifacts, failed runs, or degraded host stability.
- **Recommendation:** Add explicit architectural limits for maximum downloaded artifact size, maximum extracted size per OLRC title, maximum temporary workspace usage, and a fail-fast low-disk-space preflight/checkpoint policy before large writes and extractions.

### [MEDIUM] Upstream content integrity is tracked after download but not authenticated before trust/use
- **Category:** Tampering
- **Component:** All source clients; especially OLRC, VoteView, and UnitedStates downloads
- **Description:** The design records SHA-256 checksums for stored artifacts, which is good for local integrity tracking, but there is no architectural control for verifying authenticity of unauthenticated upstream files beyond HTTPS transport. For static downloads from public sources, the architecture currently trusts the remote endpoint and TLS alone.
- **Impact:** If an upstream host, mirror path, or delivery chain is compromised, the CLI could persist and later consume tampered source artifacts as if they were legitimate.
- **Recommendation:** Document a trust policy for upstream artifact authenticity. At minimum, log and persist origin metadata and content hashes consistently; preferably add support for validating expected host allowlists and, where upstream publishes them, checksum/signature verification or pinned release-source metadata.

### [MEDIUM] Structured logging requirements need stronger guardrails against accidental sensitive-data leakage
- **Category:** Information Disclosure
- **Component:** `src/utils/logger.ts`, `src/sources/base-client.ts`
- **Description:** The architecture says API keys and Authorization-like headers must be redacted, but the acquisition system will process full URLs, response/error objects, manifest state, and possibly upstream payload fragments. Without a stricter architectural rule for logging only approved fields, developers may accidentally log query strings, response bodies, or exception objects that contain secrets or more internal state than intended.
- **Impact:** `API_DATA_GOV_KEY` or other sensitive operational details could leak to stderr logs, CI logs, or captured run transcripts.
- **Recommendation:** Tighten the architecture to require an allowlist-based logging schema for outbound requests and failures, explicitly forbidding raw request URLs with secret-bearing query strings, raw headers, raw bodies, and unfiltered exception serialization.

### [LOW] Current file-permission model is acceptable for this phase but does not protect cached public-member data on multi-user hosts
- **Category:** Information Disclosure
- **Component:** `data/cache/**/*`, `data/manifest.json`
- **Description:** The architecture uses `0600` for the manifest and lock files but `0644` for cached artifacts. Most cached content is public-source data, so this is not a severe issue, but some operators may run this on shared systems where world-readable cache artifacts reveal acquisition scope, run timing, or locally derived indexes.
- **Impact:** Local users on the same host could inspect cached acquisition data and operational metadata.
- **Recommendation:** Consider defaulting cache artifacts to `0640` or making cache permissions configurable, while keeping the manifest restrictive by default.

### [LOW] Dependency review is sensible, but package-version pinning and vulnerability review should be explicit in implementation acceptance
- **Category:** Dependency Risk
- **Component:** `package.json`, added YAML/CSV parsing dependencies
- **Description:** The architecture recommends minimal dependencies and names good candidates, but it does not explicitly require lockfile-reviewed additions, dependency provenance review, or a vulnerability scan as part of implementation completion.
- **Impact:** Supply-chain regressions or risky transitive dependencies could slip into the implementation phase unnoticed.
- **Recommendation:** Require lockfile updates, dependency review for newly added packages, and a vulnerability scan in CI or pre-merge checks for this issue’s implementation PRs.

### [INFORMATIONAL] Auth/authz surface is intentionally minimal and appropriate for a local CLI
- **Category:** Auth/Authz Design
- **Component:** Overall architecture
- **Description:** This design introduces no public HTTP API, no multi-user service role model, and no browser auth surface. The only secret is `API_DATA_GOV_KEY`, which is appropriately limited to environment-based injection.
- **Impact:** Attack surface remains substantially smaller than a service-based design.
- **Recommendation:** Keep the local CLI model for this phase and avoid expanding to a service without a fresh security review.

### [INFORMATIONAL] Filesystem safety and resumability controls are strong for this phase
- **Category:** Tampering / Repudiation
- **Component:** `src/utils/cache.ts`, `src/utils/manifest.ts`, `src/utils/lock.ts`
- **Description:** Atomic temp-write-plus-rename semantics, source-scoped lock files, and the rule that manifest success entries may reference only finalized artifacts are strong controls for crash safety and concurrent-writer correctness.
- **Impact:** These measures materially reduce the risk of corrupted state or ambiguous recovery after interruption.
- **Recommendation:** Preserve these controls exactly in implementation and ensure concurrency tests cover unhappy paths.

## STRIDE Notes
- **Spoofing:** Low external spoofing risk beyond upstream endpoint trust; HTTPS-only transport and host-specific integrations are appropriate.
- **Tampering:** Main risk is tampered upstream content or partial local writes; atomic writes and checksums help, but upstream authenticity verification remains only partially addressed.
- **Repudiation:** Structured logs plus manifest history provide useful auditability for a local CLI.
- **Information Disclosure:** Primary sensitive datum is `API_DATA_GOV_KEY`; redaction discipline is the key control.
- **Denial of Service:** The most meaningful risk area for this issue due to large downloads, extraction, and shared-rate-budget exhaustion.
- **Elevation of Privilege:** No meaningful remote privilege boundary is introduced because this is not a service; local process/file permissions remain the main boundary.

## Data Classification
- **Secrets:** `API_DATA_GOV_KEY` — must never be logged, written to manifest, cached in URLs, or committed.
- **Internal:** Structured logs, manifest metadata, checkpoints, cache indexes — should avoid secret leakage and excessive operational detail.
- **Public:** OLRC XML, Congress/GovInfo JSON, VoteView CSV, UnitedStates YAML, legislator/member metadata.
- **PII:** Public official biographical/member data may still be personally identifying, but it is public-source legislative data rather than sensitive end-user PII.

## Compliance Considerations
No obvious PCI-DSS or similar regulated-data obligations apply here. GDPR/privacy exposure is low because the system processes public government and legislator data rather than private end-user submissions, but operators should still avoid unnecessary retention or logging of enriched member/profile data beyond project need.

## Verdict

**Status:** APPROVED

- [x] All Critical findings addressed
- [x] All High findings addressed
- [x] Medium findings tracked
