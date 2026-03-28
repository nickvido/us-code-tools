import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { resolve } from 'node:path';
import type { CongressMemberSnapshotState } from '../utils/manifest.js';

export interface CongressMemberSnapshotFreshness {
  isReusable: boolean;
  rebuildStatus: 'missing' | 'incomplete' | 'stale';
}

export async function evaluateCongressMemberSnapshotFreshness(
  snapshot: CongressMemberSnapshotState,
  sourceDirectory: string,
  now = Date.now(),
): Promise<CongressMemberSnapshotFreshness> {
  if (snapshot.status !== 'complete') {
    return {
      isReusable: false,
      rebuildStatus:
        snapshot.status === 'incomplete'
          ? 'incomplete'
          : snapshot.status === 'missing'
            ? 'missing'
            : 'stale',
    };
  }

  if (snapshot.snapshot_completed_at === null || snapshot.cache_ttl_ms === null) {
    return { isReusable: false, rebuildStatus: 'stale' };
  }

  const completedAt = Date.parse(snapshot.snapshot_completed_at);
  if (!Number.isFinite(completedAt) || completedAt + snapshot.cache_ttl_ms <= now) {
    return { isReusable: false, rebuildStatus: 'stale' };
  }

  if (snapshot.artifacts.length === 0) {
    return { isReusable: false, rebuildStatus: 'stale' };
  }

  for (const artifact of snapshot.artifacts) {
    try {
      await access(resolve(sourceDirectory, artifact), fsConstants.F_OK);
    } catch {
      return { isReusable: false, rebuildStatus: 'stale' };
    }
  }

  return { isReusable: true, rebuildStatus: 'stale' };
}
