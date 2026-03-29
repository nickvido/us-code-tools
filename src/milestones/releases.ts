import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { computeMetadataDigest, readManifest } from './manifest.js';
import type { MilestonesPlan } from './types.js';

const execFileAsync = promisify(execFile);

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

export async function releaseMilestones(repoPath: string, metadataPath: string, plan: MilestonesPlan): Promise<void> {
  let manifest;
  try {
    manifest = await readManifest(repoPath);
  } catch {
    throw new Error('manifest_missing: milestone manifest is missing');
  }

  const digest = await computeMetadataDigest(metadataPath);
  if (manifest.metadata?.sha256 !== digest) {
    throw new Error('manifest_stale: milestone manifest metadata digest does not match current metadata');
  }

  const currentShape = {
    annual_rows: plan.annual_tags,
    congress_tags: plan.congress_tags,
    president_tags: plan.president_tags,
    skipped_president_tags: plan.skipped_president_tags,
    release_candidates: plan.release_candidates,
  };
  const manifestShape = {
    annual_rows: manifest.annual_rows.map((row) => ({ tag: row.annual_tag, commit_sha: row.commit_sha, snapshot_date: row.snapshot_date })),
    congress_tags: manifest.congress_tags,
    president_tags: manifest.president_tags.map((row) => ({ tag: row.tag, commit_sha: row.commit_sha, annual_tag: row.annual_tag })),
    skipped_president_tags: manifest.skipped_president_tags,
    release_candidates: manifest.release_candidates,
  };

  if (stableStringify(currentShape) !== stableStringify(manifestShape)) {
    throw new Error('manifest_stale: milestone manifest does not match the current repository plan');
  }

  await execFileAsync('gh', ['auth', 'status']).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'gh auth status failed';
    if (message.includes('ENOENT')) {
      throw new Error('github_cli_unavailable: gh CLI is not installed');
    }
    throw new Error('github_cli_auth_missing: gh CLI is not authenticated');
  });
}
