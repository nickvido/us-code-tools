import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { MilestonesManifest, PlannedAnnualRow, PresidentTagPlan, ReleaseCandidate, SkippedPresidentTag } from './types.js';

export async function computeMetadataDigest(metadataPath: string): Promise<string> {
  const buffer = await readFile(metadataPath);
  return createHash('sha256').update(buffer).digest('hex');
}

export async function writeManifest(
  repoPath: string,
  metadataPath: string,
  annualRows: PlannedAnnualRow[],
  presidentTags: PresidentTagPlan[],
  skippedPresidentTags: SkippedPresidentTag[],
  releaseCandidates: ReleaseCandidate[],
): Promise<void> {
  const dirPath = resolve(repoPath, '.us-code-tools');
  const manifestPath = resolve(dirPath, 'milestones.json');
  const tempPath = resolve(dirPath, 'milestones.json.tmp');
  await mkdir(dirPath, { recursive: true });

  const manifest: MilestonesManifest = {
    version: 1,
    metadata: {
      path: metadataPath,
      sha256: await computeMetadataDigest(metadataPath),
    },
    annual_rows: annualRows.map((row) => ({
      annual_tag: row.annual_tag,
      annual_tag_sha: row.commit_sha,
      pl_tag: row.pl_tag,
      pl_tag_sha: row.commit_sha,
      snapshot_date: row.snapshot_date,
      release_point: row.release_point,
      congress: row.congress,
      president_term: row.president_term,
      commit_sha: row.commit_sha,
      is_congress_boundary: row.is_congress_boundary,
    })),
    congress_tags: annualRows.filter((row) => row.is_congress_boundary).map((row) => ({
      tag: `congress/${row.congress}`,
      congress: row.congress,
      commit_sha: row.commit_sha,
      annual_tag: row.annual_tag,
    })),
    president_tags: presidentTags.map((row) => ({
      tag: row.tag,
      slug: row.slug,
      inauguration_date: row.inauguration_date,
      commit_sha: row.commit_sha,
      annual_tag: row.annual_tag,
    })),
    skipped_president_tags: skippedPresidentTags,
    release_candidates: releaseCandidates,
  };

  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(tempPath, content, { mode: 0o600 });
  await rename(tempPath, manifestPath);
}

export async function readManifest(repoPath: string): Promise<MilestonesManifest> {
  const manifestPath = resolve(repoPath, '.us-code-tools', 'milestones.json');
  const content = await readFile(manifestPath, 'utf8');
  return JSON.parse(content) as MilestonesManifest;
}

export async function withLock<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
  const dirPath = resolve(repoPath, '.us-code-tools');
  const lockPath = resolve(dirPath, 'milestones.lock');
  await mkdir(dirPath, { recursive: true });
  try {
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, timestamp: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  } catch {
    throw new Error('lock_conflict: another milestones command is already running');
  }

  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true });
  }
}
