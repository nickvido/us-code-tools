import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import constitutionDataset from './constitution/dataset.js';
import { commitHistoricalEvent, git } from './git-adapter.js';
import { buildConstitutionPlan } from './planner.js';
import { prepareTargetRepo } from './target-repo.js';

export interface BackfillSummary {
  phase: 'constitution';
  target: string;
  eventsPlanned: number;
  eventsApplied: number;
  eventsSkipped: number;
  pushResult: 'pushed' | 'skipped-local-only';
}

export async function runConstitutionBackfill(target: string): Promise<BackfillSummary> {
  const plan = buildConstitutionPlan(constitutionDataset);
  const prepared = await prepareTargetRepo(target, plan);
  let eventsApplied = 0;

  for (const event of plan.slice(prepared.matchingPrefixLength)) {
    for (const file of event.writes) {
      const absolutePath = resolve(prepared.repoPath, file.path);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, file.content, 'utf8');
    }

    await commitHistoricalEvent(prepared.repoPath, prepared.branch, event);
    eventsApplied += 1;
  }

  let pushResult: 'pushed' | 'skipped-local-only' = 'skipped-local-only';
  if (prepared.pushRemoteName !== null) {
    try {
      await git(prepared.repoPath, ['push', '--set-upstream', prepared.pushRemoteName, prepared.branch]);
      pushResult = 'pushed';
    } catch (error) {
      throw new Error(`failed to push Constitution backfill to configured remote: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    phase: 'constitution',
    target: prepared.repoPath,
    eventsPlanned: plan.length,
    eventsApplied,
    eventsSkipped: plan.length - eventsApplied,
    pushResult,
  };
}
