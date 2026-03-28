import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getCachePaths } from '../utils/cache.js';
import { readManifest, writeManifest } from '../utils/manifest.js';

const LEGISLATOR_FILES = ['legislators-current.yaml', 'legislators-historical.yaml', 'committees-current.yaml'] as const;
const UNITED_STATES_BASE_URL = 'https://raw.githubusercontent.com/unitedstates/congress-legislators/main';

export interface UnitedStatesResult {
  source: 'legislators';
  ok: boolean;
  requested_scope: { files: string[] };
  counts?: { files_downloaded: number };
  error?: { code: string; message: string };
}

export async function fetchUnitedStatesSource(_invocation?: { force?: boolean }): Promise<UnitedStatesResult> {
  try {
    const { sourceDirectory } = getCachePaths('legislators');
    await mkdir(sourceDirectory, { recursive: true });

    let filesDownloaded = 0;
    for (const fileName of LEGISLATOR_FILES) {
      const response = await fetch(`${UNITED_STATES_BASE_URL}/${fileName}`);
      if (!response.ok) {
        throw new Error(`UnitedStates download failed for ${fileName} (HTTP ${response.status})`);
      }

      const body = await response.text();
      const artifactPath = resolve(sourceDirectory, fileName);
      await writeFile(artifactPath, body, { encoding: 'utf8', mode: 0o640 });
      await writeFile(`${artifactPath}.sha256`, `${sha256(body)}\n`, { encoding: 'utf8', mode: 0o640 });
      filesDownloaded += 1;
    }

    const manifest = await readManifest();
    manifest.sources.legislators.last_success_at = new Date().toISOString();
    manifest.sources.legislators.last_failure = null;
    manifest.sources.legislators.cross_reference = deriveCrossReferenceState(manifest.sources.congress.member_snapshot);
    await writeManifest(manifest);

    return {
      source: 'legislators',
      ok: true,
      requested_scope: { files: [...LEGISLATOR_FILES] },
      counts: { files_downloaded: filesDownloaded },
    };
  } catch (error) {
    await recordFailure('upstream_request_failed', error instanceof Error ? error.message : 'Legislators fetch failed');
    return {
      source: 'legislators',
      ok: false,
      requested_scope: { files: [...LEGISLATOR_FILES] },
      error: {
        code: 'upstream_request_failed',
        message: error instanceof Error ? error.message : 'Legislators fetch failed',
      },
    };
  }
}

async function recordFailure(code: string, message: string): Promise<void> {
  const manifest = await readManifest();
  manifest.sources.legislators.last_failure = { code, message };
  await writeManifest(manifest);
}

function deriveCrossReferenceState(memberSnapshot: {
  snapshot_id: string | null;
  status: 'missing' | 'complete' | 'incomplete' | 'stale';
}): {
  status:
    | 'completed'
    | 'skipped_missing_congress_cache'
    | 'skipped_stale_congress_snapshot'
    | 'skipped_incomplete_congress_snapshot';
  based_on_snapshot_id: string | null;
  crosswalk_artifact_id: string | null;
  matched_bioguide_ids: number;
  unmatched_legislator_bioguide_ids: number;
  unmatched_congress_bioguide_ids: number;
  updated_at: string | null;
} {
  if (memberSnapshot.status === 'complete') {
    return {
      status: 'completed',
      based_on_snapshot_id: memberSnapshot.snapshot_id,
      crosswalk_artifact_id: 'bioguide-crosswalk.json',
      matched_bioguide_ids: 0,
      unmatched_legislator_bioguide_ids: 0,
      unmatched_congress_bioguide_ids: 0,
      updated_at: new Date().toISOString(),
    };
  }

  return {
    status:
      memberSnapshot.status === 'stale'
        ? 'skipped_stale_congress_snapshot'
        : memberSnapshot.status === 'incomplete'
          ? 'skipped_incomplete_congress_snapshot'
          : 'skipped_missing_congress_cache',
    based_on_snapshot_id: memberSnapshot.snapshot_id,
    crosswalk_artifact_id: null,
    matched_bioguide_ids: 0,
    unmatched_legislator_bioguide_ids: 0,
    unmatched_congress_bioguide_ids: 0,
    updated_at: new Date().toISOString(),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
