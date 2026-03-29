# Security Assessment: Zero-padded section filenames, rich metadata rendering, and recursive hierarchy traversal (#12)

**Date:** 2026-03-29
**Architecture reviewed:** `docs/architecture/12-architecture.md`
**Risk level:** Low

## Executive Summary
This architecture is low risk from a security perspective. It stays inside the existing single-process transform CLI, adds no new network endpoints, credentials, auth flows, or persistence layers, and primarily improves integrity by preventing silent section loss and by making filename/link generation deterministic.

I found no Critical or High issues that require a spec change or an architecture revision. The implementation-phase security work is mostly about preserving strict normalization boundaries so untrusted XML-derived values cannot influence paths, frontmatter, or markdown links in unsafe ways.

## Findings

### [MEDIUM] Untrusted XML-derived identifiers must be validated before reuse in paths, links, and frontmatter
- **Category:** Tampering / Input validation
- **Component:** `src/domain/normalize.ts`, `src/transforms/uslm-to-ir.ts`, `src/transforms/markdown.ts`, `src/transforms/write-output.ts`
- **Description:** The architecture correctly centralizes section split/pad/sort/file-stem logic and prohibits raw XML text from being interpolated directly into output paths. However, hierarchy numbers, section identifiers, and `/us/usc/...` reference targets still originate from untrusted XML. Once the architecture expands reuse of those values across filenames, relative links, and frontmatter keys, a single normalization bug would propagate into several output surfaces.
- **Impact:** Malformed or path-significant input could generate unsafe filenames, broken relative links, or ambiguous markdown/frontmatter output. In the worst case, later implementation drift could reopen path traversal or output-confusion bugs even if this issue does not intend to.
- **Recommendation:** Make the normalization helper family the only boundary allowed to convert XML-derived identifiers into file-safe/link-safe strings, and explicitly reject or sanitize path separators, traversal tokens, control characters, and YAML-significant edge cases before serialization. Add unit tests for hostile identifiers, not just well-formed USC examples.

### [LOW] Recursive traversal should preserve existing resource guardrails for malformed or adversarial XML
- **Category:** Denial of Service
- **Component:** `src/transforms/uslm-to-ir.ts`
- **Description:** The architecture replaces a shallow fixed walk with recursive traversal over the parsed tree. That is the correct functional design, but it slightly increases the chance of expensive processing if malformed or unexpectedly large XML creates unusually deep or repetitive container structures.
- **Impact:** Local transform runs could consume excess CPU or memory on corrupted inputs, especially during full-title matrix testing.
- **Recommendation:** Keep traversal single-pass, avoid reparsing or repeated subtree scans, and preserve any current file-size/parse-failure safeguards. If practical, document an expected maximum recursion depth or implement traversal iteratively if future fixtures demonstrate depth concerns.

### [LOW] Rich metadata rendering needs explicit output-encoding discipline
- **Category:** Information Disclosure / Output encoding
- **Component:** `src/transforms/markdown.ts`
- **Description:** The feature adds `source_credit`, hierarchy frontmatter fields, and a `## Statutory Notes` section sourced from XML text. The data is public legal content, not secrets, but it still crosses a trust boundary into YAML frontmatter and markdown where delimiter collisions or unescaped content can break document structure.
- **Impact:** Broken markdown rendering, malformed frontmatter, or misleading links/notes in generated outputs.
- **Recommendation:** Rely on structured frontmatter serialization rather than manual YAML string assembly, normalize line breaks, and test values containing quotes, colons, brackets, and markdown-link-significant characters so rendered documents remain structurally sound.

### [INFO] No new auth, secret, privacy, or compliance surface is introduced
- **Category:** Data classification / Auth/Authz / Compliance
- **Component:** Whole feature
- **Description:** This issue introduces no HTTP endpoints, sessions, tokens, service-to-service calls, or new storage systems. The processed data is public legislative material plus internal test/output artifacts.
- **Impact:** Minimal confidentiality or compliance expansion. GDPR, PCI-DSS, and similar frameworks are not materially implicated by this change.
- **Recommendation:** Continue to avoid logging raw unbounded XML blobs or full generated output payloads unnecessarily.

## STRIDE Summary
- **Spoofing:** Not materially applicable; no identity boundary or remote caller surface is introduced.
- **Tampering:** Primary risk is untrusted XML influencing normalized identifiers, paths, and link targets; mitigate with a single validated helper boundary.
- **Repudiation:** Low concern in a local CLI workflow; git history, fixtures, and test output provide adequate traceability.
- **Information Disclosure:** Low; inputs are public legal texts and no secrets are introduced.
- **Denial of Service:** Limited to local parser/traversal resource consumption on malformed or oversized XML.
- **Elevation of Privilege:** Not applicable; the feature adds no privilege boundary, auth model, or role system.

## Auth/Authz Design
Not applicable for this feature. The architecture does not add user authentication, sessions, roles, API keys, or service-to-service trust relationships.

## Data Classification
- **Public:** OLRC/USLM XML, generated USC markdown, schema references, test fixtures.
- **Internal:** Parse diagnostics, integration test output, local build/CI logs.
- **PII:** None identified.
- **Secrets:** None identified.
- **Financial:** None identified.

**Should never be logged:** full raw XML blobs without truncation, unsanitized malformed identifiers, or excessively large rendered markdown payloads.

## Input Validation Strategy
Primary trust boundary: XML input into the transform pipeline.

Required validation expectations from the architecture:
- Treat section numbers, hierarchy values, and reference identifiers as untrusted until normalized.
- Use one shared pure helper family for section split/pad/sort/file-stem generation.
- Generate markdown links only for recognized `/us/usc/t{title}/s{section}` references.
- Fall back to plain text for malformed or unrecognized refs.
- Omit empty/invalid metadata fields rather than serializing ambiguous output.

## Dependency Risk Notes
- **`fast-xml-parser` (`^4.5.0`)**: existing dependency and appropriate for this scope; main risk remains trusting parsed values too early.
- **`gray-matter` (`^4.0.3`)**: existing dependency and preferred over manual frontmatter construction.
- **`vitest` (`^3.0.0`)**: existing test dependency; no new meaningful risk introduced.

The architecture wisely adds no new dependencies, which minimizes supply-chain expansion.

## Encryption Requirements
Not materially applicable. This feature does not introduce network transport, external service calls, or storage of sensitive data requiring encryption-at-rest controls beyond normal host filesystem protections.

## Attack Surface
- **Public endpoints:** None.
- **Admin interfaces:** None.
- **Internal APIs:** In-process parser/renderer/file-output module boundaries only.
- **Webhooks:** None.

Primary exposed surface is local processing of XML fixtures/cached XML into markdown and file paths.

## Compliance Considerations
No material new compliance scope identified. The data is public legal text, and the architecture does not expand personal-data handling, payment processing, or regulated identity flows.

## Verdict

**Status:** APPROVED

- [x] All Critical findings addressed
- [x] All High findings addressed
- [x] Medium findings tracked
