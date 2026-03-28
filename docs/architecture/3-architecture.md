# Architecture — Issue #3: Constitution Backfill — Articles & Amendments as Backdated Commits

## Status
Approved spec input: `docs/specs/3-spec.md`

## Inputs Reviewed
- `docs/specs/3-spec.md`
- `SPEC.md`
- `README.md`
- `package.json`
- `src/index.ts`
- GitHub issue #3 and issue comments
- Existing architecture pattern in `docs/architecture/1-architecture.md`

## Constraints and Operating Assumptions
- No `.dark-factory.yml` was present in the repository root at architecture time, so the effective implementation constraints are taken from the approved spec and the existing repository/toolchain.
- This issue extends the current Node.js TypeScript CLI instead of introducing a service.
- The workflow must be deterministic offline except for an optional push step against an already-configured git remote.
- The target repository is an operator-supplied local path; this tool does not discover or create remotes on behalf of the operator.

## Review Feedback Addressed
- Reviewed the full spec review chain through the final approved revision in the issue comments.
- The architecture below explicitly addresses:
  - existing empty-directory bootstrap with `git init` in place
  - rejection of populated non-git directories
  - dirty-working-tree preflight rejection before any writes or commits
  - local-only success mode when no push remote is configured
  - deterministic author mapping for all 28 events
  - contiguous-prefix-only resume semantics and rejection of internal gaps
  - exact UTC-midnight commit timestamp formatting (`YYYY-MM-DDT00:00:00+0000`)

## 1. Data Model

This issue does **not** introduce a relational database. The approved scope is a local CLI that writes markdown files and git commits into a downstream repository. Introducing Postgres or an HTTP persistence tier here would be unnecessary scope expansion.

The production data model for this ticket is therefore:
1. a committed static Constitution dataset in this repository
2. pure planned historical events derived from that dataset
3. rendered markdown artifacts written into the target repository
4. repository state observed from the target repo's commit graph and working tree

### 1.1 Static Constitution Dataset Schema

File location recommendation:
```text
src/backfill/constitution/dataset.ts
```

Canonical TypeScript types:
```ts
export type ConstitutionRecordType = 'article' | 'amendment';

export interface ConstitutionProvisionRecord {
  type: ConstitutionRecordType;
  number: number;
  romanNumeral: string;
  heading: string;
  proposed: string;          // YYYY-MM-DD
  ratified: string;          // YYYY-MM-DD
  proposingBody: string;
  authorName: string;
  authorEmail: string;
  source: string;
  markdownBody: string;
}

export interface ConstitutionDataset {
  constitution: {
    signed: string;          // 1787-09-17
    ratified: string;        // 1788-06-21
    ratifiedDetail: string;  // 9th state: New Hampshire
    source: string;
    authorName: 'Constitutional Convention';
    authorEmail: 'convention@constitution.gov';
    articles: ConstitutionProvisionRecord[];
  };
  amendments: ConstitutionProvisionRecord[];
}
```

Constraints:
- `articles.length = 7`
- `amendments.length = 27`
- article `number` values are exactly `1..7`
- amendment `number` values are exactly `1..27`
- all `proposed` and `ratified` values are valid ISO calendar dates
- each `source` is a fully qualified `https://constitution.congress.gov/...` URL
- `markdownBody` contains full official text, not summaries
- article bodies preserve section and clause structure in source form

### 1.2 Rendered Filesystem Model

Target repository output after a complete backfill:
```text
constitution/
├── article-I.md
├── article-II.md
├── article-III.md
├── article-IV.md
├── article-V.md
├── article-VI.md
├── article-VII.md
├── amendment-01.md
├── amendment-02.md
├── ...
└── amendment-27.md
```

Total rendered files after the full run: `34`.

### 1.3 Markdown Document Contract

All rendered documents begin with YAML frontmatter and then deterministic markdown body content.

Article example:
```yaml
---
type: "article"
number: 1
heading: "Legislative Powers"
ratified: "1788-06-21"
proposed: "1787-09-17"
proposing_body: "Constitutional Convention"
source: "https://constitution.congress.gov/browse/article-1/"
---
```

