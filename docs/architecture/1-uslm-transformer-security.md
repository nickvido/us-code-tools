# Security Assessment: USLM XML to Markdown Transformer (#1)

**Date:** 2026-03-28
**Architecture reviewed:** docs/architecture/1-architecture.md
**Risk level:** High

## Executive Summary
The proposed architecture has a solid baseline for a local file-based CLI: it keeps scope tight, avoids unnecessary services and secrets, uses HTTPS, applies atomic writes, and introduces explicit resource bounds for downloaded and extracted content. Most of the meaningful risks are correctly recognized as trust-boundary problems around CLI input, remote ZIP payloads, XML parsing, and output-path handling.

However, the current ZIP extraction design does not explicitly prohibit path traversal or special filesystem entries from untrusted archive contents. Because the source artifact is remote and the extractor is expected to handle nested paths, this is a high-severity local file write risk that should be fixed in the architecture before implementation begins.

## Findings

### [HIGH] ZIP extraction contract does not forbid path traversal or special entries
- **Category:** Tampering / Elevation of Privilege
- **Component:** `src/sources/olrc.ts`, `src/utils/zip.ts`, extraction workspace flow
- **Description:** The architecture requires extracting XML files from a remote ZIP and supports nested archive paths, but it does not define mandatory protections against dangerous entry names or entry types. There is no explicit requirement to reject entries containing `..`, absolute paths, drive-letter paths, symlinks, hardlinks, or other special filesystem objects before materializing files into the temp extraction workspace.
- **Impact:** A compromised upstream archive, malicious mirror, or incorrectly trusted ZIP could cause writes outside the intended temp directory and overwrite arbitrary files accessible to the local user. In the worst case this can corrupt repository files, shell config, SSH material, or other local state on the machine running the CLI.
- **Recommendation:** Revise the architecture to make ZIP handling non-negotiably safe: do not blindly extract the archive; instead enumerate entries and materialize only regular `.xml` file entries after canonicalizing each entry path, rejecting absolute paths, `..` segments, path separators that escape the workspace, symlinks/hardlinks, and duplicate normalized destinations. Require a post-resolution check that every extracted path remains under the designated extraction root.

### [MEDIUM] Cache trust model lacks authenticated source verification beyond transport security
- **Category:** Spoofing / Supply Chain
- **Component:** Cache manifest and OLRC download boundary
- **Description:** The cache design validates local consistency with a manifest and SHA-256 of the downloaded artifact, but that checksum is generated after download and therefore does not authenticate the artifact against an external trusted digest. The architecture assumes HTTPS to `uscode.house.gov` is sufficient.
- **Impact:** If the upstream source or transport trust is compromised, a malicious ZIP could still be accepted as long as it is internally consistent and parseable.
- **Recommendation:** Keep HTTPS as the baseline, but document that the SHA-256 in cache is only an integrity check for local corruption/replay, not authenticity. If OLRC ever publishes authoritative digests or signatures, prefer verifying against them. Until then, ensure logs clearly record source URL, content-type mismatch, and ZIP validation failures for operator review.

### [MEDIUM] XML parser hardening is described generally but not pinned to concrete parser-safe settings
- **Category:** Input Validation / Denial of Service
- **Component:** `src/transforms/uslm-to-ir.ts`
- **Description:** The architecture says the parser must not execute external entities or resolve remote references, which is directionally correct, but it does not specify concrete `fast-xml-parser` configuration constraints or expectations around attribute handling, entity processing, and maximum text/node growth.
- **Impact:** Ambiguous parser hardening requirements make it easier for implementation to drift into unsafe or unexpectedly expensive parsing behavior, especially when malformed XML fixtures are added later.
- **Recommendation:** Amend the architecture with a concrete safe parser configuration baseline and require tests that prove malformed XML, oversized text nodes, and unexpected structures become bounded parse errors instead of crashes or unbounded memory growth.

### [LOW] Output path policy should explicitly address symlink traversal in the target directory tree
- **Category:** Tampering
- **Component:** `src/transforms/write-output.ts`
- **Description:** The architecture correctly requires resolved output paths to remain under the requested base path, but it does not say how to handle symlinked intermediate directories inside that base path.
- **Impact:** In unusual local setups, writing through symlinked directories could place outputs somewhere the operator did not intend.
- **Recommendation:** During implementation, resolve the output root once, reject non-directory roots, and either forbid symlinked intermediate directories for emitted files or document that the output root is trusted operator-controlled state.

### [INFO] Data classification is simple and low sensitivity for this phase
- **Category:** Data Classification
- **Component:** Whole system
- **Description:** This phase handles public statutory text, local cache metadata, local logs, and parse error details. No PII, secrets, payment data, or user-authenticated sessions are introduced by the approved scope.
- **Impact:** Compliance exposure is low for this ticket, and there are no special encryption-at-rest requirements beyond normal host protections.
- **Recommendation:** Keep logs free of secrets if future authenticated sources are added, but for this issue the main logging concern is avoiding unnecessary dumping of full XML payloads or filesystem internals into stderr.

### [INFO] Attack surface remains intentionally small
- **Category:** Attack Surface
- **Component:** Whole system
- **Description:** The architecture avoids a database, HTTP API, background workers, webhooks, and browser-facing components. The only exposed surfaces are local CLI invocation, outbound HTTPS to OLRC, local filesystem writes, and test fixtures.
- **Impact:** Smaller attack surface materially reduces security complexity and makes a local CLI reviewable.
- **Recommendation:** Preserve this simplicity in implementation; do not add daemon modes, telemetry SDKs, or network listeners in this issue.

## Verdict

**Status:** REVISION

- [x] All Critical findings addressed
- [ ] All High findings addressed
- [x] Medium findings tracked
