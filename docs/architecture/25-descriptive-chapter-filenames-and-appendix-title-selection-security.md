# Security Assessment: Descriptive chapter filenames and appendix title selection (#25)

**Date:** 2026-03-29
**Architecture reviewed:** `docs/architecture/25-architecture.md`
**Risk level:** Low

## Executive Summary
The proposed architecture keeps this feature inside the existing single-process local CLI, reuses the current OLRC cache path, and adds explicit normalization boundaries for both title selectors and chapter-derived filenames. That is a good security posture for this scope: the main security risks are path manipulation, filename collisions, and inconsistent link/path derivation, and the architecture addresses those with allowlisting, centralized normalization, and collision-before-write behavior.

I did not identify any Critical or High findings. The remaining concerns are implementation-quality items around atomicity of chapter writes, diagnostic hygiene, and test coverage for appendix artifact normalization.

## Findings

### [MEDIUM] Partial-write behavior remains possible on non-collision write failures
- **Category:** Tampering / Denial of Service
- **Component:** `src/transforms/write-output.ts`
- **Description:** The architecture requires pre-write collision detection for descriptive chapter filenames, but it still preserves the existing behavior where a write failure after some files have already been emitted can leave a partially-written output tree. This is explicitly acknowledged in the spec edge cases, but it still creates an integrity risk for downstream consumers that may read a mixed old/new tree after a failed run.
- **Impact:** A caller or automation pipeline could consume incomplete or inconsistent output after a filesystem error, permission problem, or interrupted write, producing hard-to-diagnose downstream failures.
- **Recommendation:** In implementation, either (a) stage each target into a temporary directory and rename it into place only after success, or (b) document and test a clear cleanup/overwrite contract so partial output cannot be mistaken for a successful target. If full atomic replacement is intentionally out of scope, at minimum emit a prominent warning on partial-write failures.

### [LOW] Appendix artifact name normalization needs explicit case-handling tests
- **Category:** Input Validation / Tampering
- **Component:** `src/sources/olrc.ts`
- **Description:** The architecture correctly requires appendix-aware cache resolution using existing artifact names such as `usc05A.xml` and `usc11a.xml`, but the corpus examples show mixed appendix-suffix casing. Without explicit test coverage at the cache lookup boundary, an implementation could normalize selector input correctly while still missing cached artifacts on case-sensitive filesystems.
- **Impact:** Appendix targets could fail unexpectedly, or developers could add ad hoc fallback logic later that broadens path matching beyond the intended allowlist.
- **Recommendation:** Add focused tests proving that each supported appendix selector resolves correctly against the exact cached artifact naming present in fixtures, including mixed-case appendix stems where relevant.

### [LOW] Error reporting should avoid echoing unsanitized raw selector/path input
- **Category:** Information Disclosure
- **Component:** `src/index.ts`, `src/transforms/write-output.ts`
- **Description:** The architecture calls for parse errors that mention accepted appendix selectors and collision errors that mention the colliding filename. That is appropriate, but implementation should ensure diagnostics report canonical normalized selectors and final safe filenames rather than arbitrary raw user input or raw filesystem paths.
- **Impact:** Low-risk log pollution or confusing diagnostics could occur if malformed raw inputs are echoed directly in machine-readable errors.
- **Recommendation:** Emit canonical selector values (`5A`, `11A`, etc.) and sanitized final filenames/relative paths in structured errors; avoid including uncontrolled raw input where not needed.

### [INFO] No new sensitive-data classes or auth surfaces are introduced
- **Category:** Data Classification / AuthN/AuthZ
- **Component:** Feature-wide
- **Description:** This feature remains a local filesystem CLI transformation. It does not introduce new secrets, tokens, sessions, remote admin interfaces, public endpoints, or PII processing.
- **Impact:** The architecture does not materially expand the repository's authentication or privacy attack surface.
- **Recommendation:** Keep it that way: do not add new appendix-specific network fetch flows, telemetry, or logging of source artifact contents as part of implementation.

