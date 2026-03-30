# Security Assessment: Markdown chapter rendering correctness (#29)

**Date:** 2026-03-30
**Architecture reviewed:** `docs/architecture/29-architecture.md`
**Risk level:** Low

## Executive Summary
The proposed architecture is low risk because it stays inside the existing local-only transform pipeline and does not introduce new network services, authentication surfaces, secret handling, or privileged operations. The main security concerns are output safety and determinism: chapter-mode links, anchors, and heading extraction must remain constrained to canonical relative paths or exact `https://uscode.house.gov/` fallbacks. The architecture addresses those concerns well with centralized pure helpers, a writer-owned section target map, and explicit fallback URL rules.

## Findings

### [LOW] Validate canonicalization boundaries for section identifiers before link emission
- **Category:** Tampering / Input Validation
- **Component:** `src/domain/normalize.ts`, `src/transforms/markdown.ts`, `src/transforms/write-output.ts`
- **Description:** The transform consumes upstream XML and uses section identifiers to derive embedded anchors, fallback URLs, and local chapter targets. The architecture correctly centralizes this logic, but implementation must ensure only normalized section identifiers are used when building anchors and relative href fragments.
- **Impact:** If normalization is inconsistently applied, malformed identifiers could produce broken links, mismatched anchors, or renderer drift between emitted anchors and rewritten cross-references.
- **Recommendation:** Keep anchor and fallback generation in single pure helpers, validate/normalize section identifiers at the helper boundary, and add regression tests covering numeric, alphanumeric, hyphenated, and slash-containing identifiers (`411`, `125d`, `301-1`, `125/d`).

### [INFO] No new auth, secret, or external-service exposure introduced
- **Category:** Attack Surface / Data Classification
- **Component:** Whole feature
- **Description:** This change remains a local batch transform with filesystem output only. It does not add HTTP endpoints, webhooks, background workers, credentials, tokens, or sensitive-data storage.
- **Impact:** The feature does not materially expand the repository's attack surface beyond existing XML ingestion and markdown generation.
- **Recommendation:** Preserve the current local-only design and avoid adding remote lookups or dynamic link-resolution services for this feature.

### [INFO] Deterministic output is the key safety property for this change set
- **Category:** Tampering / Repudiation
- **Component:** `src/transforms/uslm-to-ir.ts`, `src/transforms/markdown.ts`, `src/domain/normalize.ts`
- **Description:** The architecture emphasizes deterministic heading extraction, anchor generation, and chapter target mapping. For a static-content generator, this is the main control that makes broken-link and malformed-output regressions detectable in tests and code review.
- **Impact:** Deterministic rendering reduces the chance of silent correctness regressions and makes output diffs auditable across repeated runs.
- **Recommendation:** Keep the pure-helper design, lock exact output contracts with tests, and ensure ordered/non-ordered parse paths share the same heading-extraction helper.

## Threat Modeling Notes
- **Spoofing:** No user/session/service identity boundary is introduced.
- **Tampering:** Primary risk is malformed upstream XML influencing emitted markdown links or anchors; mitigated by centralized normalization and exact fallback URL rules.
- **Repudiation:** Normal git history and deterministic output provide sufficient traceability for this batch transform change.
- **Information Disclosure:** No sensitive or internal-only data classes are introduced; output content remains public legal text plus repository-relative links.
- **Denial of Service:** No new service surface is added. The change does not materially alter runtime characteristics beyond modest pure-rendering work.
- **Elevation of Privilege:** No privilege boundary or authorization model exists in scope.

## Data Classification
- **Public:** US Code source text, generated markdown, canonical public `uscode.house.gov` URLs.
- **Internal:** Test fixtures, repo-local transform logs if any.
- **Secrets / PII / Financial:** None in scope.

Items that should never be logged: none newly introduced by this feature beyond standard avoidance of dumping unrelated local filesystem state.

## Auth/Authz Review
Not applicable. The feature adds no authentication, authorization, token, or session handling.

## Dependency Risk Review
No new dependencies are proposed. The architecture appropriately keeps the change within the existing TypeScript/Vitest/`fast-xml-parser`/`gray-matter` stack, which limits supply-chain expansion.

## Encryption Requirements
Not applicable for the feature itself. No in-transit or at-rest sensitive-data flows are introduced.

## Attack Surface Review
- **Public endpoints:** None.
- **Admin interfaces:** None.
- **Internal APIs:** In-process module calls only.
- **Webhooks:** None.
- **External destinations allowed by contract:** repository-relative markdown links and exact `https://uscode.house.gov/view.xhtml?...` URLs only.

## Compliance Considerations
No new GDPR, PCI-DSS, HIPAA, or SOC 2 concerns are introduced. The feature operates on public legal text and local generated artifacts.

## Verdict

**Status:** APPROVED

- [x] All Critical findings addressed
- [x] All High findings addressed
- [x] Medium findings tracked
