import type { PlannedAnnualRow, PresidentTermRow, PresidentTagPlan, SkippedPresidentTag } from './types.js';

export function derivePresidentTags(
  annualRows: PlannedAnnualRow[],
  presidentTerms: PresidentTermRow[],
): { presidentTags: PresidentTagPlan[]; skippedPresidentTags: SkippedPresidentTag[] } {
  const presidentTags: PresidentTagPlan[] = [];
  const skippedPresidentTags: SkippedPresidentTag[] = [];

  if (annualRows.length === 0) {
    return { presidentTags, skippedPresidentTags };
  }

  const coverageStart = annualRows[0].snapshot_date;
  const coverageEnd = annualRows[annualRows.length - 1].snapshot_date;

  for (const term of presidentTerms) {
    if (term.inauguration_date < coverageStart) {
      skippedPresidentTags.push({
        slug: term.slug,
        inauguration_date: term.inauguration_date,
        reason: 'inauguration_before_coverage_window',
      });
      continue;
    }

    const annualRow = annualRows.find((row) => row.snapshot_date >= term.inauguration_date);
    if (!annualRow || term.inauguration_date > coverageEnd) {
      skippedPresidentTags.push({
        slug: term.slug,
        inauguration_date: term.inauguration_date,
        reason: 'no_snapshot_on_or_after_inauguration',
      });
      continue;
    }

    presidentTags.push({
      tag: `president/${term.slug}`,
      commit_sha: annualRow.commit_sha,
      annual_tag: annualRow.annual_tag,
      slug: term.slug,
      inauguration_date: term.inauguration_date,
    });
  }

  return { presidentTags, skippedPresidentTags };
}