Amendment example:
```yaml
---
type: "amendment"
number: 14
heading: "Citizenship, equal protection, due process"
ratified: "1868-07-09"
proposed: "1866-06-13"
proposing_body: "39th Congress"
source: "https://constitution.congress.gov/browse/amendment-14/"
---
```

Rendering rules:
- frontmatter key order is fixed: `type`, `number`, `heading`, `ratified`, `proposed`, `proposing_body`, `source`
- files end with a trailing newline
- article filenames use Roman numerals exactly as specified by the issue
- amendment filenames are zero-padded to two digits
- re-rendering the same record produces byte-identical output

### 1.4 Historical Event Model

Recommended pure planning type:
```ts
export interface BackfillFileWrite {
  path: string;
  content: string;
}

export interface HistoricalEvent {
  sequence: number;          // 1..28
  slug: string;              // constitution | amendment-01 | ...
  ratified: string;          // YYYY-MM-DD
  authorName: string;
  authorEmail: string;
  commitMessage: string;
  writes: BackfillFileWrite[];
}
```

Event constraints:
- exactly `28` events in non-decreasing `ratified` order
- event `1` writes all `7` article files
- events `2..28` each write exactly one amendment file
- same-day `1791-12-15` events remain ordered by amendment number `1..10`

### 1.5 Repository-State Persistence Model

The backfill engine does not maintain a separate database table for progress. Progress is inferred from the target repository itself.

Observed repo state:
```ts
export interface RepositoryPlanState {
  headExists: boolean;
  currentBranch: string;
  hasConfiguredPushRemote: boolean;
  workingTreeClean: boolean;
  matchingPrefixLength: number;   // 0..28
  hasInternalGap: boolean;
  hasUnrelatedHistory: boolean;
}
```

### 1.6 Migrations / Seeds
No SQL migrations or seed data apply. The seed-equivalent artifact for this ticket is the committed static Constitution dataset under `src/backfill/constitution/` and associated test fixtures/snapshots.

## 2. API Contract

This issue ships a **CLI contract**, not an HTTP API. No REST endpoints, OpenAPI document, CORS surface, or browser-facing service should be introduced.

To satisfy the architecture section requirement concretely, the canonical public interface is the CLI command, its exit codes, and its stdout/stderr behavior.

### 2.1 CLI Surface

```bash
npx us-code-tools backfill --phase=constitution --target <repo-path>
```

Supported commands after implementation:
- `transform` — existing command, behavior preserved
- `backfill` — new command introduced by this issue

Supported `backfill` flags for this phase:
- `--phase <name>`: required; only `constitution` is valid in this issue
- `--target <path>`: required; target repository path

### 2.2 CLI Validation Contract

Validation failures must exit non-zero before side effects.

Invalid invocation examples and required deterministic failure classes:
```text
Usage: backfill --phase <name> --target <dir>
Error: Missing required --phase flag
```

```text
Usage: backfill --phase <name> --target <dir>
Error: Missing required --target flag
```

```text
Usage: backfill --phase <name> --target <dir>
Error: Unsupported --phase 'baseline'; expected 'constitution'
```

```text
Usage: backfill --phase <name> --target <dir>
Error: --target must point to a directory or a path that does not exist yet
```

### 2.3 Success / Failure Response Contract

#### Success: local-only repo with no push remote
Exit code: `0`

Stdout JSON:
```json
{
  "phase": "constitution",
  "target": "/abs/path/to/test-repo",
  "events_planned": 28,
  "events_applied": 28,
  "events_skipped": 0,
  "push_result": "skipped-local-only"
}
```

#### Success: existing fully backfilled repo rerun
Exit code: `0`

Stdout JSON:
```json
{
  "phase": "constitution",
  "target": "/abs/path/to/test-repo",
  "events_planned": 28,
  "events_applied": 0,
  "events_skipped": 28,
  "push_result": "skipped-local-only"
}
```

#### Success: repo with configured remote and successful push
Exit code: `0`

