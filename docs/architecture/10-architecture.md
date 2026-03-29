# Issue #10 Architecture — Canonical `<num @value>` extraction and XSD-contract regression coverage

## Status
Approved spec input: `docs/specs/10-spec.md`

## Inputs Reviewed
- `docs/specs/10-spec.md`
- GitHub issue #10 and approved review thread
- `README.md`
- `package.json`
- `src/transforms/uslm-to-ir.ts`
- `tests/unit/transforms/uslm-to-ir.test.ts`
- `tests/integration/transform-cli.test.ts`
- `docs/schemas/USLM-1.0.15.xsd`
- Existing architecture documents: `docs/architecture/5-architecture.md`, `docs/architecture/8-architecture.md`

## Constraints and Operating Assumptions
- No repo-root `.dark-factory.yml` is present in this worktree. Effective constraints therefore come from the approved spec, the existing TypeScript CLI codebase, and current repository architecture.
- This issue is a parser-and-test architecture change inside an existing single-process Node.js CLI. It does **not** introduce a new service, daemon, worker, queue, or persistent database.
- Production behavior for this ticket is defined by deterministic XML parsing, IR generation, and filesystem output naming. The existing manifest/cache model from earlier issues remains unchanged.
- The implementation must remain fully fixture-backed in tests. No live OLRC access, no runtime XSD validation, and no appendix-title support are introduced here.
- `fast-xml-parser` remains the XML engine. Attribute handling must stay compatible with the current parser configuration: `ignoreAttributes: false`, `attributeNamePrefix: '@_'`, and `removeNSPrefix: true`.

---

## 1. Data Model

### 1.1 Architectural decision
This issue introduces **no new database tables and no new manifest schema**.

That is the correct production decision because the defect is not persistence-related. The problem is that the XML transform layer currently treats decorated `<num>` display text as canonical, even though the USLM XSD defines `@value` as the normalized machine-readable number.

The production data model impacted by this issue is therefore the in-memory parser contract plus the already-existing output filename/identifier conventions.

### 1.2 Canonical in-memory parsing contract
Owner: `src/transforms/uslm-to-ir.ts`

The parser must adopt one canonical rule for all title/chapter/section number extraction:

```ts
export interface XmlNumNode {
  '@_value'?: string;
  '#text'?: string;
}

export interface CanonicalNumExtraction {
  rawValueAttribute: string | null;
  rawDisplayText: string;
  canonicalNumber: string;
  source: 'value-attribute' | 'display-text';
}
```

Concrete behavior:
1. Read `node['@_value']` first.
2. Normalize whitespace.
3. If the normalized attribute is non-empty, use it as the canonical number.
4. If the normalized attribute is absent or empty, derive the number from display text.
5. Display-text fallback strips presentation-only decoration while preserving meaningful symbolic bodies such as `2/3` and `36B`.
6. If non-empty `@value` disagrees with cleaned display text, `@value` wins without reconciliation logic.

### 1.3 Required pure helper boundary
The parser should centralize this behavior in a shared pure helper rather than scattering string cleanup rules across title/chapter/section call sites.

Canonical function shape:

```ts
function readCanonicalNum(node: XmlValue | undefined): string
```

Required helper responsibilities:
- accept the parsed `<num>` node as produced by `fast-xml-parser`
- read `@_value` when present
- normalize whitespace-only attributes to empty
- fall back to cleaned text content when the attribute is absent/empty
- never perform I/O, logging, or mutation

### 1.4 Fallback cleanup contract
The fallback display-text cleaner is part of the production data model because its output feeds identifiers, IR fields, and filenames.

Required deterministic cleanup steps:

```ts
function cleanDecoratedNumText(input: string): string {
  return normalizeWhitespace(input)
    .replace(/^§\s*/u, '')
    .replace(/^Title\s+/iu, '')
    .replace(/^Chapter\s+/iu, '')
    .replace(/[.]+$/u, '')
    .replace(/[—]+$/u, '')
    .trim();
}
```

