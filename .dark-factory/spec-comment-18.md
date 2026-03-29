## [spec-writer] — Spec revised after review
See `docs/specs/18-spec.md` for the canonical spec.

Addressed all findings from the latest `spec-review` comment:

1. **Resolved the day-one `pl/*` contradiction**
   - Added an explicit scope-reconciliation note in the spec context.
   - Clarified that day-one preserves the annual release-point public law as metadata (`release_point`) and manifest data, but intentionally does **not** create `pl/*` git tags until the project has commit-per-law history.
   - Kept `pl/*` validation behavior explicit and testable so implementers have one authoritative rule.

2. **Made release `Summary` and `Narrative` fully deterministic**
   - Expanded the required metadata schema so each annual row must include `release_notes.summary_counts.{titles_changed, chapters_changed, sections_added, sections_amended, sections_repealed}` and `release_notes.narrative` in addition to `release_notes.notable_laws[]`.
   - Updated release rendering criteria so `## Summary` renders those exact numeric metadata fields and `## Narrative` renders the exact metadata string, removing open-ended synthesis.
   - Added validation requirements for negative summary counts and empty narrative text.

3. **Defined first-release behavior explicitly**
   - Updated planning requirements so the earliest in-scope Congress release candidate uses `previous_tag: null` and `previous_tag_sha: null`.
   - Updated release rendering so that baseline release bodies use the exact sentence `Baseline release: no prior congress tag in scope.` instead of attempting `git diff` against a nonexistent predecessor.
   - Added acceptance-test, edge-case, and verification coverage for this baseline-release path.

Net effect: the spec now has a single authoritative day-one tag policy, a fully specified deterministic metadata/rendering contract for release bodies, and an explicit testable rule for the first in-scope Congress release.