Stdout JSON:
```json
{
  "phase": "constitution",
  "target": "/abs/path/to/us-code",
  "events_planned": 28,
  "events_applied": 17,
  "events_skipped": 11,
  "push_result": "pushed"
}
```

#### Deterministic preflight failure: populated non-git directory
Exit code: `1`

Stderr:
```text
Error: --target points to a populated non-git directory; refusing to initialize git over existing content
```

#### Deterministic preflight failure: dirty git repo
Exit code: `1`

Stderr:
```text
Error: target repository working tree must be clean before backfill
```

#### Deterministic state failure: unrelated or non-prefix history
Exit code: `1`

Stderr:
```text
Error: target repository history is not an empty history or contiguous Constitution prefix
```

#### Push failure after local commits
Exit code: `1`

Stdout may still report local progress; stderr must include push failure detail:
```text
Error: failed to push Constitution backfill to configured remote: <git error>
```

### 2.4 Rate Limiting Policy
No application-level rate limiting is needed. There is no public HTTP API, no multi-tenant surface, and the push step is a single bounded git operation.

### 2.5 Pagination Strategy
Not applicable.

## 3. Service Boundaries

The backfill implementation remains a **single-process Node.js CLI** with pure planning/rendering code separated from filesystem and git side effects.

### 3.1 Module Layout

Recommended additive layout:
```text
src/
├── index.ts
├── cli/
│   ├── transform-command.ts           # existing command extracted or preserved
│   └── backfill-command.ts            # new backfill command entry
├── backfill/
│   ├── orchestrator.ts                # top-level phase execution
│   ├── planner.ts                     # 28-event pure planner
│   ├── renderer.ts                    # markdown + file path rendering
│   ├── messages.ts                    # commit message formatting
│   ├── authors.ts                     # author mapping logic
│   ├── target-repo.ts                 # open/init/preflight checks
│   ├── git-adapter.ts                 # git CLI wrapper and env construction
│   └── constitution/
│       └── dataset.ts                 # static articles + amendments
├── domain/
│   └── constitution.ts                # types shared by planner/renderer/tests
└── utils/
    ├── fs.ts
    └── exec.ts                        # optional thin child_process wrapper
```

### 3.2 Dependency Direction
Allowed dependency direction only:
- `index.ts` → `cli/*`
- `cli/*` → `backfill/*`, existing transform modules, `domain/*`, `utils/*`
- `backfill/orchestrator.ts` → planner/renderer/messages/authors/target-repo/git-adapter
- `planner.ts`, `renderer.ts`, `messages.ts`, `authors.ts` → `constitution/dataset.ts`, `domain/*`
- `git-adapter.ts`, `target-repo.ts` → `utils/*`, platform APIs only
- `domain/*` → no downstream dependencies

Forbidden:
- dataset code importing git code
- renderer importing child-process code
- git adapter importing CLI argument parsing
- circular imports between planner and git adapter

### 3.3 Responsibility Split

#### `constitution/dataset.ts`
Owns:
- full static text and metadata for all 34 provisions
- exact proposal/ratification dates and source URLs
- deterministic author identity metadata

Does not own:
- filename generation
- commit sequencing
- git execution

#### `renderer.ts`
Owns:
- frontmatter assembly
- markdown body concatenation
- deterministic path derivation
- zero-padding and Roman-numeral file naming rules

Does not own:
- repo state inspection
- commit creation

#### `planner.ts`
Owns:
- conversion from dataset to 28 ordered `HistoricalEvent`s
- same-day ordering guarantees
- grouping all articles into the first event

Does not own:
- file writes
- git history validation

#### `target-repo.ts`
Owns:
- target path inspection
- `git init` bootstrap for missing path / empty existing directory
- dirty-tree preflight
- current-branch / detached-HEAD checks
- contiguous-prefix validation

Does not own:
- commit content formatting

#### `git-adapter.ts`
Owns:
- staging files
- constructing `GIT_AUTHOR_DATE`, `GIT_COMMITTER_DATE`, `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`
- commit execution
- push execution and push-result classification

Does not own:
- historical planning rules

#### `orchestrator.ts`
Owns:
- end-to-end phase control
- applying only missing suffix events after prefix detection
- assembling final process report
- preserving local commits when push fails