Behavioral requirements:
- `§ 1.` -> `1`
- `Title 1—` -> `1`
- `Chapter 1—` -> `1`
- `  § 36B.  ` -> `36B`
- `§ 2/3.` -> `2/3`

### 1.5 Output identifier model
No new persisted field is added, but these existing outputs become stricter and testable:

```ts
export interface TitleIR {
  titleNumber: number;
  chapters: Array<{ number: string; heading: string }>;
  sections: SectionIR[];
}

export interface SectionIR {
  titleNumber: number;
  sectionNumber: string;
  source: string;
}
```

Required invariants after this issue:
- `titleIr.titleNumber` is derived from canonical title `<num>` extraction.
- `titleIr.chapters[*].number` is derived from canonical chapter `<num>` extraction.
- `titleIr.sections[*].sectionNumber` is derived from canonical section `<num>` extraction.
- Display decorations (`§`, `Title `, `Chapter `, `.`, `—`) must not leak into section numbers used for file naming.

### 1.6 Persistence and migration impact
No SQL migrations, no manifest migrations, and no cache-layout changes are required.

Implementation is additive and localized to:
- `src/transforms/uslm-to-ir.ts`
- `tests/unit/transforms/uslm-to-ir.test.ts`
- `tests/integration/transform-cli.test.ts`
- `tests/fixtures/xml/title-01/04-current-uscdoc.xml`

### 1.7 Seed data / fixtures
The committed fixture set is the canonical test dataset for this issue.

Required fixture decisions:
- Refresh `tests/fixtures/xml/title-01/04-current-uscdoc.xml` so it matches the current OLRC/XSD contract.
- Keep `01-base.xml` and `02-more.xml` unchanged to preserve backward-compatibility coverage.
- Derive titles `2..54` excluding `53` by deterministic substitution from the refreshed Title 1 current-format fixture inside `buildCurrentFormatFixtureZip(...)`.

### 1.8 Indexes / lookup strategy
There are no database indexes in scope.

Equivalent lookup rules in this issue:
- `collectSectionNodes(titleNode)` remains the only section discovery boundary.
- Fixture assertions must verify one-to-one alignment between source `<section><num @value>` entries and parsed `sectionNumber` outputs.
- Chapter validation must verify one-to-one alignment between source `<chapter><num @value>` entries and parsed chapter IR numbers.

---

## 2. Interface Contract

This repository exposes a CLI, not an HTTP API. Therefore **no OpenAPI surface is added or modified for this issue**.

The external contract in scope is the existing transform CLI plus the parser function contract consumed by internal modules and tests.

### 2.1 Parser contract
Function:

```ts
parseUslmToIr(xml: string, xmlPath?: string): ParsedTitleResult
```

Required observable behavior:
- Accept both legacy `<uslm><title>` and current `<uscDoc><main><title>` roots.
- Read `<num @value>` through `node['@_value']` under the current parser configuration.
- Prefer non-empty `@value` for title/chapter/section number extraction.
- Fall back to cleaned display text when `@value` is absent or whitespace-only.
- Preserve prior behavior for legacy fixtures that do not include `@value`.
- Continue omitting sections with no recoverable canonical number and emit `MISSING_SECTION_NUMBER`.

### 2.2 CLI transform contract
Command:

```text
us-code-tools transform --title <1..54> --output <dir>
```

Required observable behavior for current-format fixtures:
- `transform --title 1` succeeds from selected-vintage OLRC cache input.
- The Title 1 current-format fixture yields `_title.md` plus exactly 53 section markdown files.
- The emitted JSON report includes `sections_found === 53`.
- Generated paths do not contain decorated values such as `§`, `Title-1`, `Chapter-1`, `—`, or doubled periods.
- Titles `1..52` and `54` continue to succeed through the deterministic derived-fixture matrix.
- Title `53` continues to surface the existing reserved-empty diagnostic.

