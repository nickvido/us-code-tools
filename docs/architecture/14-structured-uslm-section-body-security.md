# Security Assessment: Complete structured USLM section-body rendering (#14)

**Date:** 2026-03-29
**Architecture reviewed:** `docs/architecture/14-architecture.md`
**Risk level:** Low

## Executive Summary
This architecture is low risk from a security perspective. It stays inside the existing single-process transform CLI, adds no new network endpoints, credentials, authentication surfaces, or persistence layers, and mainly improves output integrity by preventing silent loss of statutory text.

I found no Critical or High issues that require a spec rethink or an architecture revision. The main implementation-phase security concerns are input-boundary discipline for untrusted XML text, output encoding safety for markdown serialization, and keeping parser/renderer traversal bounded and deterministic.

## Findings

### [MEDIUM] Untrusted XML body text still crosses a trust boundary into generated markdown
- **Category:** Tampering / Input validation
- **Component:** `src/transforms/uslm-to-ir.ts`, `src/transforms/markdown.ts`
- **Description:** The architecture correctly treats this as a transform-only change, but it increases the amount of XML-derived text that will now be preserved and emitted into markdown (`chapeau`, inline body text, continuation text, and deeper hierarchy levels). That content is public legal text, but it is still untrusted input crossing into an output format that has structural syntax.
- **Impact:** If implementation shortcuts bypass existing normalization and structured serialization boundaries, malformed XML content could break markdown structure, produce misleading rendered output, or reopen output-confusion bugs that were previously masked by dropped text.
- **Recommendation:** Keep all body-text extraction routed through the existing normalization helpers, avoid manual string interpolation for frontmatter-like structures, and add regression tests covering delimiter-heavy content (quotes, brackets, colons, semicolons, markdown-link-significant characters, XML entities, and mixed inline refs/text).

### [LOW] Preserve single-pass traversal and resource guardrails for deep or malformed XML
- **Category:** Denial of Service
- **Component:** `src/transforms/uslm-to-ir.ts`
- **Description:** Supporting the full hierarchy from `subsection` through `subitem` is the right design, but it expands recursive/iterative traversal coverage across more nested structures and ordered-content cases.
- **Impact:** Corrupted or adversarial XML could increase CPU or memory usage during local transform runs or CI if the implementation repeatedly rescans subtrees or concatenates large strings inefficiently.
- **Recommendation:** Keep parsing/rendering single-pass where practical, reuse one canonical hierarchy table, avoid repeated subtree walks for `chapeau`/children/`continuation`, and preserve any existing size/parse guards. Fixture tests should include at least one deep-nesting case to validate bounded behavior.

### [LOW] Continuation and ordered-parent text need explicit sibling-isolation tests
- **Category:** Tampering / Integrity
- **Component:** `src/transforms/uslm-to-ir.ts`, `src/transforms/markdown.ts`, test suites
- **Description:** The architecture correctly identifies ordered rendering as the core integrity rule: `chapeau -> parent inline body -> nested children -> continuation`. The main correctness/security-adjacent risk is not confidentiality, but mis-association of text across siblings when reconstructing ordered containers.
- **Impact:** A buggy implementation could attach continuation text to the wrong subsection/paragraph, silently altering the apparent meaning of statutory content while still producing syntactically valid markdown.
- **Recommendation:** Add fixture-backed assertions that continuation text appears after the correct parent’s nested child block and never under an adjacent sibling. Treat these as hard regression tests, not informal spot checks.

### [INFO] No new auth, secret, privacy, or compliance surface is introduced
- **Category:** Data classification / Auth/Authz / Compliance
- **Component:** Whole feature
- **Description:** The feature introduces no HTTP endpoints, sessions, tokens, roles, cookies, service-to-service trust, or sensitive-data stores. Inputs are public USLM/OLRC legal texts plus local fixtures and generated markdown.
- **Impact:** Minimal confidentiality, privacy, or regulatory expansion.
- **Recommendation:** Continue avoiding logs that dump entire raw XML documents or large rendered outputs unnecessarily.

## STRIDE Summary
- **Spoofing:** Not materially applicable; no new identity boundary or remote caller surface is introduced.
- **Tampering:** Primary risk is output-integrity corruption from mishandled XML-derived text ordering or markdown serialization.
- **Repudiation:** Low concern in a local CLI workflow; git history, fixture diffs, and test output provide adequate traceability.
- **Information Disclosure:** Low; processed content is public legal text and no secrets are introduced.
- **Denial of Service:** Limited to local parser/render resource consumption on malformed or unexpectedly deep XML.
- **Elevation of Privilege:** Not applicable; no privilege boundary, role system, or auth mechanism is added.

## Auth/Authz Design
Not applicable for this feature. The architecture does not add authentication, sessions, roles, API keys, or service-to-service trust relationships.

## Data Classification
- **Public:** USLM/OLRC XML content, schema references, generated markdown, checked-in fixtures.
- **Internal:** Build logs, test output, parse diagnostics.
- **PII:** None identified.
- **Secrets:** None identified.
- **Financial:** None identified.

**Should never be logged:** full unbounded raw XML payloads, malformed XML snippets containing control characters without sanitization, or excessively large rendered markdown blobs.

## Input Validation Strategy
Primary trust boundary: XML input into the parser/renderer pipeline.

Required validation expectations from the architecture:
- Treat all XML-derived body text, labels, headings, and references as untrusted until normalized.
- Reuse the existing normalization helpers rather than inventing new ad hoc whitespace/string handling paths.
- Preserve document order using a single canonical hierarchy/ordered-content implementation to reduce drift.
- Fall back safely when inline body text is missing rather than throwing or attaching text to the wrong sibling.
- Keep fixture tests focused on completeness, determinism, and sibling isolation.

## Dependency Risk Notes
- **`fast-xml-parser` (`^4.5.0`)**: appropriate existing dependency for preserve-order parsing; main risk is incorrect handling of parsed values, not the architectural choice to keep it.
- **`gray-matter` (`^4.0.3`)**: existing dependency and preferred over manual YAML/frontmatter assembly.
- **`vitest` (`^3.0.0`)**: existing test dependency and sufficient for deterministic fixture-backed regression coverage.
- **`yauzl` (`^3.1.0`)**: present in the repository but not materially affected by this feature.

The architecture wisely adds no new dependencies, minimizing supply-chain expansion.

## Encryption Requirements
Not materially applicable. This feature does not introduce network transport, external service calls, or sensitive data storage requiring additional encryption controls beyond normal host protections.

## Attack Surface
- **Public endpoints:** None.
- **Admin interfaces:** None.
- **Internal APIs:** In-process parser and markdown renderer only.
- **Webhooks:** None.

Primary exposed surface is local processing of XML fixtures/source documents into markdown output.

## Compliance Considerations
No material new compliance scope identified. The data is public legal text, and the architecture does not expand handling of personal data, payment data, or regulated identity flows.

## Notes on Review Inputs
- The requested `.dark-factory/config.yaml` was not present in this worktree.
- I reviewed the architecture document, the approved spec, repository dependency metadata, and the existing issue/review context available in-tree.

## Verdict

**Status:** APPROVED

- [x] All Critical findings addressed
- [x] All High findings addressed
- [x] Medium findings tracked