### 3.4 Communication Pattern
No queue, no daemon, no separate service. The flow is direct and synchronous:
1. CLI validates args
2. target repo is opened or initialized
3. repo preflight validates cleanliness and allowed history shape
4. planner builds the 28-event Constitution plan
5. existing history is matched against the plan
6. missing suffix events are rendered and committed one by one
7. push is attempted only when a configured push remote exists
8. result is emitted on stdout; failures go to stderr with non-zero exit

## 4. Infrastructure Requirements

### 4.1 Production / Runtime Requirements

For this ticket, “production” means a machine that can run the CLI and mutate a local git repository deterministically.

#### Runtime
- Node.js `22.x` minimum
- npm `10+`
- Git CLI `2.39+` recommended
- macOS and Linux supported; Windows best-effort unless CI adds explicit coverage

#### Filesystem
- writable working directory for this repo
- writable target repo path
- target filesystem must support standard git operations and atomic rename semantics for file writes

#### Network
- not required for the normal backfill path unless a configured push remote exists
- when a push remote exists, outbound network access to the remote host is required only for the final push step

#### Observability
- stdout: machine-readable JSON summary
- stderr: deterministic human-readable errors
- no third-party telemetry or hosted logging service

#### Logging fields
Every fatal error should include, when relevant:
- `phase`
- `target`
- `current_branch`
- `matching_prefix_length`
- `sequence`
- `git_command`

### 4.2 Repository Bootstrap and Preflight Guarantees

#### Target bootstrap algorithm
1. Resolve `--target` to an absolute path.
2. If path does not exist, `mkdir -p` then `git init`.
3. If path exists and is an empty directory with no `.git`, run `git init` in place.
4. If path exists and is a populated non-git directory, fail before any writes.
5. If path exists and is a git repo, inspect branch and cleanliness.

#### Existing git repo preflight
Before any Constitution files are written:
- require non-detached HEAD
- require clean working tree:
  - no staged tracked changes
  - no unstaged tracked changes
  - no untracked files
- inspect history and allow only:
  - empty history, or
  - a contiguous prefix of the 28-event Constitution plan

Reject:
- unrelated commits
- internal gaps in the planned sequence
- detached HEAD

### 4.3 Commit Execution Guarantees

For every planned event:
- write all event files to their final deterministic paths
- `git add` only the event’s paths
- create the commit with:
  - `GIT_AUTHOR_NAME=<event.authorName>`
  - `GIT_AUTHOR_EMAIL=<event.authorEmail>`
  - `GIT_AUTHOR_DATE=<YYYY-MM-DD>T00:00:00+0000`
  - `GIT_COMMITTER_DATE=<YYYY-MM-DD>T00:00:00+0000`
- do not rewrite or amend previous commits

Committer identity policy:
- use the operator’s configured git committer identity if available
- if absent, set a deterministic tool identity such as `us-code-tools <sync@us-code-tools.local>` to avoid environment-dependent failures

### 4.4 Push Contract

Supported success paths only:
1. **Configured push remote exists** → after full local history is present, push current branch; exit `0` only if adapter reports `pushed`.
2. **No configured push remote exists** → skip network push; report `skipped-local-only`; exit `0` once full local history is present.

Failure path:
- if a configured remote exists and push fails, exit non-zero while preserving all local commits already created
- the next run must detect the repo as already complete locally and retry only the push step, without creating duplicate commits

### 4.5 Dev / Testing Requirements

#### Local development
- Node.js 22+
- npm installable from lockfile
- Git CLI available in PATH

#### Test strategy
- unit tests for dataset, planner, renderer, commit env, commit messages, and prefix detection
- snapshot tests for representative rendered files and commit messages
- integration tests against temp local git repos only
- default `npm test` runs offline

#### CI requirements
- Node.js 22 runner
- Git CLI installed
- temp filesystem access for creating repositories
- no remote credentials required
- test environment should set `TZ=UTC` to avoid accidental drift in any date formatting outside explicit git env vars

## 5. Dependency Decisions