### [INFO] Missing `.dark-factory/config.yaml` in the reviewed worktree
- **Category:** Review Scope / Governance
- **Component:** Repository configuration
- **Description:** The stage instructions referenced `.dark-factory/config.yaml`, but no such file exists in this worktree. The architecture document already notes that `.dark-factory.yml` is not present in the repo snapshot.
- **Impact:** No direct product-security impact for this issue, but it limits stage-specific configuration review and means the assessment is based on the repository source, package manifest, and architecture/spec documents only.
- **Recommendation:** None required for this issue. If the pipeline expects repo-local Dark Factory config in future stages, add it consistently or update stage instructions to reflect the repo reality.

## Threat Model Notes

### Trust boundaries
- CLI caller input (`--title`, `--all`, `--output`, `--group-by`) into `src/index.ts`
- Cached OLRC ZIP/XML artifacts into `src/sources/olrc.ts`
- Chapter headings and IDs from parsed XML/frontmatter-derived IR into filename generation
- Filesystem output writes under the user-selected output root

### STRIDE summary
- **Spoofing:** Low. No identity boundary or remote caller model is added.
- **Tampering:** Main risk is unsafe path derivation or inconsistent filename/link generation. Centralized selector normalization, slug normalization, and safe-path enforcement are appropriate mitigations.
- **Repudiation:** Low. This is a local CLI with stdout/stderr reports; no separate audit system is required.
- **Information Disclosure:** Low. No new sensitive data classes are introduced; diagnostics should stay sanitized.
- **Denial of Service:** Low/Medium. `--all` increases work volume, but serial deterministic execution avoids concurrency-amplified failure modes. Partial-write behavior is the main operational concern.
- **Elevation of Privilege:** Low. No authz model or privilege boundary changes are introduced.

## Auth/Authz Design
Not applicable for this issue. The feature does not introduce user accounts, sessions, tokens, roles, API keys, or service-to-service trust relationships.

## Data Classification
- **Public:** US Code source XML, generated markdown output, CLI reports
- **Internal:** Local error logs / diagnostics, cache-manifest state, filesystem output paths
- **Secrets:** None newly introduced
- **PII / Financial:** None in scope

### Should never be logged
- Raw arbitrary filesystem paths beyond what is necessary for actionable diagnostics
- Raw malformed selector input when canonical normalized values are sufficient

## Input Validation Strategy
The architecture has the right validation shape:
- Selector validation at the CLI boundary using a strict numeric/appendix allowlist
- Canonical normalization before cache lookup, report emission, and output path derivation
- Slugification of chapter headings before filename construction
- Final safe-path enforcement at the write boundary

That boundary placement is correct and should be preserved during implementation.

## Dependency Risk
No new dependencies are proposed. The architecture appropriately reuses the existing stack:
- `typescript` / `vitest`: actively maintained
- `fast-xml-parser`, `gray-matter`, `yauzl`: existing dependencies with no new privileged use introduced by this feature

Because no new package is needed for CLI parsing or slugification, this issue does not materially increase supply-chain risk.

## Encryption Requirements
Not applicable beyond normal transport security for any existing OLRC fetch path already in the repository. This issue introduces no new network surface, no stored secrets, and no new at-rest sensitive data requirements.

## Attack Surface
- **Public endpoints:** None
- **Admin interfaces:** None
- **Internal APIs:** In-process module boundaries only
- **Webhooks:** None
- **Filesystem attack surface:** User-provided output root and content-derived chapter headings influence write paths; centralized normalization plus safe-path checks are the critical controls

## Compliance Considerations
No new GDPR, PCI-DSS, HIPAA, or SOC 2 scope is introduced by this feature. The output consists of public legal text and local transform artifacts.

## Verdict

**Status:** APPROVED

- [x] All Critical findings addressed
- [x] All High findings addressed
- [x] Medium findings tracked
