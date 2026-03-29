# Security Assessment: OLRC Releasepoint Fetch + uscDoc Parser Compatibility (#8)

**Date:** 2026-03-28
**Architecture reviewed:** docs/architecture/8-architecture.md
**Risk level:** Low

## Executive Summary
The proposed architecture is a reasonable, low-risk compatibility fix for a local CLI that fetches public OLRC content and transforms it into markdown. The main security-sensitive area is the temporary OLRC session cookie, and the architecture already makes the right high-level decision to keep that state in memory only and out of manifests, caches, and generated output.

I found no Critical or High issues that require spec or architecture rollback. The main implementation risks are operational hardening details: constraining cookie reuse to the intended OLRC host, preserving strict logging hygiene for HTML error bodies and headers, and keeping bounded disk/resource usage even after raising the XML extraction ceiling for Title 42.

## Findings

### [MEDIUM] Cookie jar must remain origin-scoped and non-forwardable
- **Category:** Spoofing / Information Disclosure
- **Component:** `src/sources/olrc.ts`
- **Description:** The architecture correctly requires an in-memory cookie jar, but it does not explicitly state that captured cookies must be replayed only to the OLRC origin (`https://uscode.house.gov`) and never forwarded to arbitrary redirect or parsed listing targets.
- **Impact:** If a future parsing bug, redirect edge case, or malformed absolute URL caused requests to another host, the CLI could leak the transient OLRC session cookie to an unintended destination.
- **Recommendation:** In the architecture/implementation contract, require that cookie attachment is host-allowlisted to `uscode.house.gov` only, and reject or strip cookies on any cross-origin request target.

### [MEDIUM] Keep a bounded on-disk download ceiling in addition to XML extraction limits
- **Category:** Denial of Service
- **Component:** `src/sources/olrc.ts` / cache write path
- **Description:** The architecture raises the extracted XML per-entry ceiling to 128 MiB, which is acceptable for the known Title 42 case, but it does not explicitly require a maximum accepted ZIP payload size before persistence.
- **Impact:** A malformed or hostile upstream response could still consume excessive local disk space before the extractor rejects content, especially in repeated fetch runs or CI environments with limited storage.
- **Recommendation:** Add an implementation requirement for a bounded maximum ZIP download size or content-length guardrail, with a clear failure path for oversized responses before or during write-to-disk.

### [LOW] Logging contract should explicitly forbid raw response-header/body dumps on failure paths
- **Category:** Information Disclosure
- **Component:** `src/utils/logger.ts` / OLRC failure handling
- **Description:** The architecture forbids raw cookie logging and full HTML error-body dumps, which is good, but it would be safer to explicitly prohibit raw header dumps and generic `Response` object serialization in OLRC error paths.
- **Impact:** A debugging-oriented future change could accidentally emit `Set-Cookie` or other verbose response data to stderr or test artifacts.
- **Recommendation:** Codify an allowlist-only logging rule for OLRC failures: title, URL, attempt, status code, selected vintage, and reserved-empty classification reason only.

### [LOW] Reserved-empty downgrade should remain tightly signature-bound to Title 53 only
- **Category:** Tampering / Input Validation
- **Component:** `src/sources/olrc.ts` / manifest classification
- **Description:** The architecture already says only Title 53 may be classified as `reserved_empty`, which is the right boundary. The remaining risk is implementation drift that broadens the downgrade to “any non-zip/empty title” logic.
- **Impact:** Broader downgrade logic could mask upstream corruption or transport failures for titles that should fail hard.
- **Recommendation:** Require tests that prove identical unreadable payloads fail for non-53 titles and only downgrade for Title 53 with machine-detectable reasons.

### [INFO] Data classification is appropriately minimal for this CLI
- **Category:** Data Classification
- **Component:** Entire feature
- **Description:** This feature primarily handles public OLRC HTML, ZIP, XML, generated markdown, and internal manifest/cache metadata. The only secret-like material in scope is the transient session cookie acquired from OLRC.
- **Impact:** Low. There is no new user PII, financial data, or long-lived credential introduced by this design.
- **Recommendation:** Treat the OLRC cookie as secret material that must never be logged or persisted; treat manifests/logs as internal; treat fetched legal text and generated markdown as public content.

### [INFO] Auth/authz expansion is not introduced by this change
- **Category:** Auth/Authz Design
- **Component:** Entire feature
- **Description:** This is a local CLI workflow with no new service boundary, user identity model, or privilege partitioning. The OLRC session is a site compatibility mechanism, not a user-authenticated application session.
- **Impact:** Low. No new RBAC, token rotation, or session invalidation surface is created beyond the transient cookie bootstrap.
- **Recommendation:** Keep the session ephemeral and process-local; do not generalize it into persisted auth state.

### [INFO] Existing ZIP path validation and atomic writes materially reduce risk
- **Category:** Tampering / Filesystem Safety
- **Component:** `src/sources/olrc.ts` / `src/utils/manifest.ts`
- **Description:** The architecture preserves safe ZIP entry validation, duplicate normalized-path rejection, and atomic manifest/ZIP writes.
- **Impact:** These controls meaningfully reduce path traversal, partial-write corruption, and state-desynchronization risk.
- **Recommendation:** Preserve these controls unchanged and extend tests around Title 42 and Title 53 edge cases.

## STRIDE Notes
- **Spoofing:** Limited surface. Main concern is accidental cookie forwarding to unintended hosts; mitigated by origin-scoped cookie attachment.
- **Tampering:** Untrusted OLRC listing HTML, ZIPs, XML, and on-disk manifest contents are recognized. Existing ZIP/path validation and typed manifest normalization are appropriate.
- **Repudiation:** This is a local CLI, so formal audit trails are not required. Manifest state plus structured logs are sufficient operator evidence.
- **Information Disclosure:** Primary disclosure risk is cookie/header/body logging. The architecture mostly addresses this and should be tightened with allowlist-only diagnostics.
- **Denial of Service:** Raised XML limits are acceptable if bounded; add explicit ZIP download-size ceilings and preserve current extraction caps.
- **Elevation of Privilege:** No new privilege boundary is introduced; the feature runs with the invoking user’s local filesystem rights only.

## Data Classification
- **Secrets:** transient OLRC session cookie (`JSESSIONID` or equivalent). **Never log or persist.**
- **Internal:** manifest state, structured stderr logs, cache metadata.
- **Public:** OLRC listing HTML, ZIP/XML legal text, generated markdown output.
- **PII / Financial:** none expected in normal operation.

## Dependency Risk
- **Node built-in `fetch`:** appropriate and low additional supply-chain risk.
- **`fast-xml-parser` 4.5.x:** active, common dependency; acceptable for namespace-tolerant parsing in this scope.
- **`yauzl` 3.1+/3.2.x:** mature ZIP handling library; acceptable given existing path/entry validation.

No architecture change is required based on dependency posture alone, but implementation should keep versions pinned via lockfile and continue offline fixture-driven tests to avoid coupling safety to live upstream behavior.

## Compliance Considerations
No material GDPR, PCI-DSS, HIPAA, or SOC2-specific architectural requirement is introduced by this issue. The feature processes public legal source material and a transient session cookie rather than regulated user data.

## Verdict

**Status:** APPROVED

- [x] All Critical findings addressed
- [x] All High findings addressed
- [x] Medium findings tracked
