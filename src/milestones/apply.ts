import { createAnnotatedTag, ensureAttachedHead, ensureCleanWorkingTree, resolveGitBinary } from './git.js';
import { withLock, writeManifest } from './manifest.js';
import type { PlannedAnnualRow, PresidentTagPlan, ReleaseCandidate, SkippedPresidentTag } from './types.js';

function annualMessage(year: string): string {
  return `Annual OLRC snapshot for ${year}`;
}

export async function applyMilestones(
  repoPath: string,
  annualRows: PlannedAnnualRow[],
  presidentTags: PresidentTagPlan[],
  skippedPresidentTags: SkippedPresidentTag[],
  releaseCandidates: ReleaseCandidate[],
  metadataPath: string,
): Promise<void> {
  await resolveGitBinary();
  await ensureAttachedHead(repoPath);
  await ensureCleanWorkingTree(repoPath);

  await withLock(repoPath, `milestones apply --target ${repoPath} --metadata ${metadataPath}`, async () => {
    for (const row of annualRows) {
      const year = row.annual_tag.replace('annual/', '');
      await createAnnotatedTag(repoPath, row.annual_tag, row.commit_sha, annualMessage(year));
      await createAnnotatedTag(repoPath, row.pl_tag, row.commit_sha, `Annual snapshot current through Public Law ${row.congress}-${row.pl_tag.split('-')[1]}`);
      if (row.is_congress_boundary) {
        await createAnnotatedTag(repoPath, `congress/${row.congress}`, row.commit_sha, `Congress boundary for the ${row.congress}th Congress`);
      }
    }

    for (const tag of presidentTags) {
      await createAnnotatedTag(repoPath, tag.tag, tag.commit_sha, `Presidential term boundary for ${tag.slug}`);
    }

    await writeManifest(repoPath, metadataPath, annualRows, presidentTags, skippedPresidentTags, releaseCandidates);
  });
}
