# Security Assessment: Constitution Backfill — Articles & Amendments as Backdated Commits (#3)

**Date:** 2026-03-28
**Architecture reviewed:** docs/architecture/3-architecture.md
**Risk level:** Low

## Executive Summary
The architecture is appropriately narrow for this phase: a local TypeScript CLI that renders trusted static constitutional text into a target git repository and creates deterministic historical commits. The revised design closes the main safety gaps by rejecting dirty repositories, rejecting populated non-git directories, constraining resume behavior to contiguous Constitution prefixes, and avoiding force-push or history rewrite behavior.

From a security perspective, the remaining concerns are implementation hardening details around path handling, logging discipline, and push-target trust rather than architecture blockers. No Critical or High findings remain.

## Findings

### [MEDIUM] Target path handling must hard-fail on symlink traversal and canonicalization mismatches
- **Category:** Tampering / Input Validation
- **Component:** `src/backfill/target-repo.ts`, renderer path application
- **Description:** The architecture says to reject “symlink surprises if unsafe” and to never write outside the resolved target root, but the implementation contract should treat this as mandatory rather than discretionary. Because `--target` and the target repo contents are untrusted inputs, symlinked roots or symlinked intermediate directories could otherwise redirect writes or git operations outside the intended repository.
- **Impact:** A malicious or misconfigured local path could cause Constitution files to be written outside the intended repo or permit mutation of unexpected filesystem locations.
- **Recommendation:** Resolve the canonical real path of the target root before execution, reject symlinked/non-directory roots that break containment expectations, and verify each output path remains under that canonical root after resolution. Treat any symlinked intermediate path component under `constitution/` as a deterministic preflight failure.

### [LOW] Push uses operator-configured remotes and should avoid leaking credential-bearing URLs in errors
- **Category:** Information Disclosure
- **Component:** `src/backfill/git-adapter.ts`
- **Description:** The architecture correctly delegates authentication to the operator’s existing git/SSH configuration and avoids introducing new secrets. However, git push failures can emit remote URLs or transport diagnostics that sometimes include embedded usernames or token-bearing HTTPS remotes.
- **Impact:** Verbose stderr or structured logs could disclose credential-adjacent information in CI logs or shared terminals.
- **Recommendation:** Sanitize push error reporting to avoid echoing full remote URLs or credential helper output. Log the remote name and high-level failure reason, not raw authenticated URLs or environment variables.

### [LOW] Prefix-identity checks must remain exact to prevent silent history spoofing
- **Category:** Spoofing / Repudiation
- **Component:** `src/backfill/target-repo.ts`, prefix detection logic
- **Description:** The architecture correctly requires matching deterministic commit metadata rather than relying only on file contents. That exactness is important because a repo could contain locally recreated commits with equivalent files but different authorship, dates, or messages.
- **Impact:** If prefix matching is implemented loosely, the tool could falsely trust a non-canonical history and resume from an invalid baseline, weakening provenance guarantees.
- **Recommendation:** Treat the minimum comparison tuple in the architecture as mandatory acceptance logic: author name, author email, author date, and full commit subject/body must all match the planned event before a commit counts toward the contiguous prefix.

### [INFO] Sensitive-data exposure is minimal for this phase
- **Category:** Data Classification
- **Component:** Whole system
- **Description:** The workflow handles primarily public constitutional text, repository metadata, local paths, and git status information. It does not introduce PII, payment data, tokens, sessions, or server-side secrets.
- **Impact:** Compliance burden is low and there is no meaningful new regulated-data footprint in this design.
- **Recommendation:** Keep logs bounded to operational metadata and avoid dumping full git environment blocks or credential-related stderr.

### [INFO] Attack surface is intentionally small and appropriate
- **Category:** Attack Surface
- **Component:** Whole system
- **Description:** The design remains a local CLI with no HTTP API, no daemon, no webhook receiver, no database, and no background service. Network activity is limited to an optional final `git push` against an already-configured remote.
- **Impact:** The limited attack surface materially reduces exposure and makes the design proportionate to the feature.
- **Recommendation:** Preserve this narrow scope during implementation; do not expand the feature into a service or introduce additional remote integrations in this ticket.

### [INFO] Dirty-tree and non-prefix-history rejection materially improve operator safety
- **Category:** Tampering
- **Component:** `src/backfill/target-repo.ts`, `src/backfill/orchestrator.ts`
- **Description:** The revised architecture explicitly rejects dirty working trees, populated non-git directories, detached HEAD states, unrelated histories, and internal gaps before any Constitution writes or commits occur.
- **Impact:** These controls reduce the chance of overwriting operator work, appending foundational history into the wrong repository state, or creating ambiguous recovery scenarios.
- **Recommendation:** Preserve these preflight checks as hard gates and cover each with integration tests.

## Verdict

**Status:** APPROVED

- [x] All Critical findings addressed
- [x] All High findings addressed
- [x] Medium findings tracked
