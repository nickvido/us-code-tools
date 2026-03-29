import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type CandidateModule = Record<string, unknown>;

type JsonResponse = {
  ok?: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
};

function pickCallable(module: CandidateModule, candidates: string[]) {
  for (const name of candidates) {
    const value = module[name as keyof CandidateModule];
    if (typeof value === 'function') {
      return value as (...args: unknown[]) => Promise<unknown> | unknown;
    }
  }

  throw new Error(`No callable export found for: ${candidates.join(', ')}`);
}

async function importFresh(modulePath: string): Promise<CandidateModule> {
  vi.resetModules();
  return (await import(pathToFileURL(modulePath).href)) as CandidateModule;
}

function makeTextResponse(body: string, contentType: string): JsonResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => contentType },
    text: async () => body,
    arrayBuffer: async () => Uint8Array.from(Buffer.from(body, 'utf8')).buffer,
  };
}

async function withStubbedFetch<T>(handler: (url: string) => JsonResponse | Promise<JsonResponse>, run: () => Promise<T>) {
  const originalFetch = globalThis.fetch;
  const mockFetch = vi.fn(async (input: RequestInfo | URL) => handler(String(input)) as never);
  globalThis.fetch = mockFetch as typeof fetch;

  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function readManifest(tempDataDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(tempDataDir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
}

function writeManifest(tempDataDir: string, manifest: Record<string, unknown>) {
  mkdirSync(tempDataDir, { recursive: true });
  writeFileSync(resolve(tempDataDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

function createBaseManifest(overrides?: Record<string, unknown>) {
  return {
    version: 1,
    updated_at: '2026-03-28T00:00:00.000Z',
    sources: {
      olrc: { selected_vintage: null, last_success_at: null, last_failure: null, titles: {} },
      congress: {
        last_success_at: null,
        last_failure: null,
        bulk_scope: null,
        member_snapshot: {
          snapshot_id: null,
          status: 'missing',
          snapshot_completed_at: null,
          cache_ttl_ms: null,
          member_page_count: 0,
          member_detail_count: 0,
          failed_member_details: [],
          artifacts: [],
        },
        congress_runs: {},
        bulk_history_checkpoint: null,
      },
      govinfo: { last_success_at: null, last_failure: null, query_scopes: {}, checkpoints: {} },
      voteview: { last_success_at: null, last_failure: null, files: {}, indexes: [] },
      legislators: {
        last_success_at: null,
        last_failure: null,
        files: {},
        cross_reference: {
          status: 'skipped_missing_congress_cache',
          based_on_snapshot_id: null,
          crosswalk_artifact_id: null,
          matched_bioguide_ids: 0,
          unmatched_legislator_bioguide_ids: 0,
          unmatched_congress_bioguide_ids: 0,
          updated_at: null,
        },
      },
    },
    runs: [],
    ...overrides,
  } satisfies Record<string, unknown>;
}

afterEach(() => {
  delete process.env.US_CODE_TOOLS_DATA_DIR;
  vi.restoreAllMocks();
});

describe('adversary regressions for issue #5 — round 9', () => {
  it('removes a previously written legislators crosswalk when a later run skips cross-reference because the latest Congress snapshot is stale', async () => {
    const root = process.cwd();
    const tempDataDir = mkdtempSync(join(tmpdir(), 'us-code-tools-legislators-stale-crosswalk-'));
    const nowMs = Date.now();
    const initialFreshSnapshotCompletedAt = new Date(nowMs - 60_000).toISOString();
    const staleSnapshotCompletedAt = new Date(nowMs - 120_000).toISOString();
    process.env.US_CODE_TOOLS_DATA_DIR = tempDataDir;

    const freshSnapshotDir = resolve(tempDataDir, 'cache', 'congress', 'members', 'snapshots', 'snapshot-fresh');
    mkdirSync(resolve(freshSnapshotDir, 'pages'), { recursive: true });
    mkdirSync(resolve(freshSnapshotDir, 'details'), { recursive: true });
    writeFileSync(
      resolve(freshSnapshotDir, 'pages', 'page-1.json'),
      JSON.stringify({
        members: [{ bioguideId: 'A000360' }, { bioguideId: 'C000003' }],
        pagination: { next: null, count: 2 },
      }),
    );
    writeFileSync(resolve(freshSnapshotDir, 'details', 'A000360.json'), JSON.stringify({ member: { bioguideId: 'A000360' } }));
    writeFileSync(resolve(freshSnapshotDir, 'details', 'C000003.json'), JSON.stringify({ member: { bioguideId: 'C000003' } }));

    writeManifest(tempDataDir, createBaseManifest({
      sources: {
        olrc: { selected_vintage: null, last_success_at: null, last_failure: null, titles: {} },
        congress: {
          last_success_at: initialFreshSnapshotCompletedAt,
          last_failure: null,
          bulk_scope: null,
          member_snapshot: {
            snapshot_id: 'snapshot-fresh',
            status: 'complete',
            snapshot_completed_at: initialFreshSnapshotCompletedAt,
            cache_ttl_ms: 86_400_000,
            member_page_count: 1,
            member_detail_count: 2,
            failed_member_details: [],
            artifacts: [
              'members/snapshots/snapshot-fresh/pages/page-1.json',
              'members/snapshots/snapshot-fresh/details/A000360.json',
              'members/snapshots/snapshot-fresh/details/C000003.json',
            ],
          },
          congress_runs: {},
          bulk_history_checkpoint: null,
        },
        govinfo: { last_success_at: null, last_failure: null, query_scopes: {}, checkpoints: {} },
        voteview: { last_success_at: null, last_failure: null, files: {}, indexes: [] },
        legislators: {
          last_success_at: null,
          last_failure: null,
          files: {},
          cross_reference: {
            status: 'skipped_missing_congress_cache',
            based_on_snapshot_id: null,
            crosswalk_artifact_id: null,
            matched_bioguide_ids: 0,
            unmatched_legislator_bioguide_ids: 0,
            unmatched_congress_bioguide_ids: 0,
            updated_at: null,
          },
        },
      },
    }));

    const legislatorsMod = await importFresh(resolve(root, 'src', 'sources', 'unitedstates.ts'));
    const fetchUnitedStatesSource = pickCallable(legislatorsMod, ['fetchUnitedStatesSource', 'fetchLegislatorsSource']);

    const yamlBodies: Record<string, string> = {
      'legislators-current.yaml': '- id:\n    bioguide: A000360\n',
      'legislators-historical.yaml': '- id:\n    bioguide: B000001\n',
      'committees-current.yaml': '- thomas_id: HSAG\n',
    };

    try {
      await withStubbedFetch(async (url) => {
        const matched = Object.keys(yamlBodies).find((filename) => url.endsWith(filename));
        if (!matched) {
          throw new Error(`Unexpected legislators URL during initial crosswalk build: ${url}`);
        }

        return makeTextResponse(yamlBodies[matched], 'application/x-yaml');
      }, async () => {
        // NOTE: Use the existing production signature; do not add a test-only overload.
        await fetchUnitedStatesSource({ force: false });
      });

      const crosswalkPath = resolve(tempDataDir, 'cache', 'legislators', 'bioguide-crosswalk.json');
      expect(existsSync(crosswalkPath)).toBe(true);

      writeManifest(tempDataDir, createBaseManifest({
        sources: {
          olrc: { selected_vintage: null, last_success_at: null, last_failure: null, titles: {} },
          congress: {
            last_success_at: staleSnapshotCompletedAt,
            last_failure: null,
            bulk_scope: null,
            member_snapshot: {
              snapshot_id: 'snapshot-fresh',
              status: 'complete',
              snapshot_completed_at: staleSnapshotCompletedAt,
              cache_ttl_ms: 60_000,
              member_page_count: 1,
              member_detail_count: 2,
              failed_member_details: [],
              artifacts: [
                'members/snapshots/snapshot-fresh/pages/page-1.json',
                'members/snapshots/snapshot-fresh/details/A000360.json',
                'members/snapshots/snapshot-fresh/details/C000003.json',
              ],
            },
            congress_runs: {},
            bulk_history_checkpoint: null,
          },
          govinfo: { last_success_at: null, last_failure: null, query_scopes: {}, checkpoints: {} },
          voteview: { last_success_at: null, last_failure: null, files: {}, indexes: [] },
          legislators: {
            last_success_at: null,
            last_failure: null,
            files: {},
            cross_reference: {
              status: 'completed',
              based_on_snapshot_id: 'snapshot-fresh',
              crosswalk_artifact_id: 'bioguide-crosswalk.json',
              matched_bioguide_ids: 1,
              unmatched_legislator_bioguide_ids: 1,
              unmatched_congress_bioguide_ids: 1,
              updated_at: '2026-03-28T00:00:00.000Z',
            },
          },
        },
      }));

      await withStubbedFetch(async (url) => {
        const matched = Object.keys(yamlBodies).find((filename) => url.endsWith(filename));
        if (!matched) {
          throw new Error(`Unexpected legislators URL during stale-snapshot rerun: ${url}`);
        }

        return makeTextResponse(yamlBodies[matched], 'application/x-yaml');
      }, async () => {
        await fetchUnitedStatesSource({ force: false });
      });

      const manifest = readManifest(tempDataDir);
      const legislatorsState = (manifest.sources as Record<string, unknown>).legislators as Record<string, unknown>;
      const crossReference = legislatorsState.cross_reference as Record<string, unknown>;

      expect(crossReference).toMatchObject({
        status: 'skipped_stale_congress_snapshot',
        based_on_snapshot_id: null,
        crosswalk_artifact_id: null,
        matched_bioguide_ids: 0,
        unmatched_legislator_bioguide_ids: 0,
        unmatched_congress_bioguide_ids: 0,
      });
      expect(existsSync(crosswalkPath)).toBe(false);
    } finally {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });
});