### 2.3 Error contract
No new error classes are required.

Existing error behavior must be preserved with stricter correctness:
- `INVALID_XML` behavior remains unchanged.
- `MISSING_SECTION_NUMBER` remains the degraded-path behavior only when both canonical `@value` and cleaned fallback text are empty.
- The parser must **not** emit false `MISSING_SECTION_NUMBER` errors for sections whose `<num @value>` is populated but whose display text is decorated.

### 2.4 Rate limiting / pagination
No HTTP endpoints, rate limits, or pagination semantics are introduced for this issue.

---

## 3. Service Boundaries

### 3.1 Monolith/module decision
Remain a single-process CLI package. No service split.

Rationale:
- The change is wholly contained inside parsing and regression testing.
- There is no asynchronous or cross-system workflow that benefits from a queue or external service boundary.
- Adding a service for XML normalization would be unjustified architecture inflation.

### 3.2 Module ownership

#### `src/transforms/uslm-to-ir.ts`
Owns:
- XML parser configuration
- root-node selection (`uscDoc` vs `uslm`)
- canonical `<num>` extraction helper
- title/chapter/section numeric normalization
- parse-error emission for missing or invalid data

#### `tests/unit/transforms/uslm-to-ir.test.ts`
Owns:
- pure parser behavior verification
- `<num>` contract cases
- structural XSD-inspired fixture assertions
- backward compatibility coverage

#### `tests/integration/transform-cli.test.ts`
Owns:
- end-to-end CLI transform behavior
- selected-vintage cache fixture seeding
- multi-title current-format matrix derivation strategy
- filesystem regression assertions for generated filenames/directories

#### `docs/schemas/USLM-1.0.15.xsd`
Owns:
- normative reference for why `@value` is canonical and display text may remain decorated

### 3.3 Dependency direction
Required dependency graph:

```text
CLI transform integration tests
  -> transform command / dist entry
  -> parser module
  -> fast-xml-parser

Unit tests
  -> parser module
  -> fixture XML / XSD reference
```

Rules:
- tests may inspect fixture source and parser outputs
- parser must not depend on tests
- parser must not depend on XSD parsing at runtime
- no circular dependency between transform logic and CLI harness helpers

### 3.4 Communication pattern
Direct in-process function calls only.

No events, queues, RPC, HTTP callbacks, or background workers are required.

---

## 4. Infrastructure Requirements

### 4.1 Production/runtime
This issue does not add production infrastructure.

Runtime requirements remain:
- Node.js 22+ compatible environment
- TypeScript compilation via `tsc`
- `fast-xml-parser` 4.5.x for XML parsing
- local filesystem for transform output

No new requirements for:
- Postgres
- Redis
- S3/object storage
- background queues
- DNS/certificates
- external schedulers

### 4.2 Dev/testing
Required local and CI capabilities:
- `npm install`
- `npm run build`
- `npm test`
- `zip` binary available for the existing integration-fixture packaging workflow
- deterministic filesystem sandboxing via temp directories already used in Vitest integration tests

### 4.3 Fixture infrastructure
Tests must stay fully local and deterministic.

Required fixture assets:
- `tests/fixtures/xml/title-01/01-base.xml`
- `tests/fixtures/xml/title-01/02-more.xml`
- refreshed `tests/fixtures/xml/title-01/04-current-uscdoc.xml`
- `docs/schemas/USLM-1.0.15.xsd` as the schema reference artifact

### 4.4 CI requirements
CI must run, at minimum:

```bash
npm run build
npm test
```

Success conditions:
- parser compiles after helper introduction
- legacy parser tests still pass
- current-format unit tests pass
- CLI integration tests pass, including the multi-title matrix

### 4.5 Observability and logging
No new telemetry pipeline is required.

Implementation may continue existing console/report behavior, but must not add noisy per-section logging. Regression proof belongs in tests, not runtime log scanning.

