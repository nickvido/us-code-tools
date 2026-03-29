import type { PlannedAnnualRow } from './types.js';

function renderDiffStatSection(diffStat: string | null): string {
  if (diffStat === null) {
    return '## Diff Stat\n\nBaseline release: no prior congress tag in scope.';
  }

  return `## Diff Stat\n\n${diffStat}`;
}

export function renderReleaseBody(boundaryRow: PlannedAnnualRow, diffStat: string | null): string {
  const summary = boundaryRow.release_notes.summary_counts;
  const notableLaws = boundaryRow.release_notes.notable_laws.map((law) => `- ${law}`).join('\n');

  return [
    renderDiffStatSection(diffStat),
    '## Summary',
    `- Titles changed: ${summary.titles_changed}`,
    `- Chapters changed: ${summary.chapters_changed}`,
    `- Sections added: ${summary.sections_added}`,
    `- Sections amended: ${summary.sections_amended}`,
    `- Sections repealed: ${summary.sections_repealed}`,
    '## Notable Laws',
    notableLaws || '- None',
    '## Narrative',
    boundaryRow.release_notes.narrative,
  ].join('\n\n');
}

export function resolveBoundaryRowForCongress(annualRows: PlannedAnnualRow[], congress: number): PlannedAnnualRow {
  const matchingRows = annualRows.filter(
    (row) => row.congress === congress && row.is_congress_boundary && row.release_notes.scope === 'congress',
  );

  if (matchingRows.length !== 1) {
    throw new Error(
      `metadata_invalid: expected exactly one congress boundary row with release_notes.scope=\"congress\" for 'congress/${congress}'`,
    );
  }

  return matchingRows[0];
}
