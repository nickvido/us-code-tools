# Architecture — Issue #18: Git tags and GitHub Releases for legal milestones

## Status
Approved-spec implementation architecture for a CLI-only feature in `us-code-tools`.

## 1. Data Model

This issue does **not** introduce a database. The authoritative persisted state is:

1. a committed metadata JSON file in this repository, and
2. a generated manifest JSON file inside the target downstream git repository.

That is the correct production design for this scope because the workflow is deterministic, single-operator, git-centric, and has no query patterns that justify adding a database.

### 1.1 Authoritative metadata file

**Path:** `docs/metadata/legal-milestones.json`

This file is committed to the `us-code-tools` repo and versioned with code review. It is the only normative input for annual snapshot metadata, Congress boundary metadata, and presidential inauguration metadata.

### 1.2 Generated target-repo manifest

**Path inside target repo:** `.us-code-tools/milestones.json`

This file is written only by `milestones apply`. `milestones release` must refuse to write GitHub Releases unless the manifest is present, valid, and fresh relative to the current metadata file and target repo tag state.

### 1.3 JSON schema contract

The implementation should keep the JSON schema in code as a single exported constant and validate the metadata before any git mutation.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://us-code-tools.dev/schemas/legal-milestones.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["annual_snapshots", "president_terms"],
  "properties": {
    "annual_snapshots": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "annual_tag",
          "snapshot_date",
          "release_point",
          "commit_selector",
          "congress",
          "president_term",
          "is_congress_boundary",
          "release_notes"
        ],
        "properties": {
          "annual_tag": {
            "type": "string",
            "pattern": "^annual\\/[0-9]{4}$"
          },
          "snapshot_date": {
            "type": "string",
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "release_point": {
            "type": "string",
            "pattern": "^PL [0-9]+-[0-9]+$"
          },
          "commit_selector": {
            "type": "string",
            "minLength": 1
          },
          "congress": {
            "type": "integer",
            "minimum": 1
          },
          "president_term": {
            "type": "string",
            "pattern": "^[a-z0-9-]+$"
          },
          "is_congress_boundary": {
            "type": "boolean"
          },
          "release_notes": {
            "type": "object",
            "additionalProperties": false,
            "required": ["scope", "notable_laws", "summary_counts", "narrative"],
            "properties": {
              "scope": {
                "type": "string",
                "enum": ["annual", "congress"]
              },
              "notable_laws": {
                "type": "array",
                "items": {
                  "type": "string",
                  "minLength": 1
                }
              },
              "summary_counts": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "titles_changed",
                  "chapters_changed",
                  "sections_added",
                  "sections_amended",
                  "sections_repealed"
                ],
                "properties": {
                  "titles_changed": { "type": "integer", "minimum": 0 },
                  "chapters_changed": { "type": "integer", "minimum": 0 },
                  "sections_added": { "type": "integer", "minimum": 0 },
                  "sections_amended": { "type": "integer", "minimum": 0 },
                  "sections_repealed": { "type": "integer", "minimum": 0 }
                }
              },
              "narrative": {
                "type": "string",
                "minLength": 1
              }
            }
          }
        }
      }
    },
    "president_terms": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["slug", "inauguration_date", "president_name"],
        "properties": {
          "slug": {
            "type": "string",
            "pattern": "^[a-z0-9-]+$"
          },
          "inauguration_date": {
            "type": "string",
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "president_name": {
            "type": "string",
            "minLength": 1
          }
        }
      }
    }
  }
}
```

### 1.4 Semantic validation rules beyond JSON Schema

These checks must run after schema validation and before any side effects:

1. `annual_tag` values are unique.
2. `snapshot_date` values are unique and strictly increasing when sorted chronologically.
3. `release_point` normalizes to exactly one `pl/{congress}-{number}` tag.
4. Normalized `pl/*` tag names are unique across annual rows.
5. `release_point` congress must equal the row `congress` value.
6. `president_term` on each annual row must reference an existing `president_terms[].slug`.
7. Exactly one boundary row may exist per Congress.
8. If `is_congress_boundary = true`, then `release_notes.scope = congress`.
9. If `is_congress_boundary = false`, then `release_notes.scope = annual`.
10. `commit_selector` must resolve to exactly one commit SHA in the target repo.
11. Congress numbers must not decrease across chronological annual rows.
12. `president_terms[].slug` values are unique.
13. Pre-existing tags in managed namespaces must either not exist or already point at the planned SHA; mismatches are fatal conflicts.

### 1.5 Manifest structure

The manifest is operational state for the local target repo and must remain uncommitted. To reduce unnecessary workstation disclosure while still supporting freshness/debugging, it stores a canonical absolute path plus a separate display-safe relative label.

```json
{
  "version": 1,
  "metadata": {
    "path": "docs/metadata/legal-milestones.json",
    "sha256": "<metadata file digest>"
  },
  "generated_at": "2026-03-29T19:00:00.000Z",
  "target_repo": {
    "canonical_path": "/abs/path/to/us-code",
    "display_path": ".",
    "head_branch": "main"
  },
  "annual_rows": [
    {
      "annual_tag": "annual/2025",
      "annual_tag_sha": "<sha>",
      "pl_tag": "pl/119-73",
      "pl_tag_sha": "<sha>",
      "snapshot_date": "2025-01-15",
      "release_point": "PL 119-73",
      "congress": 119,
      "president_term": "trump-2",
      "commit_sha": "<sha>",
      "is_congress_boundary": false
    }
  ],
  "congress_tags": [
    {
      "tag": "congress/118",
      "congress": 118,
      "commit_sha": "<sha>",
      "annual_tag": "annual/2024"
    }
  ],
  "president_tags": [
    {
      "tag": "president/obama-2",
      "slug": "obama-2",
      "inauguration_date": "2013-01-20",
      "commit_sha": "<sha>",
      "annual_tag": "annual/2013"
    }
  ],
  "skipped_president_tags": [
    {
      "slug": "obama-1",
      "inauguration_date": "2009-01-20",
      "reason": "inauguration_before_coverage_window"
    }
  ],
  "release_candidates": [
    {
      "tag": "congress/118",
      "tag_sha": "<sha>",
      "previous_tag": "congress/117",
      "previous_tag_sha": "<sha>",
      "title": "118th Congress (2023–2024)",
      "start_date": "2023",
      "end_date": "2024"
    }
  ]
}
```

### 1.6 Atomic write and locking design

Because concurrent milestone commands are explicitly an edge case, the target repo must use both:

- a lock file: `.us-code-tools/milestones.lock`
- atomic manifest replacement: write temp file in `.us-code-tools/` then rename to `milestones.json`

Lock acquisition algorithm:

1. `mkdir(.us-code-tools)` if absent.
2. Create `milestones.lock` with `open(..., O_CREAT|O_EXCL)`.
3. Write JSON lock payload containing PID, hostname, command, and timestamp.
4. On failure to acquire, exit non-zero with deterministic `lock_conflict` error.
5. Delete lock in `finally`.

Stale-lock policy:

- Day-one behavior stays fail-closed; the command never auto-breaks an existing lock.
- `lock_conflict` output must include the lock payload fields needed for manual recovery: PID, hostname, command, and timestamp.
- The docs and error text must include a deterministic recovery instruction: inspect the recorded process, confirm it is no longer running, delete `.us-code-tools/milestones.lock`, then rerun.

Index rationale:

- No database indexes are needed because there is no database.
- For in-memory lookup, planners should normalize into `Map<string, Row>` keyed by `annual_tag`, normalized `pl_tag`, `congress`, and `president slug` so validation remains linear-time and deterministic.

### 1.7 Seed data

For development and tests, seed data is a fixture metadata file rather than SQL seed rows.

Required fixtures:

- `tests/fixtures/milestones/legal-milestones.valid.json`
- `tests/fixtures/milestones/legal-milestones.duplicate-annual.json`
- `tests/fixtures/milestones/legal-milestones.bad-release-point.json`
- `tests/fixtures/milestones/legal-milestones.pre-window-president.json`
- `tests/fixtures/milestones/legal-milestones.post-window-president.json`
- `tests/fixtures/milestones/legal-milestones.multi-boundary.json`

## 2. API Contract

No HTTP API is introduced by this issue. The externally supported interface is the CLI.

Because there is no network service, OpenAPI is not applicable here. The canonical interface contract is the command surface below.

### 2.1 CLI surface

Exactly three subcommands are added beneath `milestones`:

```text
us-code-tools milestones plan --target <repo> --metadata <file>
us-code-tools milestones apply --target <repo> --metadata <file>
us-code-tools milestones release --target <repo> --metadata <file>
```

Any other invocation is a usage error and must exit before git or GitHub mutation.

### 2.2 Command contracts

#### `milestones plan`
- Purpose: validate metadata, resolve commits, derive tags, derive release candidates, print deterministic JSON to stdout.
- Side effects: none.
- Exit code:
  - `0` when `errors=[]`
  - `1` when validation or resolution errors exist

**stdout schema**

```json
{
  "annual_tags": [
    {
      "tag": "annual/2024",
      "commit_sha": "<sha>",
      "snapshot_date": "2024-01-01"
    }
  ],
  "pl_tags": [
    {
      "tag": "pl/118-42",
      "commit_sha": "<sha>",
      "release_point": "PL 118-42"
    }
  ],
  "congress_tags": [
    {
      "tag": "congress/118",
      "commit_sha": "<sha>",
      "annual_tag": "annual/2024"
    }
  ],
  "president_tags": [
    {
      "tag": "president/biden",
      "commit_sha": "<sha>",
      "annual_tag": "annual/2021"
    }
  ],
  "skipped_president_tags": [
    {
      "slug": "obama-1",
      "inauguration_date": "2009-01-20",
      "reason": "inauguration_before_coverage_window"
    }
  ],
  "release_candidates": [
    {
      "tag": "congress/118",
      "tag_sha": "<sha>",
      "previous_tag": "congress/117",
      "previous_tag_sha": "<sha>",
      "title": "118th Congress (2023–2024)",
      "start_date": "2023",
      "end_date": "2024"
    }
  ],
  "errors": []
}
```

#### `milestones apply`
- Purpose: enforce repo cleanliness/attached HEAD, create missing tags, verify existing tags, write manifest.
- Side effects: git tags in target repo, `.us-code-tools/milestones.json`, `.us-code-tools/milestones.lock`.
- Exit code:
  - `0` on success
  - `1` on validation failure, repo state failure, lock conflict, or tag conflict

**stderr / structured error codes**

- `usage_error`
- `repo_dirty`
- `detached_head`
- `lock_conflict`
- `metadata_invalid`
- `commit_selector_ambiguous`
- `tag_conflict`
- `manifest_write_failed`

#### `milestones release`
- Purpose: re-plan, compare against manifest freshness, render release bodies, create/update GitHub Releases by tag.
- Side effects: GitHub Release create/update only.
- Exit code:
  - `0` on success
  - `1` on stale manifest, gh unavailable/auth missing, or release write failure

**error codes**

- `manifest_missing`
- `manifest_invalid`
- `manifest_stale`
- `github_cli_unavailable`
- `github_cli_auth_missing`
- `github_release_write_failed`

### 2.3 CLI rate limiting and throttling

No inbound API rate limiting exists because this is not a server. Outbound GitHub writes should still be serialized:

- `milestones release` processes Congress releases one at a time.
- No parallel `gh` writes.
- On `gh` non-zero exit, stop immediately and return failure.

### 2.4 Output determinism requirements

- Sort annual rows by `snapshot_date`, then `annual_tag`.
- Sort `president_terms` by `inauguration_date`, then `slug`.
- Emit JSON fields in stable order.
- Pretty-print manifest with 2-space indentation and trailing newline.
- Preserve ordered `notable_laws[]` exactly as metadata provides it.

## 3. Service Boundaries

This remains a **single-process TypeScript CLI**, not a multi-service system.

### 3.1 Modules

Add a new `src/milestones/` subtree and one command entrypoint:

```text
src/commands/milestones.ts
src/milestones/schema.ts
src/milestones/types.ts
src/milestones/metadata.ts
src/milestones/validate.ts
src/milestones/commit-selector.ts
src/milestones/president-tags.ts
src/milestones/title-renderer.ts
src/milestones/plan.ts
src/milestones/tag-apply.ts
src/milestones/manifest.ts
src/milestones/lock.ts
src/milestones/release-renderer.ts
src/milestones/releases.ts
src/milestones/gh.ts
```

### 3.2 Dependency direction

Dependency rules:

1. `src/index.ts` -> `src/commands/milestones.ts`
2. `src/commands/milestones.ts` -> pure planners + adapters
3. Pure modules (`schema`, `validate`, `plan`, `president-tags`, `title-renderer`, `release-renderer`) must not shell out.
4. Adapter modules (`commit-selector`, `tag-apply`, `manifest`, `lock`, `gh`) may touch git, fs, or child processes.
5. `releases.ts` composes pure rendering with `gh.ts`, but does not contain parsing or validation logic inline.

No circular imports are allowed.

### 3.3 Ownership of persisted artifacts

- `metadata.ts` / `schema.ts` own parsing and validation of `docs/metadata/legal-milestones.json`.
- `tag-apply.ts` owns target-repo tag creation and tag conflict detection.
- `manifest.ts` owns `.us-code-tools/milestones.json` serialization and freshness comparison.
- `gh.ts` owns `gh release view/create/edit` subprocess execution.

### 3.4 Communication patterns

- Pure function calls for planning and rendering.
- Child-process calls for git and `gh`.
- No queues, no background jobs, no webhooks.

### 3.5 Trusted executable resolution

Subprocess adapters must resolve the `git` and `gh` executable paths once at process start before any metadata-driven operations.

Rules:

1. Resolve binaries with a dedicated helper using `command -v`/`which` equivalent behavior implemented via Node APIs, then store the absolute paths in process-local config.
2. All subprocesses use `execFile`/`spawn` argument arrays with the resolved absolute executable path; never use shell interpolation.
3. Fail closed with deterministic errors if `git` is missing for any command or if `gh` is missing for `milestones release`.
4. Debug logs may mention only the executable basename by default; absolute binary paths are printed only in explicit verbose troubleshooting mode.
5. Document in implementation notes and CI docs that operators must provide trusted `git` and `gh` binaries on the host.

This directly addresses the approved medium-risk finding about PATH spoofing while preserving the CLI-only design.

### 3.6 Tagging strategy

Use **annotated tags** consistently for all managed milestone tags. The spec permits lightweight or annotated tags, but architecture standardizes on annotated tags to avoid mixed-repo behavior and to support future audit context.

Tag message formats:

- `annual/YYYY`: `Annual OLRC snapshot for YYYY`.
- `pl/C-N`: `Annual snapshot current through Public Law C-N`.
- `congress/N`: `Congress boundary for the Nth Congress`.
- `president/slug`: `Presidential term boundary for <President Name>`.

Existing managed tag behavior:

- If tag missing: create.
- If tag exists and SHA matches: no-op.
- If tag exists and SHA differs: fail with `tag_conflict`; never retarget.

## 4. Infrastructure Requirements

## 4.1 Production runtime

This issue runs wherever `us-code-tools` already runs.

Required runtime components:

- Node.js 22+
- Git CLI available on `PATH`
- `gh` CLI available on `PATH` for `milestones release` only
- Filesystem write access to:
  - repo-local metadata file in this repo
  - target repo `.git/`
  - target repo `.us-code-tools/`

### 4.1.1 No database

No Postgres, SQLite, Redis, S3, or queue is required. Introducing them here would increase operational burden without adding correctness.

### 4.1.2 DNS / certificates

None. This feature does not expose a network service.

### 4.1.3 Monitoring and logging

Because this is a CLI, observability is process-local:

- stdout: successful JSON result payloads
- stderr: deterministic human-readable errors, prefixed with stable error codes where possible
- optional `DEBUG=us-code-tools:milestones*` namespace for verbose troubleshooting

### 4.1.4 Failure handling

- Tagging is safe because existing incorrect tags are never moved.
- Release publication may partially succeed across Congress releases; rerun updates existing releases keyed by tag.
- Manifest is never trusted blindly; freshness check is mandatory before GitHub writes.
- `git diff --stat` output must be bounded during release rendering: capture only diff-stat output, enforce a subprocess timeout, and either truncate to a documented maximum body size or fail with a deterministic renderer error before attempting the GitHub write.

## 4.2 Development / test environment

No Docker Compose is needed.

Dev requirements:

- local Node.js 22+
- local git
- temp directories for fixture repos in Vitest
- optional authenticated `gh` only for live/manual verification; unit/integration tests should mock the `gh` adapter

### 4.2.1 Test strategy

- Unit tests for schema, title derivation, president-tag derivation, release rendering, and manifest freshness comparison.
- Integration tests with ephemeral git repos for `plan` and `apply`.
- Integration tests with mocked `gh` executable or adapter seam for `release`.
- Build gate: `npm run build`
- Test gate: `npm test`

### 4.2.2 CI requirements

- Linux runner with git installed
- Node 22 or repo-standard version
- no GitHub credentials required for most tests
- if adding a live smoke job later, keep it separate from default CI

## 5. Dependency Decisions

Architecture goal: add the minimum needed for deterministic validation and release publication.

### 5.1 Keep existing dependencies

| Dependency | Version | Why keep it | License | Maintenance |
|---|---:|---|---|---|
| `typescript` | `^5.8.0` | Existing compiler and type system | Apache-2.0 | Active, industry standard |
| `vitest` | `^3.0.0` | Existing test runner; already integrated | MIT | Active |
| `@types/node` | `^22.0.0` | Node typing for CLI/fs/child-process work | MIT | Active |

### 5.2 Add one schema validator

**Decision:** add `ajv@^8.17.1` and `ajv-formats@^3.0.1`

Why:

- deterministic JSON Schema validation
- strong fit for a committed metadata file with explicit schema
- better long-term auditability than hand-written nested validators
- avoids overloading business-rule validation with parse/shape validation

Why not alternatives:

- **Zod:** excellent for TS ergonomics, but JSON Schema is the better artifact for a committed data contract that may later be consumed outside runtime code.
- **Manual validation only:** too error-prone for a spec with many exact invariants.

License compatibility:

- MIT-compatible with repo MIT license.

Maintenance:

- Ajv is mature and actively maintained.

### 5.3 Do not add Octokit

**Decision:** keep GitHub integration via `gh` CLI subprocesses, not the GitHub REST SDK.

Why:

- the spec already standardizes on `gh`
- avoids duplicate auth handling
- keeps behavior closer to operator environment
- reduces dependency surface and secret-management complexity

### 5.4 Do not add a locking package

Use Node built-ins plus exclusive file creation for lock acquisition. A dependency would add little value here.

## 6. Integration Points

### 6.1 Existing repo integrations

1. `src/index.ts`
   - add `milestones` dispatch branch
2. existing git orchestration patterns in `src/backfill/*`
   - reuse repo cleanliness and attached-HEAD expectations
   - optionally extract shared git helpers instead of duplicating subprocess logic
3. `src/utils/manifest.ts`
   - do **not** overload the fetch manifest schema
   - create a separate milestone-manifest module to avoid coupling unrelated manifest formats

### 6.2 External tool integrations

#### Git CLI
Used for:

- commit resolution from `commit_selector`
- `rev-parse`
- `tag --list`
- `show-ref --tags`
- `diff --stat`
- working tree cleanliness checks
- symbolic-ref attached-HEAD checks

#### GitHub CLI (`gh`)
Used for:

- auth check: `gh auth status`
- release lookup by tag
- release create
- release edit

Recommended exact interaction model:

```bash
gh release view <tag> --json tagName,url,name
# if not found:
gh release create <tag> --title <title> --notes-file <file>
# if found:
gh release edit <tag> --title <title> --notes-file <file>
```

Release lookup key is tag name only.

### 6.3 Data flow

#### Plan
1. Read metadata JSON.
2. Validate schema.
3. Apply semantic validation.
4. Resolve each `commit_selector` to exactly one commit.
5. Derive annual/pl/congress/president tags.
6. Derive release candidates.
7. Print deterministic JSON.

#### Apply
1. Re-run full plan.
2. Verify target repo clean and attached to branch.
3. Acquire lock.
4. Verify existing managed tags do not conflict.
5. Create missing annotated tags.
6. Write manifest atomically.
7. Release lock.

#### Release
1. Read manifest.
2. Re-run full plan.
3. Compare metadata digest and all required resolved SHAs.
4. Verify `gh` installed and authenticated.
5. For each Congress release candidate, render body from one boundary row plus `git diff --stat` or baseline sentence.
6. Create or update GitHub Release keyed by tag.

## 7. Security Considerations

### 7.1 Trust boundaries

Inputs crossing trust boundaries:

- metadata file contents
- `commit_selector` strings
- target repo state
- local environment for `git` / `gh`

Security posture:

- treat metadata as untrusted until validated
- never pass unvalidated shell fragments to a shell
- use `execFile`/argument arrays, not shell interpolation

### 7.2 Auth model

There is no application auth model because this is a local CLI.

GitHub auth is delegated to `gh` CLI. `milestones release` must fail closed if `gh auth status` is not healthy.

### 7.3 Input validation strategy

- JSON Schema validation first
- semantic validation second
- commit-selector resolution third
- only then git mutation

`commit_selector` must be passed to git as an argument vector and must never be concatenated into a shell command.

### 7.4 Filesystem and repo safety

- Require clean working tree for `apply`
- Require attached HEAD for `apply`
- Never force-move tags
- Use lock file to prevent concurrent manifest corruption
- Use atomic rename for manifest writes
- Manifest files should be mode `0600`

### 7.5 Sensitive data handling

No new secrets are introduced.

Potentially sensitive values:

- canonical local filesystem paths in manifest
- repo remotes indirectly visible through git operations

Guidance:

- keep manifest scoped to local target repo and treat it as internal operational state, not reviewable project content
- default human-facing logs and errors must prefer `display_path`/relative paths over canonical absolute paths
- do not embed GitHub tokens, auth headers, environment dumps, or full `gh auth status` output in manifest or stderr output
- if verbose/debug logging is enabled, redact home-directory prefixes where practical before printing file paths

### 7.6 Release-body integrity

Release body content comes from:

- exact metadata fields on one boundary row
- exact `git diff --stat` output between resolved Congress tags, or fixed baseline sentence

No live LLM calls, scraping, or browser automation are allowed in this flow.

### 7.7 CORS

Not applicable. No HTTP service is exposed.

### 7.8 Abuse / misuse cases

1. **Hand-edited manifest used to publish wrong release**
   - mitigated by digest + SHA freshness check before any `gh` write
2. **Existing tag silently retargeted**
   - mitigated by fail-on-conflict policy
3. **Concurrent apply commands corrupt manifest**
   - mitigated by exclusive lock file + atomic rename
4. **Malformed metadata creates wrong presidential mapping**
   - mitigated by explicit coverage-window rules and deterministic skip reasons

## 8. Implementation Plan

### 8.1 Slice 1 — pure core

Add:

- `schema.ts`
- `types.ts`
- `validate.ts`
- `president-tags.ts`
- `title-renderer.ts`
- `plan.ts`

Tests:

- `tests/unit/milestones-schema.test.ts`
- `tests/unit/president-tags.test.ts`
- `tests/unit/milestones-plan.test.ts`
- `tests/unit/title-renderer.test.ts`

### 8.2 Slice 2 — git application and manifest

Add:

- `commit-selector.ts`
- `tag-apply.ts`
- `manifest.ts`
- `lock.ts`

Tests:

- `tests/unit/milestones-apply.test.ts`
- `tests/integration/milestones-apply.test.ts`

### 8.3 Slice 3 — release rendering

Add:

- `release-renderer.ts`
- `releases.ts`

Tests:

- `tests/unit/release-renderer.test.ts`
- `tests/unit/releases-idempotency.test.ts`
- `tests/unit/releases-auth.test.ts`

### 8.4 Slice 4 — CLI wiring

Add:

- `src/commands/milestones.ts`
- `src/index.ts` dispatch branch
- fixture metadata

Tests:

- `tests/cli/milestones.test.ts`
- `tests/integration/milestones-release.test.ts`

## 9. Key Decisions Summary

| Decision | Rationale |
|---|---|
| Keep feature CLI-only | Matches existing product surface and spec; no server needed |
| No database | Persisted state is small, deterministic, file-based, and git-adjacent |
| Use committed metadata JSON + generated manifest JSON | Makes workflow auditable and reproducible |
| Use annotated tags consistently | Avoids mixed tag styles and improves auditability |
| Use `gh` CLI, not Octokit | Reuses existing auth path and avoids extra dependency surface |
| Use Ajv for schema validation | Strong deterministic data-contract enforcement |
| Fail on tag conflicts; never retarget | Meets safety requirement and preserves historical integrity |
| Require manifest freshness before release writes | Prevents stale or tampered release publication |
