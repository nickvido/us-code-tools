import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getCachePaths } from '../utils/cache.js';
import { readManifest, writeManifest } from '../utils/manifest.js';

const VOTEVIEW_FILES = ['HSall_members.csv', 'HSall_votes.csv', 'HSall_rollcalls.csv'] as const;
const VOTEVIEW_BASE_URL = 'https://voteview.com/static/data/out';

export interface VoteViewResult {
  source: 'voteview';
  ok: boolean;
  requested_scope: { files: string[] };
  counts?: { files_downloaded: number };
  error?: { code: string; message: string };
}

export async function fetchVoteViewSource(invocation?: { force?: boolean }): Promise<VoteViewResult> {
  try {
    const { sourceDirectory } = getCachePaths('voteview');
    await mkdir(sourceDirectory, { recursive: true });

    let filesDownloaded = 0;
    for (const fileName of VOTEVIEW_FILES) {
      const response = await fetch(`${VOTEVIEW_BASE_URL}/${fileName}`);
      if (!response.ok) {
        throw new Error(`VoteView download failed for ${fileName} (HTTP ${response.status})`);
      }

      const body = await response.text();
      const artifactPath = resolve(sourceDirectory, fileName);
      await writeFile(artifactPath, body, { encoding: 'utf8', mode: 0o640 });
      await writeFile(`${artifactPath}.sha256`, `${sha256(body)}\n`, { encoding: 'utf8', mode: 0o640 });
      filesDownloaded += 1;
    }

    const manifest = await readManifest();
    manifest.sources.voteview = {
      last_success_at: new Date().toISOString(),
      last_failure: null,
    };
    await writeManifest(manifest);

    return {
      source: 'voteview',
      ok: true,
      requested_scope: { files: [...VOTEVIEW_FILES] },
      counts: { files_downloaded: filesDownloaded },
    };
  } catch (error) {
    await recordFailure('voteview', 'upstream_request_failed', error instanceof Error ? error.message : 'VoteView fetch failed');
    return {
      source: 'voteview',
      ok: false,
      requested_scope: { files: [...VOTEVIEW_FILES] },
      error: {
        code: 'upstream_request_failed',
        message: error instanceof Error ? error.message : 'VoteView fetch failed',
      },
    };
  }
}

async function recordFailure(source: 'voteview', code: string, message: string): Promise<void> {
  const manifest = await readManifest();
  manifest.sources[source] = {
    last_success_at: manifest.sources[source].last_success_at,
    last_failure: { code, message },
  };
  await writeManifest(manifest);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
