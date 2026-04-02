# Security Assessment: GitHub-safe nested subsection rendering for markdown output (#36)

**Date:** 2026-04-02
**Architecture reviewed:** `docs/architecture/36-architecture.md`
**Risk level:** Low

## Executive Summary
The proposed architecture is low risk because it keeps the change inside the existing local-only IR-to-markdown renderer and does not introduce new services, credentials, trust boundaries, or privileged execution paths. The main security concern is output integrity: malformed or hostile source content must not be able to trigger GitHub code-block rendering in a way that misrepresents legal text. The architecture addresses that concern well by keeping the parser and IR stable, scoping the change to renderer logic, and making GitHub-safe formatting a testable output contract.

## Findings

### [LOW] Treat blank-line and continuation handling as part of the same integrity boundary as nested labels
- **Category:** Tampering / Input Validation
- **Component:** `src/transforms/markdown.ts`
- **Description:** The architecture correctly identifies four-space indentation as the core rendering hazard for nested labels such as `(i)` and `(ii)`. The same hazard applies to continuation/body lines emitted between labeled descendants: if implementation fixes label lines but leaves continuation lines with four or more leading literal spaces in affected hierarchies, GitHub can still render parts of the statute as code blocks or visually detach prose from the label it belongs to.
- **Impact:** Rendered legal text could still be misleading even after the label fix, causing downstream readers to see altered structure or apparent quoted/code content instead of ordinary statutory prose.
- **Recommendation:** Keep continuation/body-line indentation under the same centralized renderer policy as nested label emission, and add explicit negative tests for both `\n    (i)`-style labels and standalone continuation lines beginning with four spaces inside affected hierarchies.

### [INFO] Renderer-only scope appropriately avoids expanding the attack surface
- **Category:** Attack Surface / Dependency Risk
- **Component:** `src/transforms/markdown.ts`, `tests/unit/transforms/markdown.test.ts`
- **Description:** The architecture keeps the fix inside the existing markdown renderer and test suite, with no parser schema change, no new dependencies, no subprocesses, and no network or filesystem activity beyond the current local toolchain.
- **Impact:** This substantially limits the chance of introducing new security-sensitive behavior such as supply-chain growth, secret handling, or unauthorized output destinations.
- **Recommendation:** Preserve this narrow scope during implementation; avoid post-processing regex passes, markdown AST dependencies, or parser changes unless a later issue proves they are necessary.

### [INFO] Existing IR-label preservation is the key authenticity control
- **Category:** Tampering
- **Component:** `src/transforms/uslm-to-ir.ts`, `src/transforms/markdown.ts`
- **Description:** The architecture explicitly requires label text to continue deriving from the current IR and existing `formatLabel()` behavior, with no renumbering, normalization, or synthesis. For public legal-text rendering, authenticity of labels is more important than stylistic normalization.
- **Impact:** Keeping label generation deterministic prevents the renderer from accidentally changing the apparent legal hierarchy while trying to fix markdown layout.
- **Recommendation:** Add or retain tests that demonstrate nested output uses the exact IR-provided labels across numeric, alphabetic, and roman-numeral cases.

## Threat Modeling Notes
- **Spoofing:** No identity, session, or service-impersonation boundary is introduced.
- **Tampering:** Primary risk is source-driven markdown structure corruption; mitigated by column-0 bold labels for nested descendants, bounded continuation indentation, and exact output assertions.
- **Repudiation:** Normal git history and deterministic tests are sufficient audit controls for this local transform change.
- **Information Disclosure:** No secrets, credentials, PII, or private datasets are introduced; input and output remain public legal text and local repo artifacts.
- **Denial of Service:** No new network/service surface is added. Traversal remains in-memory and should stay linear in content-tree size.
- **Elevation of Privilege:** No authorization or privilege boundary exists in scope.

## Data Classification
- **Public:** U.S. Code source text, IR-derived labels, generated markdown, fixture outputs.
- **Internal:** Test files, snapshots, local build artifacts, repo metadata.
- **Secrets / PII / Financial:** None in scope.

Items that should never be logged: no new sensitive classes are introduced. Continue avoiding unnecessary full-document dumps in failing tests or debug logs when targeted assertions are sufficient.

## Auth/Authz Review
Not applicable. The feature adds no authentication, authorization, tokens, sessions, API keys, or role model.

## Input Validation Review
- **Trust boundary:** Parsed USLM/IR content entering markdown rendering.
- **Validation strategy:** Constrain formatting behavior at the renderer boundary rather than relying on ad hoc cleanup after full document assembly.
- **Key invariant:** In affected nested hierarchies, rendered labeled lines must begin with `**(` at column 0 and continuation/body lines must remain below the four-space code-block threshold.

## Dependency Risk Review
No new dependencies are proposed. The architecture stays within the existing TypeScript/Vitest/`fast-xml-parser`/`gray-matter` stack, which keeps supply-chain risk unchanged from the current repository baseline.

## Encryption Requirements
Not applicable for this feature. No new in-transit or at-rest sensitive-data flow is introduced.

## Attack Surface Review
- **Public endpoints:** None.
- **Admin interfaces:** None.
- **Internal APIs:** In-process function calls only.
- **Webhooks:** None.
- **External systems:** None added by this change.

## Compliance Considerations
No new GDPR, PCI-DSS, HIPAA, or SOC 2 implications are introduced. The feature operates on public legal text and local generated artifacts only.

## Notes on Repository Inputs
The requested `.dark-factory/config.yaml` file was not present in this worktree. The assessment therefore used the checked-in architecture/spec documents and repository metadata (`package.json`, existing architecture/security docs) as the authoritative implementation context.

## Verdict

**Status:** APPROVED

- [x] All Critical findings addressed
- [x] All High findings addressed
- [x] Medium findings tracked
