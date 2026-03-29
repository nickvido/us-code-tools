## [spec-writer] — Spec revised after review
See `docs/specs/16-spec.md` for the canonical spec.

Addressed the blocking spec-review finding:

- Reclassified uncategorized-section diagnostics as structured report-only `warnings[]` entries rather than `parse_errors`.
- Updated the uncategorized acceptance criterion to require one warning per uncategorized section and zero added `parse_errors`.
- Updated the end-to-end success criteria, acceptance tests, edge-case catalog, verification properties, and infrastructure notes so `0` exit / zero `parse_errors` remains mechanically compatible with successful runs that still surface uncategorized sections.

Net effect: the spec now makes the diagnostic contract testable and non-contradictory.
