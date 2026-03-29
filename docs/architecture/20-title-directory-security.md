# Security Assessment: Descriptive title directory names (#20)

**Date:** 2026-03-29
**Architecture reviewed:** docs/architecture/20-architecture.md
**Risk level:** Low

## Executive Summary
The proposed change is a low-risk, in-process filesystem path contract update inside the existing CLI. The architecture correctly identifies the only meaningful trust boundary: XML-derived title headings becoming directory names and relative link targets, and it mitigates that by centralizing slug generation in a pure helper plus retaining final-path safety checks.

I found no Critical or High issues that require spec or architecture rework. The main implementation risks are consistency drift and unsafe fallback behavior if any writer or link renderer bypasses the shared helper, so those areas should be verified in code review and tests.

## Findings

### [LOW] XML-derived heading text must remain treated as untrusted path input
- **Category:** Tampering / Input Validation
- **Component:** `src/domain/normalize.ts`, `src/transforms/write-output.ts`, `src/transforms/markdown.ts`
- **Description:** Title headings originate from XML and are public-content data, but they still cross a trust boundary when converted into filesystem paths and relative markdown links. If any production path assembly bypasses the centralized slug helper, unsafe or inconsistent directory names could reappear.
- **Impact:** Inconsistent or insufficient normalization could produce broken links, invalid output paths, or path-safety regressions if future changes reintroduce raw heading content into path assembly.
- **Recommendation:** Keep `titleDirectoryName()` as the sole production boundary for title-directory derivation, enforce it in all path and link helpers, and preserve mechanical tests that assert only `[a-z0-9-]` appear in the derived directory segment after the `title-{NN}` prefix.

### [LOW] Output-root hygiene remains an operational integrity concern
- **Category:** Tampering / Operational Safety
- **Component:** Generated output tree under caller-supplied output root
- **Description:** The feature changes generated parent directory names but intentionally does not rename or delete legacy `title-{NN}` directories. Re-running into a non-clean output root may leave old and new layouts side by side.
- **Impact:** Operators or downstream tooling could read stale content from the legacy directory tree and mistake it for current output, creating integrity confusion rather than a direct exploit.
- **Recommendation:** Keep the architecture’s current stance of no implicit deletion, but call out in implementation notes and release notes that consumers should transform into a clean output root when adopting the new layout.

### [INFO] No auth, secret, or regulated-data exposure is introduced
- **Category:** Data Classification / Auth/Authz
- **Component:** Entire feature scope
- **Description:** The feature operates entirely inside the existing local CLI and handles public legal text plus internal filesystem paths. It adds no accounts, sessions, credentials, databases, network listeners, or external services.
- **Impact:** No new authentication, authorization, encryption-at-rest, or compliance obligations are created by this change.
- **Recommendation:** None beyond maintaining current practice: do not log unbounded raw XML payloads or verbose unsanitized heading dumps on failures.

### [INFO] Dependency and attack-surface changes are negligible
- **Category:** Dependency Risk / Attack Surface
- **Component:** Build/runtime dependencies and CLI surface
- **Description:** The architecture correctly avoids adding a third-party slug library and keeps the change inside the existing TypeScript/Vitest/Node CLI boundary.
- **Impact:** This minimizes supply-chain expansion and does not materially increase the public attack surface.
- **Recommendation:** Retain the no-new-dependency approach unless a future requirement genuinely exceeds the current deterministic helper contract.

## STRIDE Summary
- **Spoofing:** Not materially applicable; no identities or services are introduced.
- **Tampering:** Primary concern is untrusted heading text influencing paths; centralized normalization and final safe-path checks are the right controls.
- **Repudiation:** Low relevance; output is local CLI-generated content with normal git history and test evidence for traceability.
- **Information Disclosure:** Low; data is public legal text, though internal filesystem roots and raw payload dumps should stay bounded in logs.
- **Denial of Service:** Low; slug generation is linear and local, with no new network or background processing.
- **Elevation of Privilege:** Not materially applicable; no permission model or privileged service boundary changes.

## Additional Review Notes
- **Auth/Authz:** Not applicable for this feature.
- **Data classification:** Public legal text plus internal filesystem paths/logs; no secrets or PII should be logged.
- **Input validation:** Boundary validation is appropriately placed in shared normalization plus `assertSafeOutputPath()` at write time.
- **Dependency risk:** No new runtime dependency is the preferred architecture choice here.
- **Encryption requirements:** No new in-transit or at-rest encryption surface is introduced.
- **Attack surface:** Existing local CLI only; no new endpoints, webhooks, or admin surfaces.
- **Compliance:** No new GDPR/PCI/SOC2 implications created by this feature.

## Verdict

**Status:** APPROVED

- [x] All Critical findings addressed
- [x] All High findings addressed
- [x] Medium findings tracked