| Dependency | Target Version | Why | License | Maintenance / Notes |
|---|---:|---|---|---|
| `typescript` | `^5.8.0` | Existing repo standard; strict typing for dataset correctness and planner purity | Apache-2.0 | Actively maintained |
| `vitest` | `^3.0.0` | Existing test runner; supports snapshots and temp-repo integration tests well | MIT | Actively maintained |
| `gray-matter` | `^4.0.3` | Existing dependency; deterministic frontmatter rendering/validation | MIT | Mature and stable |
| `node:child_process` / `git CLI` | bundled / system | Git history creation and repo inspection are more reliable through real git than a partial JS reimplementation | Node / GPL tool external | Git is the source of truth for commit semantics |
| `fast-xml-parser` | existing only | Unchanged by this issue; retained because `transform` must keep working | MIT | No new role in backfill |
| `yauzl` | existing only | Unchanged by this issue; retained because current repo uses ZIP ingestion for `transform` | MIT | No new role in backfill |

### 5.1 Dependency choices not made
- **No database client / ORM**: no relational storage is needed
- **No `simple-git`**: direct git CLI keeps commit env behavior explicit and testable with fewer abstractions
- **No Octokit / GitHub API SDK**: this issue only pushes an already-configured git remote; it does not manage PRs in the target repo
- **No queue / worker framework**: single-user CLI flow is synchronous and bounded

## 6. Integration Points

### 6.1 Existing Repo Integrations
This work extends the existing repository in additive fashion.

Touched or expected paths:
- `src/index.ts` — command dispatch extended to support `backfill`
- `src/` new backfill modules — planning, rendering, repository orchestration
- `tests/` — new unit/snapshot/integration suites
- `README.md` — command usage documentation
- `SPEC.md` — Constitution content/path contract referenced, not rewritten

### 6.2 Downstream Target Repository Integration
The target is a local checkout or local path for the separate `us-code` repository.

Contracts with target repo:
- current branch must be attached
- existing history must be empty or a contiguous Constitution prefix
- working tree must be clean before execution
- file ownership/permissions must permit writes and git operations

### 6.3 Git Integration Contract
Git commands required through the adapter:
```text
git init
git rev-parse --is-inside-work-tree
git symbolic-ref --quiet --short HEAD
git status --porcelain
git rev-list --reverse --format=...
git add -- <paths>
git commit --message <message>
git remote
git push
```

### 6.4 Data Flow
```text
CLI args
  → backfill arg validation
  → target repo open/init
  → clean-tree + branch + prefix validation
  → static Constitution dataset load
  → pure event planning (28 events)
  → prefix match against existing history
  → render missing event files
  → git add + backdated commit per event
  → push classification (pushed | skipped-local-only | failed)
  → JSON report
```

### 6.5 Resume / Idempotency Contract
Allowed:
- empty repo → apply all 28 events
- repo matching events `1..N` exactly → apply `N+1..28`
- repo matching all `1..28` → apply none

Rejected:
- repo with events `1,2,4` but missing `3`
- repo with unrelated non-Constitution commits before or within the expected chain
- repo with altered commit messages, authors, or dates that break prefix identity

Prefix identity should be checked using deterministic commit metadata derived from the plan, not file contents alone. Minimum comparison tuple per event:
- author name
- author email
- author date
- commit subject/body

## 7. Security Considerations

### 7.1 Trust Boundary
Untrusted inputs in this phase:
- CLI arguments
- target path contents
- target repository git config / existing history
- remote push target behavior if a push remote is configured

The static Constitution dataset committed in this repo is trusted application data.

### 7.2 Input Validation
- `--phase` must equal `constitution`
- `--target` must resolve to an existing directory or a non-existent path that can become a directory
- reject regular-file targets, symlink surprises if unsafe, detached HEAD, dirty trees, and invalid existing histories before writing files
- validate dataset completeness at startup or via tests so missing article/amendment records fail deterministically during development

### 7.3 Filesystem Safety
- never write outside resolved target repo root
- construct all output paths from fixed allowed patterns only:
  - `constitution/article-I.md` ... `constitution/article-VII.md`
  - `constitution/amendment-01.md` ... `constitution/amendment-27.md`