---

## 5. Dependency Decisions

### 5.1 `fast-xml-parser` `^4.5.0`
- **Why this one:** already adopted by the repository; supports `ignoreAttributes: false`, `attributeNamePrefix: '@_'`, and namespace-prefix removal needed for `uscDoc` compatibility.
- **Alternatives rejected:** replacing the parser would enlarge risk and scope without solving the actual defect.
- **License:** MIT-compatible.
- **Maintenance status:** currently active and already pinned in project dependencies; no new package introduction required.
- **Architecture decision:** retain and rely on existing attribute parsing behavior, specifically `node['@_value']` after namespace prefix removal.

### 5.2 `vitest` `^3.0.0`
- **Why this one:** already used for unit and integration coverage; supports fast fixture-backed regression testing.
- **Alternatives rejected:** no value in mixing test runners for a localized parser issue.
- **License:** MIT-compatible.
- **Maintenance status:** actively maintained and already present in the repo.
- **Architecture decision:** expand current suites rather than adding bespoke test harnesses.

### 5.3 `gray-matter` `^4.0.3`
- **Why this one:** already used by CLI integration tests to inspect generated markdown frontmatter.
- **Alternatives rejected:** hand-rolled YAML frontmatter parsing would add fragility for no gain.
- **License:** MIT-compatible.
- **Maintenance status:** mature and acceptable for current usage.
- **Architecture decision:** keep unchanged; use only for output verification.

### 5.4 No new dependencies
This issue should add **zero** new runtime or dev dependencies.

Rationale:
- string normalization and attribute preference logic are trivial to implement with existing utilities
- runtime XSD validators are explicitly out of scope
- adding schema-validation libraries would slow tests and broaden the attack surface for no accepted requirement

---

## 6. Integration Points

### 6.1 Existing repository integrations

#### Transform parser -> domain model
`src/transforms/uslm-to-ir.ts` populates `TitleIR`, `SectionIR`, `ContentNode`, and parse-error structures from `src/domain/model.js`.

Issue #10 must preserve those model shapes while changing only how canonical numbers are extracted.

#### Transform command -> parser
The built CLI entry continues to call the parser and then write markdown files using parsed title and section numbers.

This issue hardens that integration by ensuring canonical numbers flow through to:
- title directory naming (`title-01`)
- section markdown naming (`section-1.md`)
- report statistics (`sections_found`)

#### Test harness -> cache manifest layout
The selected-vintage integration suite seeds `data/cache/olrc/vintages/{vintage}/title-{NN}/xml_usc{NN}@{vintage}.zip` plus `data/manifest.json`.

Issue #10 does not alter that cache contract. It only changes the XML contents inside fixture ZIPs and the expectations of downstream parsing.

### 6.2 Schema reference integration
`docs/schemas/USLM-1.0.15.xsd` is a reference input for test design, not a runtime dependency.

Required usage:
- structural tests may cite the schema-backed contract
- implementation must not parse or validate the XSD during normal CLI execution

### 6.3 Derived-fixture matrix integration
The multi-title integration suite continues to reuse one committed current-format fixture and derive titles `2..54` through deterministic substitutions inside `buildCurrentFormatFixtureZip(...)`.

Required substitution coverage:
- title doc number
- title identifier paths (`/us/usc/t{N}`)
- title display text
- title source-url fragments used by legacy fixture output assertions where relevant

This keeps test inputs deterministic and auditable without introducing remote dependencies.

---

## 7. Security Considerations

### 7.1 Input validation strategy
XML remains untrusted input at the parser boundary even when sourced from committed fixtures or cached OLRC artifacts.

Security requirements for this issue:
- continue using the existing parser configuration without enabling dangerous runtime evaluation features
- treat `@value` as data, not executable markup
- normalize whitespace deterministically before using `@value` in identifiers or filenames
- continue omitting sections whose canonical number resolves to empty rather than generating malformed paths

