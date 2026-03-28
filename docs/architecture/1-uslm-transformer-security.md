# Security Assessment: USLM XML to Markdown Transformer (#1)

**Date:** 2026-03-28
**Architecture reviewed:** docs/architecture/1-architecture.md
**Risk level:** Medium

## Executive Summary
The revised architecture is materially stronger than the prior draft and now addresses the original blocking extraction risk with concrete archive-validation and containment requirements. For a local, single-process CLI that handles only public statutory content, the remaining concerns are implementation-hardening details rather than architecture blockers.

Overall, the security posture is appropriate for this phase: the trust boundaries are explicit, resource limits are defined, network scope is narrow, and output/cache writes are constrained with atomic and containment-oriented rules. No Critical or High findings remain at the architecture level.

## Findings

### [MEDIUM] Cache integrity is local-only and does not authenticate upstream content
- **Category:** Spoofing / Supply Chain
- **Component:** `src/sources/olrc.ts`, `src/utils/cache.ts`
- **Description:** The cache manifest and `.sha256` file protect against partial writes, local corruption, and stale artifact reuse, but they do not authenticate the OLRC payload against an authoritative upstream digest or signature. The current design relies on HTTPS and host trust for source authenticity.
- **Impact:** If the upstream source or transport trust were compromised, a malicious but well-formed ZIP could still be cached and processed.
- **Recommendation:** Keep HTTPS/TLS as the baseline for this issue, but document in implementation that cache SHA-256 values provide local integrity only. If OLRC later publishes signed digests or authoritative checksums, add optional verification against them.

### [MEDIUM] XML and ZIP resource limits must be enforced exactly as specified during implementation
- **Category:** Denial of Service / Input Validation
- **Component:** `src/utils/zip.ts`, `src/transforms/uslm-to-ir.ts`
- **Description:** The architecture now defines concrete limits for per-entry extracted size, total extracted size, request timeout, bounded retries, and oversized text-node handling. These controls are sufficient on paper, but the implementation must apply them before allocation-heavy operations and test failure paths explicitly.
- **Impact:** If implemented loosely, malformed or oversized ZIP/XML content could still cause excessive memory or CPU consumption.
- **Recommendation:** Treat the documented bounds as mandatory acceptance checks in tests. Enforce size checks during archive enumeration/streaming and convert oversize or malformed structures into bounded parse errors rather than crashes.

### [LOW] Output-root symlink refusal is correct but may surprise operators without a clear error contract
- **Category:** Tampering
- **Component:** `src/transforms/write-output.ts`
- **Description:** The architecture appropriately refuses symlinked intermediate directories below the output root to prevent path-escape writes. That policy is secure, but it should produce a deterministic operator-facing error because some local build environments use symlink-heavy directory layouts.
- **Impact:** Confusing errors could lead operators to weaken the check or misdiagnose failures.
- **Recommendation:** Emit a clear structured error that names the offending path component and states that symlinked intermediate directories are unsupported for this phase.

### [INFO] Prior high-severity archive extraction issue is now addressed in the architecture
- **Category:** Tampering / Elevation of Privilege
- **Component:** `src/sources/olrc.ts`, `src/utils/zip.ts`
- **Description:** The revised architecture now forbids blind extraction, requires entry enumeration, rejects absolute/`..`/drive-prefixed paths, rejects special entries, rejects duplicate normalized destinations, and requires post-resolution containment under the extraction root.
- **Impact:** This removes the previously identified arbitrary local file write risk from the architectural design.
- **Recommendation:** Preserve these checks as non-optional implementation requirements and cover them with targeted tests using malicious ZIP fixtures.

### [INFO] Data handled in this phase is low sensitivity
- **Category:** Data Classification
- **Component:** Whole system
- **Description:** This phase processes public legal text, cache metadata, parse diagnostics, and local file paths. No PII, credentials, tokens, payment data, or authenticated sessions are introduced.
- **Impact:** Compliance and secret-handling burden is low for this issue.
- **Recommendation:** Continue avoiding full XML payload dumps in logs; keep stderr focused on bounded diagnostics and file/source identifiers.

### [INFO] Attack surface remains intentionally small and appropriate
- **Category:** Attack Surface
- **Component:** Whole system
- **Description:** The design stays within a local CLI boundary and avoids adding an HTTP API, database, background service, webhook receiver, or privileged daemon.
- **Impact:** Smaller scope materially reduces security complexity and review risk.
- **Recommendation:** Maintain this narrow surface during implementation; do not introduce network listeners or extra service dependencies in this ticket.

## Verdict

**Status:** APPROVED

- [x] All Critical findings addressed
- [x] All High findings addressed
- [x] Medium findings tracked
