# Security Assessment: Historical OLRC release-point fetch (#21)

**Date:** 2026-03-29
**Architecture reviewed:** docs/architecture/21-architecture.md
**Risk level:** Medium

## Executive Summary
The proposed design keeps the attack surface relatively small because this is still a local CLI workflow with no new server, database, or long-lived secret store. The architecture already makes several sound security choices: pre-discovery CLI validation, in-memory-only cookie handling, path-validation requirements, atomic manifest writes, and explicit rejection of manifest/log persistence for cookie material.

I did not identify any Critical or High findings that require sending the issue back to spec or architecture redesign. The main residual risks are implementation-phase concerns around resource exhaustion during large historical backfills, trust in untrusted upstream HTML/ZIP content, and unsupported concurrent writes against the same local cache/manifest.

## Findings

### [MEDIUM] Full historical backfill needs explicit disk-space and per-run resource guardrails
- **Category:** Denial of Service
- **Component:** `src/sources/olrc.ts`, local cache under `data/cache/olrc/vintages/`
- **Description:** The architecture correctly notes a 5-6 GB cache footprint and preserves ZIP/XML extraction ceilings, but `--all-vintages` materially increases total disk, network, and runtime cost versus the current latest-only workflow. Without implementation guardrails around free-space checks, per-vintage cleanup on failure, and deterministic handling of partially downloaded artifacts, an operator can exhaust local disk or leave large incomplete trees behind.
- **Impact:** Local disk exhaustion can interrupt runs, corrupt operator expectations, and potentially interfere with unrelated processes on the same workstation or CI runner.
- **Recommendation:** In implementation, add fail-fast preflight checks where feasible (at minimum warn when available space is clearly insufficient), ensure incomplete ZIPs are not left looking successful, and keep per-vintage failure cleanup deterministic. Document the expected storage footprint and that `--all-vintages` should be run only on hosts with adequate free disk.

### [MEDIUM] Unsupported concurrent execution should fail closed, not just be documented
- **Category:** Tampering / Denial of Service
- **Component:** `data/manifest.json`, shared `data/cache/olrc/` tree
- **Description:** The architecture explicitly states that concurrent OLRC invocations against the same `data/` directory are unsupported, but it stops at documentation and intentionally omits cross-process locking. Because this feature expands long-running historical fetch activity, the odds of overlapping runs increase, especially in CI or repeated operator invocations.
- **Impact:** Concurrent runs can race on manifest writes and shared cache directories, causing state loss, inconsistent per-vintage metadata, or partially overwritten artifacts that look trustworthy to later stages.
- **Recommendation:** Even if full concurrency support remains out of scope, implementation should fail closed with a lightweight lock file or equivalent single-writer guard around OLRC cache/manifest mutation. If that is intentionally deferred, the architecture should at least make fail-closed locking a follow-up requirement rather than relying only on operator discipline.

### [LOW] Releasepoint discovery must remain strict about trusted host and URL normalization
- **Category:** Spoofing / Tampering
- **Component:** OLRC listing parsing and releasepoint link collection
- **Description:** The architecture treats OLRC HTML as untrusted and requires vintage extraction plus lookup from discovered values, which is good. However, because discovery is HTML-scrape based, implementation still needs to ensure that only expected `https://uscode.house.gov/...` releasepoint/title ZIP targets are accepted and that malformed, cross-origin, or scheme-relative links are rejected.
- **Impact:** A compromised or unexpectedly altered listing page could direct the CLI to fetch unexpected content from a different host or path family.
- **Recommendation:** Normalize URLs against the expected OLRC base URL, require `https`, require the expected host, and reject links outside the known OLRC download path patterns before any ZIP request is made.

### [LOW] Log and manifest hygiene should also avoid leaking operator-local path structure unnecessarily
- **Category:** Information Disclosure
- **Component:** `data/manifest.json`, CLI logs/errors
- **Description:** The architecture already forbids cookie/header persistence and prefers repository-relative paths, which is the right baseline. Residual risk remains if implementation falls back to absolute paths in error/log output or stores debugging details that expose usernames, mount points, or other workstation-local structure.
- **Impact:** Internal environment details can leak through issue comments, CI logs, or shared artifacts even though no regulated data is involved.
- **Recommendation:** Keep persisted paths repo-relative wherever possible, redact absolute paths in user-facing errors unless explicitly requested, and ensure debug logging never dumps raw headers, HTML payloads, or full environment context.

### [INFORMATIONAL] Data classification remains simple and favorable
- **Category:** Data Classification
- **Component:** Overall feature
- **Description:** The system primarily processes public legislative ZIP/XML content plus internal operational metadata. The only sensitive material in scope is transient OLRC session cookie state, which the architecture correctly keeps in memory only.
- **Impact:** Confidentiality risk is low provided cookies, headers, and local debug context stay out of persisted artifacts.
- **Recommendation:** Treat manifest and logs as internal operational data, and never log cookies, `Set-Cookie` values, raw `Cookie` headers, or full request/response dumps.

### [INFORMATIONAL] No special regulatory compliance burden is introduced
- **Category:** Compliance
- **Component:** Overall feature
- **Description:** This change does not introduce payment data, health data, or broad user-account handling. It remains a workstation/CI CLI for public legal materials.
- **Impact:** GDPR/PCI-style obligations are not materially expanded beyond standard engineering hygiene.
- **Recommendation:** Maintain normal credential hygiene and repository access controls; no compliance-specific architectural redesign is needed for this issue.

## Verdict

**Status:** APPROVED

- [x] All Critical findings addressed
- [x] All High findings addressed
- [x] Medium findings tracked