### 7.2 Path-safety guarantees
The primary security-sensitive output for this issue is filesystem naming.

Required guarantees:
- decorated display text must not be used directly in output file or directory names
- canonical section numbers used in filenames must come from trusted normalized `@value` or stripped fallback text
- regression tests must explicitly fail if generated paths contain `§`, `Title-`, `Chapter-`, em dash characters, or doubled period artifacts

### 7.3 Denial-of-service / resource posture
This issue does not materially increase parser complexity or memory usage.

Guardrails:
- reuse existing max-normalized-field protections
- avoid runtime schema validation
- keep tests fixture-backed and local to prevent network-induced nondeterminism or unbounded payload expansion

### 7.4 Secrets and sensitive data
No secrets, tokens, cookies, or PII are introduced or processed by this issue.

### 7.5 Auth model / CORS / rate limiting
Not applicable for this issue.

This repository change does not expose an HTTP endpoint or browser-facing surface.

### 7.6 Integrity of canonical-vs-display semantics
A correctness bug here becomes a security-adjacent integrity bug because malformed canonical numbers can route content into wrong files or silently drop sections.

Therefore the architecture requires explicit tests for all of the following:
- non-empty `@value` wins over disagreeing display text
- absent/empty `@value` falls back to deterministic cleanup
- Title 1 current-format fixture yields exactly 53 sections
- chapter count for the refreshed fixture is exactly 1
- legacy fixtures still parse unchanged

---

## Implementation Plan Summary

1. Add one shared pure helper in `src/transforms/uslm-to-ir.ts` for canonical `<num>` extraction.
2. Route title, chapter, and section number reads through that helper.
3. Refresh `tests/fixtures/xml/title-01/04-current-uscdoc.xml` to include:
   - `uscDoc > meta + main`
   - `/us/usc/t1` and `/us/usc/t1/s...` identifiers
   - decorated display text plus canonical `@value`
   - one chapter and 53 sections
4. Extend unit tests for:
   - `@value` present
   - `@value` absent
   - `@value` empty
   - `@value` disagreeing with display text
   - structural XSD-contract assertions
   - chapter-number and section-number alignment with source `@value`
5. Extend CLI integration tests for:
   - Title 1 selected-vintage success with 53 sections
   - path-safety regression assertions
   - deterministic derived-fixture matrix for titles `1..52` and `54`

## Acceptance Mapping

| Spec Requirement | Architectural Mechanism |
|---|---|
| Prefer `@value` for title/chapter/section numbers | Shared canonical `<num>` helper in parser |
| Preserve backward compatibility | Fallback to cleaned display text + unchanged legacy fixtures |
| Prove XSD contract | Refreshed `uscDoc` fixture + structural unit tests against schema-backed expectations |
| Prevent decorated path leakage | CLI integration assertions on generated directory/file names |
| Keep multi-title coverage fixture-backed | Deterministic substitutions from committed Title 1 current-format fixture |
| Keep Title 53 behavior unchanged | No change to reserved-empty cache/transform contract |

## Components Affected

| Component | Change | Impact |
|---|---|---|
| `src/transforms/uslm-to-ir.ts` | Canonical `<num>` extraction helper and call-site replacement | Medium |
| `tests/unit/transforms/uslm-to-ir.test.ts` | Add contract, structure, and mismatch-behavior coverage | Medium |
| `tests/integration/transform-cli.test.ts` | Strengthen selected-vintage and matrix regression assertions | Medium |
| `tests/fixtures/xml/title-01/04-current-uscdoc.xml` | Refresh to real current-format/XSD-aligned structure | Medium |
| `docs/schemas/USLM-1.0.15.xsd` | Reference only; no code change required | Low |

## Explicit Non-Goals
- No runtime XSD validation
- No appendix title support
- No rich-text markdown rendering redesign
- No manifest or cache schema changes
- No new network access patterns
- No new services, queues, or databases
