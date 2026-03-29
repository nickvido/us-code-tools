import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { readManifest, computeMetadataDigest } from './manifest.js';
import { normalizeReleasePointTag } from './metadata.js';
import { renderReleaseBody, resolveBoundaryRowForCongress } from './release-renderer.js';
import type { LegalMilestonesMetadata, MilestonesManifest, MilestonesPlan, PlannedAnnualRow } from './types.js';
import { git, resolveCommitSelector } from './git.js';

const execFileAsync = promisify(execFile);
const DIFF_STAT_TIMEOUT_MS = 30_000;

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function normalizeManifestShape(manifest: MilestonesManifest) {
  return {
    annual_rows: manifest.annual_rows.map((row) => ({
      tag: row.annual_tag,
      commit_sha: row.commit_sha,
      snapshot_date: row.snapshot_date,
    })),
    pl_tags: manifest.annual_rows.map((row) => ({
      tag: row.pl_tag,
      commit_sha: row.pl_tag_sha,
      release_point: row.release_point,
    })),
    congress_tags: manifest.congress_tags.map((row) => ({
      tag: row.tag,
      commit_sha: row.commit_sha,
      annual_tag: row.annual_tag,
    })),
    president_tags: manifest.president_tags.map((row) => ({
      tag: row.tag,
      commit_sha: row.commit_sha,
      annual_tag: row.annual_tag,
    })),
    skipped_president_tags: manifest.skipped_president_tags,
    release_candidates: manifest.release_candidates,
  };
}

async function resolveTagSha(repoPath: string, tag: string): Promise<string> {
  const sha = await git(repoPath, ['rev-list', '-n', '1', tag]).catch(() => '');
  if (!sha) {
    throw new Error(`manifest_stale: tag '${tag}' is missing from the target repository`);
  }
  return sha;
}

async function normalizeCurrentRepoShape(repoPath: string, plan: MilestonesPlan) {
  const annual_rows = await Promise.all(
    plan.annual_tags.map(async (row) => ({
      tag: row.tag,
      commit_sha: await resolveTagSha(repoPath, row.tag),
      snapshot_date: row.snapshot_date,
    })),
  );

  const pl_tags = await Promise.all(
    plan.pl_tags.map(async (row) => ({
      tag: row.tag,
      commit_sha: await resolveTagSha(repoPath, row.tag),
      release_point: row.release_point,
    })),
  );

  const congress_tags = await Promise.all(
    plan.congress_tags.map(async (row) => ({
      tag: row.tag,
      commit_sha: await resolveTagSha(repoPath, row.tag),
      annual_tag: row.annual_tag,
    })),
  );

  const president_tags = await Promise.all(
    plan.president_tags.map(async (row) => ({
      tag: row.tag,
      commit_sha: await resolveTagSha(repoPath, row.tag),
      annual_tag: row.annual_tag,
    })),
  );

  const release_candidates = await Promise.all(
    plan.release_candidates.map(async (row) => ({
      ...row,
      tag_sha: await resolveTagSha(repoPath, row.tag),
      previous_tag_sha: row.previous_tag ? await resolveTagSha(repoPath, row.previous_tag) : null,
    })),
  );

  return {
    annual_rows,
    pl_tags,
    congress_tags,
    president_tags,
    skipped_president_tags: plan.skipped_president_tags,
    release_candidates,
  };
}

async function ensureGithubCliAvailableAndAuthenticated(): Promise<void> {
  await execFileAsync('gh', ['auth', 'status']).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'gh auth status failed';
    if (message.includes('ENOENT')) {
      throw new Error('github_cli_unavailable: gh CLI is not installed');
    }
    throw new Error('github_cli_auth_missing: gh CLI is not authenticated');
  });
}

async function buildPlannedAnnualRows(repoPath: string, metadata: LegalMilestonesMetadata): Promise<PlannedAnnualRow[]> {
  const annualRows = await Promise.all(
    metadata.annual_snapshots.map(async (row) => ({
      ...row,
      commit_sha: await resolveCommitSelector(repoPath, row.commit_selector),
      pl_tag: normalizeReleasePointTag(row.release_point, row.congress),
    })),
  );

  annualRows.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date) || a.annual_tag.localeCompare(b.annual_tag));
  return annualRows;
}

async function renderDiffStat(repoPath: string, previousTag: string | null, currentTag: string): Promise<string | null> {
  if (previousTag === null) {
    return null;
  }

  const { stdout } = await execFileAsync(
    'git',
    ['-C', repoPath, 'diff', '--stat', `${previousTag}..${currentTag}`],
    { timeout: DIFF_STAT_TIMEOUT_MS },
  ).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'git diff --stat failed';
    throw new Error(`github_release_write_failed: unable to render diff stat for '${currentTag}': ${message}`);
  });

  return stdout.trim();
}

async function writeNotesFile(body: string): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'us-code-tools-release-'));
  const path = join(dir, 'notes.md');
  await writeFile(path, body, 'utf8');
  return { dir, path };
}

async function upsertRelease(tag: string, title: string, body: string): Promise<void> {
  const notes = await writeNotesFile(body);

  try {
    const releaseExists = await execFileAsync('gh', ['release', 'view', tag, '--json', 'tagName,url,name'])
      .then(() => true)
      .catch(() => false);

    if (releaseExists) {
      await execFileAsync('gh', ['release', 'edit', tag, '--title', title, '--notes-file', notes.path]).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'gh release edit failed';
        throw new Error(`github_release_write_failed: failed to update release '${tag}': ${message}`);
      });
      return;
    }

    await execFileAsync('gh', ['release', 'create', tag, '--title', title, '--notes-file', notes.path]).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'gh release create failed';
      throw new Error(`github_release_write_failed: failed to create release '${tag}': ${message}`);
    });
  } finally {
    await rm(notes.dir, { recursive: true, force: true });
  }
}

export async function releaseMilestones(
  repoPath: string,
  metadataPath: string,
  metadata: LegalMilestonesMetadata,
  plan: MilestonesPlan,
): Promise<void> {
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

  if (stableStringify(await normalizeCurrentRepoShape(repoPath, plan)) !== stableStringify(normalizeManifestShape(manifest))) {
    throw new Error('manifest_stale: milestone manifest does not match the current repository plan');
  }

  await ensureGithubCliAvailableAndAuthenticated();

  const annualRows = await buildPlannedAnnualRows(repoPath, metadata);

  for (const releaseCandidate of plan.release_candidates) {
    const congress = Number(releaseCandidate.tag.replace('congress/', ''));
    const boundaryRow = resolveBoundaryRowForCongress(annualRows, congress);
    const diffStat = await renderDiffStat(repoPath, releaseCandidate.previous_tag, releaseCandidate.tag);
    const body = renderReleaseBody(boundaryRow, diffStat);
    await upsertRelease(releaseCandidate.tag, releaseCandidate.title, body);
  }
}