- refuse path traversal by never accepting dataset-provided arbitrary paths
- write file contents deterministically; avoid deleting unrelated paths

### 7.4 Git Safety
- preflight clean-tree check prevents overwriting operator work
- contiguous-prefix validation prevents appending foundational history after unrelated commits
- do not use `git commit --amend`, rebase, or force-push in this phase
- preserve local commits on push failure for operator inspection and safe rerun

### 7.5 Sensitive Data Handling
This workflow should not require new secrets.

Rules:
- if push uses an authenticated remote, credentials are delegated to the operator’s existing git/SSH credential setup
- never log tokens, SSH key material, or credential helper output
- stderr messages should summarize git failures without dumping sensitive env values

### 7.6 Denial-of-Service / Resource Controls
The workload is small and bounded:
- fixed dataset size: 34 documents
- fixed event count: 28 commits
- serial execution only
- no unbounded retry loops
- at most one push attempt per invocation

### 7.7 CORS Policy
Not applicable. No HTTP server is introduced.

## 8. Implementation Plan

### Slice A — CLI and Types
- extend `src/index.ts` to dispatch both `transform` and `backfill`
- add argument parsing and deterministic usage/error messages for `backfill`
- add shared types for Constitution records and historical events

### Slice B — Static Dataset and Rendering
- commit full article/amendment dataset
- implement deterministic file naming and frontmatter rendering
- add snapshot tests for Article I and Amendment I

### Slice C — Event Planning and Message Formatting
- implement 28-event planner
- implement exact commit message templates
- implement deterministic author mapping for all events
- add unit/snapshot tests for Constitution commit and Amendment XIV commit

### Slice D — Repository Adapter and Orchestration
- implement target open/init/preflight logic
- implement prefix detection and contiguous-prefix resume
- implement staged writes and backdated commits
- implement push classification: `pushed` vs `skipped-local-only`
- implement push-failure non-zero exit while preserving local history

### Slice E — Integration and Build Hardening
- temp-repo integration test for 28 commits, 34 files, chronological log, and idempotent rerun
- tests for empty-directory bootstrap, populated non-git rejection, dirty-repo rejection, unrelated-history rejection, and push-failure retention
- verify `npm test` and `npm run build`

## 9. Acceptance Mapping

| Spec Requirement | Architectural Decision |
|---|---|
| New `backfill --phase=constitution --target <path>` command | add explicit backfill command module and dispatcher in `src/index.ts` |
| Static full Constitution dataset | commit trusted dataset under `src/backfill/constitution/dataset.ts` |
| Deterministic markdown files | pure renderer with fixed frontmatter ordering and path derivation |
| 28 chronological historical events | pure planner returns exactly 28 `HistoricalEvent`s in stable order |
| Exact author/date/message behavior | `authors.ts` + `messages.ts` + git env builder enforce exact values |
| Empty non-git directory must bootstrap | `target-repo.ts` initializes empty directories in place with `git init` |
| Populated non-git directory must fail | preflight rejects before any filesystem or git mutation |
| Dirty repo must fail before writes | clean working tree is mandatory preflight gate |
| Idempotent rerun / resume contiguous prefix | prefix detector applies only missing suffix events |
| Push succeeds or local-only skip | adapter reports `pushed` or `skipped-local-only`; configured-remote failures exit non-zero |

## 10. Open Questions Resolved by Architecture
- **Do we add a database because the generic template mentions one?** No. This issue is a local CLI/git workflow; a database would be unjustified.
- **Do we expose an HTTP API?** No. The public contract is a CLI command and stdout/stderr behavior.
- **How do we handle local-only target repos?** They are valid success cases when no push remote exists; report `skipped-local-only`.
- **How do we handle existing non-git directories?** Empty ones are initialized in place; populated ones are rejected.
- **How do we handle partial history?** Only exact contiguous prefixes may resume; internal gaps are rejected.
- **How do we guarantee date determinism across machines?** Every commit uses explicit `+0000` UTC-midnight env vars for both author and committer date.
