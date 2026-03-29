# Security Assessment: Transform chapter-level output mode (#16)

**Date:** 2026-03-29
**Architecture reviewed:** docs/architecture/16-architecture.md
**Risk level:** Low

## Executive Summary
The proposed architecture is low risk and appropriate for the repository’s current trust model because it keeps the feature inside the existing single-process local CLI, adds no new network surface, and reuses established path-safety and markdown-rendering boundaries. The main security-sensitive areas are deterministic filename normalization for chapter identifiers, safe containment of filesystem writes, and avoiding unexpected resource spikes from large concatenated chapter files.

I found no Critical or High issues that require changing the spec or revising the architecture. The remaining concerns are implementation-phase hardening items that should be tracked in development and test coverage.

## Findings

### [LOW] Chapter identifier normalization remains a path-safety boundary
- **Category:** Tampering / Input Validation
- **Component:** `src/domain/normalize.ts`, `src/transforms/write-output.ts`
- **Description:** In chapter mode, upstream XML-derived `hierarchy.chapter` values now influence output filenames. The architecture correctly centralizes normalization and requires `assertSafeOutputPath()`, but this helper becomes a security boundary because malformed or hostile chapter identifiers could otherwise attempt traversal-like or device-name-like filenames.
- **Impact:** If normalization is implemented incorrectly or bypassed by any write path, transform output could target unintended filenames, cause collisions, or make writes non-portable and difficult to audit.
- **Recommendation:** Treat `chapterFileSafeId()` / `chapterOutputFilename()` as the only allowed path-construction helpers for chapter output, forbid any raw chapter identifier interpolation in write code, and add tests for traversal-like and degenerate inputs such as `../x`, `..`, `/`, `\\`, long punctuation-only values, and collision-prone mixed formatting.

### [LOW] Concatenated chapter files increase single-file resource pressure
- **Category:** Denial of Service
- **Component:** `src/transforms/markdown.ts`, `src/transforms/write-output.ts`
- **Description:** Chapter mode reduces file-count overhead, which is beneficial overall, but it also creates materially larger individual markdown files than section mode. The architecture acknowledges this and considers current title sizes acceptable, but the new path should still be treated as a bounded-resource operation.
- **Impact:** Extremely large chapters or malformed upstream inputs could increase memory use and write latency enough to degrade local runs or CI stability.
- **Recommendation:** Preserve the existing OLRC extraction caps, avoid duplicate in-memory copies where practical during chapter rendering, and add at least one integration assertion covering a multi-section large-chapter fixture so future regressions in memory or time complexity are more visible.

### [INFORMATIONAL] No new auth, secrets, transport, or compliance surface introduced
- **Category:** Auth/Authz / Data Classification / Compliance
- **Component:** Entire feature
- **Description:** This feature is confined to a local filesystem transform path and does not add accounts, sessions, web endpoints, databases, secret handling, or regulated-data flows. Inputs remain public legislative text plus local operator-selected filesystem paths.
- **Impact:** Traditional web-service concerns such as token storage, TLS termination, RBAC, webhook verification, or privacy-law data handling are not newly implicated by this issue.
- **Recommendation:** Keep the implementation network-neutral during transform as specified, and do not expand logging to emit raw upstream-derived chapter metadata beyond the structured JSON report without a fresh review.

## Threat Modeling Notes

### STRIDE summary
- **Spoofing:** Low. No new identity boundary or remote caller surface is introduced.
- **Tampering:** Low. Main concern is malformed XML-derived chapter identifiers influencing filenames; centralized normalization and output-root checks are the right controls.
- **Repudiation:** Low. Existing CLI stdout/stderr plus git history for generated artifacts remain sufficient for this local tooling workflow.
- **Information Disclosure:** Low. No new sensitive data classes are introduced; generated content is public legal text.
- **Denial of Service:** Low. Larger chapter files are the main operational risk, but existing bounded local CLI assumptions appear adequate.
- **Elevation of Privilege:** Low. No role or privilege model changes; the feature stays within the invoking user’s filesystem permissions.

## Data Classification
- **Public:** U.S. Code source text, chapter headings, generated markdown, chapter identifiers, title metadata.
- **Internal:** JSON transform diagnostics (`warnings`, `parse_errors`), local file paths, CI logs.
- **Secrets/PII/Financial:** None newly introduced by this feature.

### Should never be logged
- No new secrets are in scope. Continue avoiding raw filesystem details or unexpected upstream payload dumps in stderr beyond existing structured diagnostics.

## Dependency Risk
No new dependency is required by the architecture, which is the safest choice here. Reusing repository-standard dependencies (`typescript`, `vitest`, `gray-matter`) keeps supply-chain exposure unchanged.

## Encryption Requirements
Not applicable for this feature change. No new transport or at-rest secret-bearing storage is introduced.

## Attack Surface
- **Public endpoints:** None.
- **Admin interfaces:** None.
- **Internal APIs:** None.
- **Webhooks:** None.
- **Local attack surface:** CLI flags, upstream-parsed XML fields reused for grouping, and output filesystem paths.

## Compliance Considerations
No new GDPR, PCI-DSS, or similar compliance obligations are introduced by this architecture. The feature processes public legal text and local filesystem outputs only.

## Verdict

**Status:** APPROVED

- [x] All Critical findings addressed
- [x] All High findings addressed
- [x] Medium findings tracked
