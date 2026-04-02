# Security Assessment: GitHub-safe renderer output for anchors, cross-references, notes, and embedded acts (#31)

**Date:** 2026-04-02
**Architecture reviewed:** `docs/architecture/31-architecture.md`
**Risk level:** Low

## Executive Summary
The proposed architecture is low risk because it stays inside the existing local-only XML-to-markdown transform pipeline and does not introduce new services, credentials, authentication flows, or privileged runtime behavior. The main security concerns are output integrity and raw-markup containment: untrusted XML must not be able to expand the raw HTML surface, break canonical link generation, or escape note scope into false top-level sections. The architecture addresses those concerns well with a narrow HTML allowlist, centralized canonical URL generation, and ancestor-aware parser boundaries.

## Findings

### [LOW] Keep note-table rendering on a markdown-safe escaping boundary
- **Category:** Tampering / Input Validation
- **Component:** `src/transforms/uslm-to-ir.ts`, `src/transforms/markdown.ts`
- **Description:** The architecture correctly requires note tables to render as plain markdown tables instead of raw HTML. During implementation, table cell text still comes from untrusted XML and may contain characters such as `|`, line breaks, or markdown-significant sequences that can break column boundaries if emitted verbatim.
- **Impact:** Incorrect escaping could let malformed upstream content corrupt rendered table structure, collapse adjacent prose/table boundaries, or produce misleading markdown output that no longer matches the source table layout.
- **Recommendation:** Treat markdown-table emission as its own sanitization boundary: normalize cell text to single-line table-safe content, escape literal pipe characters and other markdown-breaking sequences as needed, and add regression tests covering cells with punctuation, inline refs, empty values, and embedded separators.

### [INFO] Raw HTML exposure remains appropriately constrained to normalized anchor tags
- **Category:** Information Disclosure / Input Validation
- **Component:** `src/transforms/markdown.ts`, `src/domain/normalize.ts`
- **Description:** The only raw HTML introduced by the architecture is the exact `<a id="section-..."></a>` anchor line emitted before embedded section headings. The architecture also keeps `embeddedSectionAnchor()` as the sole source of the `id` value and explicitly forbids arbitrary HTML passthrough for note and table content.
- **Impact:** This keeps GitHub-rendered output predictable and prevents the feature from expanding into a general raw-HTML rendering surface.
- **Recommendation:** Preserve the current allowlist exactly: only emit anchor tags, only emit the `id` attribute, and keep all note/table output in markdown form.

### [INFO] Deterministic parser boundaries are the primary integrity control for embedded-Act containment
- **Category:** Tampering / Repudiation
- **Component:** `src/transforms/uslm-to-ir.ts`
- **Description:** The highest-value control in this change is not secrecy but deterministic classification: only true codified title/body sections may enter `titleIr.sections`, while note-scoped embedded Acts must remain attached to their parent note blocks. The architecture makes that boundary explicit and testable.
- **Impact:** Deterministic section discovery prevents silent output corruption where non-codified material is promoted into authoritative-looking top-level sections.
- **Recommendation:** Keep section discovery ancestor-aware, assert stable top-level section counts in fixtures containing embedded Acts, and ensure note serialization preserves source order so misclassification is immediately visible in tests and diffs.

## Threat Modeling Notes
- **Spoofing:** No user, service, or identity boundary is introduced.
- **Tampering:** Primary risk is untrusted XML influencing anchors, links, notes, or table structure; mitigated by centralized normalization, markdown-only note/table rendering, and explicit note-vs-section parser boundaries.
- **Repudiation:** Deterministic output and normal git history provide sufficient auditability for this batch transform change.
- **Information Disclosure:** No new secret, PII, or privileged data flow is introduced; output remains public legal text and public OLRC URLs.
- **Denial of Service:** No new network or service surface is added. Runtime cost increases are limited to local parsing/rendering work already bounded by existing fixtures and test flow.
- **Elevation of Privilege:** No authorization or privilege boundary exists in scope.

## Data Classification
- **Public:** U.S. Code source text, note content, generated markdown, canonical `uscode.house.gov` links.
- **Internal:** Test fixtures, local repo artifacts, transform logs if present.
- **Secrets / PII / Financial:** None in scope.

Items that should never be logged: no new sensitive classes are introduced by this feature. Continue avoiding any arbitrary raw XML dumps in failure logs beyond existing repo practice.

## Auth/Authz Review
Not applicable. The feature adds no authentication, authorization, tokens, sessions, or role model.

## Dependency Risk Review
No new dependencies are proposed. Keeping the work inside the existing TypeScript, Vitest, `fast-xml-parser`, and `gray-matter` stack avoids expanding the supply-chain surface.

## Encryption Requirements
Not applicable for the feature itself. No new in-transit or at-rest sensitive-data flows are introduced.

## Attack Surface Review
- **Public endpoints:** None.
- **Admin interfaces:** None.
- **Internal APIs:** In-process module calls only.
- **Webhooks:** None.
- **External destinations allowed by contract:** exact canonical `https://uscode.house.gov/view.xhtml?...` URLs emitted as text only.

## Compliance Considerations
No new GDPR, PCI-DSS, HIPAA, or SOC 2 concerns are introduced. The feature operates on public legal text and local generated artifacts.

## Verdict

**Status:** APPROVED

- [x] All Critical findings addressed
- [x] All High findings addressed
- [x] Medium findings tracked
