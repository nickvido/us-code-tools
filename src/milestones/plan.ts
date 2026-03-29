import { normalizeReleasePointTag } from './metadata.js';
import { derivePresidentTags } from './president-tags.js';
import { getCongressYearRange, renderCongressTitle } from './title-renderer.js';
import type { LegalMilestonesMetadata, MilestonesPlan, PlannedAnnualRow, PlanError, ReleaseCandidate } from './types.js';
import { resolveCommitSelector } from './git.js';

export async function buildMilestonesPlan(repoPath: string, metadata: LegalMilestonesMetadata): Promise<{ plan: MilestonesPlan; annualRows: PlannedAnnualRow[] }> {
  const errors: PlanError[] = [];
  const annualRows: PlannedAnnualRow[] = [];

  for (const row of metadata.annual_snapshots) {
    try {
      const commit_sha = await resolveCommitSelector(repoPath, row.commit_selector);
      annualRows.push({
        ...row,
        commit_sha,
        pl_tag: normalizeReleasePointTag(row.release_point, row.congress),
      });
    } catch (error) {
      errors.push({
        code: 'commit_selector_ambiguous',
        message: error instanceof Error ? error.message : `Unable to resolve commit selector '${row.commit_selector}'`,
      });
    }
  }

  annualRows.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date) || a.annual_tag.localeCompare(b.annual_tag));

  const annual_tags = annualRows.map((row) => ({ tag: row.annual_tag, commit_sha: row.commit_sha, snapshot_date: row.snapshot_date }));
  const pl_tags = annualRows.map((row) => ({ tag: row.pl_tag, commit_sha: row.commit_sha, release_point: row.release_point }));
  const congressBoundaryRows = annualRows.filter((row) => row.is_congress_boundary);
  const congress_tags = congressBoundaryRows.map((row) => ({ tag: `congress/${row.congress}`, commit_sha: row.commit_sha, annual_tag: row.annual_tag }));

  const { presidentTags, skippedPresidentTags } = derivePresidentTags(annualRows, metadata.president_terms);
  const president_tags = presidentTags.map((row) => ({ tag: row.tag, commit_sha: row.commit_sha, annual_tag: row.annual_tag }));

  const release_candidates: ReleaseCandidate[] = [];
  for (let index = 0; index < congressBoundaryRows.length; index += 1) {
    const row = congressBoundaryRows[index];
    const previous = congressBoundaryRows[index - 1];
    const { startYear, endYear } = getCongressYearRange(row.congress);
    release_candidates.push({
      tag: `congress/${row.congress}`,
      tag_sha: row.commit_sha,
      previous_tag: previous ? `congress/${previous.congress}` : null,
      previous_tag_sha: previous ? previous.commit_sha : null,
      title: renderCongressTitle(row.congress),
      start_date: String(startYear),
      end_date: String(endYear),
    });
  }

  return {
    annualRows,
    plan: {
      annual_tags,
      pl_tags,
      congress_tags,
      president_tags,
      skipped_president_tags: skippedPresidentTags,
      release_candidates,
      errors,
    },
  };
}
