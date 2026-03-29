# Security Assessment: Canonical `<num @value>` extraction and XSD-contract regression coverage (#10)

**Date:** 2026-03-28
**Architecture reviewed:** `docs/architecture/10-architecture.md`
**Risk level:** Low

## Executive Summary
This change is low risk from a security perspective. The architecture keeps the work inside an existing single-process CLI parser, adds no new network surface, secrets, auth flows, or persistence, and improves integrity by making canonical number extraction deterministic and aligned to the USLM XSD contract.

I found no Critical or High issues requiring a spec or architecture rework. The main implementation concerns are boundary validation of untrusted XML-derived values before they influence filenames and preserving current guardrails against malformed or oversized inputs.

## Findings

### [LOW] Canonical `@value` should be constrained before it reaches filenames and identifiers
- **Category:** Tampering / Input validation
- **Component:** `src/transforms/uslm-to-ir.ts` canonical `<num>` helper and downstream path generation
- **Description:** The architecture correctly makes non-empty `@value` authoritative, but `@value` still originates from untrusted XML. If future fixtures or cached inputs contain unexpected path-significant characters, the parser could move decorated-text leakage from the display-text path into the attribute path instead.
- **Impact:** Malformed filenames, confusing output layout, or future path-traversal style bugs if later code assumes canonical numbers are inherently safe for filesystem use.
- **Recommendation:** In implementation, keep the shared helper responsible only for canonical extraction, then enforce a second explicit path-safety validation/sanitization boundary before any title/chapter/section number is used in file or directory names. Add tests proving disallowed path separators and traversal tokens are rejected or normalized safely.

### [LOW] Parser resource usage still depends on XML input size and structure
- **Category:** Denial of Service
- **Component:** XML parsing flow using `fast-xml-parser`
- **Description:** This issue does not add runtime XSD validation or new heavy processing, which is good, but the CLI still parses XML input in-process. The architecture mentions existing protections generally, but does not spell out implementation checks for unexpectedly large or malformed cached XML beyond current behavior.
- **Impact:** A malicious or corrupted input file could still cause elevated CPU or memory consumption during transform runs.
- **Recommendation:** Preserve any existing file-size and parse-failure guardrails, and avoid adding repeated whole-document reparsing in tests or production code. If no explicit input-size limit exists at the CLI boundary today, consider documenting one in a follow-up hardening issue.

### [INFO] No new auth, secret, privacy, or compliance exposure introduced
- **Category:** Data classification / Auth/Authz / Compliance
- **Component:** Whole feature
- **Description:** The reviewed architecture introduces no HTTP endpoints, no user sessions, no tokens, no service-to-service communication, and no new persistence. The data handled here is public legislative XML plus internal test/output artifacts.
- **Impact:** Minimal confidentiality risk. No meaningful GDPR, PCI-DSS, or similar compliance expansion from this issue.
- **Recommendation:** Keep logs free of raw unbounded XML blobs and continue treating parse diagnostics as internal operational data only.

## STRIDE Summary
- **Spoofing:** Not materially applicable; no identity boundary is introduced.
- **Tampering:** Primary concern is untrusted XML shaping canonical identifiers and filenames; mitigated by `@value`-first extraction plus path-safety validation.
- **Repudiation:** Low concern in a local CLI context; git history and test fixtures provide sufficient change traceability.
- **Information Disclosure:** Low; inputs are public legal texts and no secrets are introduced.
- **Denial of Service:** Limited to local parser resource consumption on malformed or oversized XML.
- **Elevation of Privilege:** Not applicable; no privilege boundary, auth surface, or role system is added.

## Data Classification
- **Public:** USLM/OLRC XML fixtures, schema reference, generated markdown outputs.
- **Internal:** Test reports, parse diagnostics, local CI/build logs.
- **PII:** None identified.
- **Secrets:** None identified.
- **Financial:** None identified.

**Should never be logged:** unnecessarily large raw XML payloads or arbitrary attribute values without truncation/escaping.

## Dependency Risk Notes
- **`fast-xml-parser` (`^4.5.0`)**: existing dependency, appropriate for this scope; main risk is trusting parsed attribute values too early.
- **`vitest` (`^3.0.0`)**: existing test-only dependency; no new risk introduced here.
- **`gray-matter` (`^4.0.3`)**: existing test/output inspection dependency; unchanged by this issue.

No dependency change is required by the architecture, which is the safest choice for this fix.

## Verdict

**Status:** APPROVED

- [x] All Critical findings addressed
- [x] All High findings addressed
- [x] Medium findings tracked
