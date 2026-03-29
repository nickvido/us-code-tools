# Security Assessment: Git tags and GitHub Releases for legal milestones (#18)

**Date:** 2026-03-29
**Architecture reviewed:** docs/architecture/18-architecture.md
**Risk level:** Low

## Executive Summary
The proposed design has a small attack surface because it is a local CLI workflow with no new HTTP service, database, or long-lived credentials. The architecture already includes several strong safety controls: schema validation before mutation, no shell interpolation, fail-on-tag-conflict behavior, lock-file plus atomic manifest writes, and manifest freshness checks before any GitHub Release writes.

I did not identify any Critical or High risks that require spec or architecture rework. The main residual risks are implementation-phase concerns around subprocess path trust, local metadata/path disclosure in generated manifests and logs, and potential resource exhaustion from unbounded git diff output on large repositories.

## Findings

### [MEDIUM] Subprocess binary trust should be pinned to expected executables
- **Category:** Spoofing / Elevation of Privilege
- **Component:** `src/milestones/commit-selector.ts`, `src/milestones/tag-apply.ts`, `src/milestones/gh.ts`
- **Description:** The architecture depends on `git` and `gh` from `PATH`. In a hostile or misconfigured local environment, a substituted binary earlier in `PATH` could receive trusted metadata and target-repo arguments, causing unintended command execution or credential misuse.
- **Impact:** A local attacker or compromised shell environment could spoof the expected CLI tools and perform arbitrary actions under the operator's account, including incorrect tags/releases or GitHub token abuse.
- **Recommendation:** In implementation, resolve the executable path once at process start, log only the basename, and fail closed if the binary path is missing or suspicious. Prefer `execFile` with absolute executable paths after resolution (`which`/`command -v` equivalent), and document that CI/operator environments must provide trusted `git` and `gh` binaries.

### [MEDIUM] Generated manifest should minimize local path disclosure and be treated as internal metadata
- **Category:** Information Disclosure
- **Component:** `.us-code-tools/milestones.json`, stderr/debug logging
- **Description:** The manifest structure includes `target_repo.path` as an absolute filesystem path, and the architecture allows optional debug logging. While no secrets are introduced, local usernames, directory layouts, or mounted volume names may be exposed if the manifest is committed, attached to issues, or pasted into logs.
- **Impact:** Leaks of workstation path structure can aid follow-on social engineering or environment targeting and unnecessarily expose internal host details.
- **Recommendation:** Keep the manifest uncommitted in the target repo, treat it as internal-only operational state, and ensure debug/error output never prints environment variables, auth material, or full filesystem context unless explicitly requested. Consider storing both `path` and a redacted/display form, or documenting that the absolute path field is internal and must not be published.

### [LOW] Release rendering should cap or stream diff-stat subprocess output
- **Category:** Denial of Service
- **Component:** `src/milestones/release-renderer.ts`, `src/milestones/releases.ts`
- **Description:** `git diff --stat` is bounded compared with full patch output, but large repository states or unexpectedly broad tag spans can still produce substantial subprocess output. If implementation buffers unbounded stdout in memory, a malformed or unusually large repo could cause excessive memory use or noisy release bodies.
- **Impact:** CLI instability, failed release generation, or oversized GitHub Release notes.
- **Recommendation:** Use `--stat` only as specified, set subprocess output limits/timeouts, and truncate or fail deterministically if rendered diff-stat content exceeds a documented size ceiling suitable for GitHub Release bodies.

### [LOW] Lock-file recovery behavior should be deterministic for stale-crash scenarios
- **Category:** Denial of Service / Tampering
- **Component:** `src/milestones/lock.ts`
- **Description:** The architecture correctly uses exclusive creation plus `finally` cleanup, but it does not specify operator-facing behavior when a prior crash leaves a stale lock file behind.
- **Impact:** Operators may be blocked from legitimate `apply` runs until they manually inspect the repo, creating avoidable operational friction.
- **Recommendation:** Keep the default fail-closed behavior, but include lock payload fields already proposed (PID, hostname, timestamp, command) in the error text and document a manual recovery procedure. Do not auto-break locks in day-one scope.

### [INFORMATIONAL] Data classification is simple and favorable
- **Category:** Data Classification
- **Component:** Metadata, manifest, release bodies, GitHub integration
- **Description:** The system processes mostly public legal-history metadata plus internal operational metadata. The only sensitive material in scope is GitHub auth handled externally by `gh`, plus local filesystem paths in the manifest.
- **Impact:** Low inherent confidentiality risk if auth material stays outside repo-managed artifacts.
- **Recommendation:** Never log GitHub tokens, auth headers, environment dumps, or full `gh auth status` output. Treat manifest contents and debug logs as internal operational data.

### [INFORMATIONAL] No additional compliance burden is introduced
- **Category:** Compliance
- **Component:** Overall feature
- **Description:** This feature does not newly process regulated classes like PCI, health data, or broad user PII. It operates on public legal text metadata and local git state.
- **Impact:** GDPR/PCI/SOC2 implications are limited to standard engineering hygiene around credentials and auditability.
- **Recommendation:** Maintain normal repo access controls and credential hygiene; no special compliance redesign is needed for this issue.

## Verdict

**Status:** APPROVED

- [x] All Critical findings addressed
- [x] All High findings addressed
- [x] Medium findings tracked
