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

function pickCallableByPattern(module: CandidateModule, pattern: RegExp, label: string) {
  for (const [name, value] of Object.entries(module)) {
    if (pattern.test(name) && typeof value === 'function') {
      return value as (...args: unknown[]) => Promise<unknown> | unknown;
    }
  }

  throw new Error(`No public parse surface found for ${label}`);
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

describe('adversary regressions for issue #5 — round 4', () => {
  it('skips legislators cross-reference with skipped_stale_congress_snapshot when the latest complete Congress snapshot has missing artifacts', async () => {
    const root = process.cwd();
    const tempDataDir = mkdtempSync(join(tmpdir(), 'us-code-tools-legislators-stale-snapshot-'));
    process.env.US_CODE_TOOLS_DATA_DIR = tempDataDir;

    const staleSnapshotDir = resolve(tempDataDir, 'cache', 'congress', 'members', 'snapshots', 'snapshot-stale');
    mkdirSync(resolve(staleSnapshotDir, 'pages'), { recursive: true });
    writeFileSync(
      resolve(staleSnapshotDir, 'pages', 'page-1.json'),
      JSON.stringify({
        members: [{ bioguideId: 'A000360' }],
        pagination: { next: null, count: 1 },
      }),
    );
    // Intentionally do not create details/A000360.json so the manifest points at a stale snapshot.

    writeManifest(tempDataDir, createBaseManifest({
      sources: {
        olrc: { selected_vintage: null, last_success_at: null, last_failure: null, titles: {} },
        congress: {
          last_success_at: '2026-03-28T00:00:00.000Z',
          last_failure: null,
          bulk_scope: null,
          member_snapshot: {
            snapshot_id: 'snapshot-stale',
            status: 'complete',
            snapshot_completed_at: '2026-03-28T00:00:00.000Z',
            cache_ttl_ms: 86_400_000,
            member_page_count: 1,
            member_detail_count: 1,
            failed_member_details: [],
            artifacts: [
              'members/snapshots/snapshot-stale/pages/page-1.json',
              'members/snapshots/snapshot-stale/details/A000360.json',
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

    try {
      const result = await withStubbedFetch(async (url) => {
        if (url.endsWith('legislators-current.yaml')) {
          return makeTextResponse('- id:\n    bioguide: A000360\n', 'application/x-yaml');
        }
        if (url.endsWith('legislators-historical.yaml')) {
          return makeTextResponse('- id:\n    bioguide: B000001\n', 'application/x-yaml');
        }
        if (url.endsWith('committees-current.yaml')) {
          return makeTextResponse('- thomas_id: HSAG\n', 'application/x-yaml');
        }

        throw new Error(`Unexpected legislators URL: ${url}`);
      }, async () => {
        // NOTE: Use the existing production signature. Do not create a test-only overload.
        return await fetchUnitedStatesSource({ force: false });
      });

      expect(result).toMatchObject({ ok: true });

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
      expect(existsSync(resolve(tempDataDir, 'cache', 'legislators', 'bioguide-crosswalk.json'))).toBe(false);
    } finally {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  it('records legislators file artifact metadata and exposes parse helpers for the three YAML datasets', async () => {
    const root = process.cwd();
    const tempDataDir = mkdtempSync(join(tmpdir(), 'us-code-tools-legislators-files-'));
    process.env.US_CODE_TOOLS_DATA_DIR = tempDataDir;

    const legislatorsMod = await importFresh(resolve(root, 'src', 'sources', 'unitedstates.ts'));
    const fetchUnitedStatesSource = pickCallable(legislatorsMod, ['fetchUnitedStatesSource', 'fetchLegislatorsSource']);
    const parseCurrentLegislators = pickCallableByPattern(legislatorsMod, /parse.*current.*legislator|parse.*legislator.*current/i, 'current legislators');
    const parseHistoricalLegislators = pickCallableByPattern(legislatorsMod, /parse.*historical.*legislator|parse.*legislator.*historical/i, 'historical legislators');
    const parseCurrentCommittees = pickCallableByPattern(legislatorsMod, /parse.*current.*committee|parse.*committee.*current/i, 'current committees');

    const currentYaml = '- id:\n    bioguide: A000360\n  name:\n    official_full: Example Current\n';
    const historicalYaml = '- id:\n    bioguide: B000001\n  name:\n    official_full: Example Historical\n';
    const committeesYaml = '- thomas_id: HSAG\n  name: Agriculture\n';

    try {
      await withStubbedFetch(async (url) => {
        if (url.endsWith('legislators-current.yaml')) {
          return makeTextResponse(currentYaml, 'application/x-yaml');
        }
        if (url.endsWith('legislators-historical.yaml')) {
          return makeTextResponse(historicalYaml, 'application/x-yaml');
        }
        if (url.endsWith('committees-current.yaml')) {
          return makeTextResponse(committeesYaml, 'application/x-yaml');
        }

        throw new Error(`Unexpected legislators URL: ${url}`);
      }, async () => {
        // NOTE: Use the existing production signature. Do not create a test-only overload.
        await fetchUnitedStatesSource({ force: false });
      });

      const manifest = readManifest(tempDataDir);
      const legislatorsState = (manifest.sources as Record<string, unknown>).legislators as Record<string, unknown>;
      const files = legislatorsState.files as Record<string, Record<string, unknown>>;

      for (const fileName of ['legislators-current.yaml', 'legislators-historical.yaml', 'committees-current.yaml']) {
        const fileState = files[fileName];
        expect(fileState, `missing manifest metadata for ${fileName}`).toBeTruthy();
        expect(fileState.path).toBe(`cache/legislators/${fileName}`);
        expect(typeof fileState.byte_count).toBe('number');
        expect((fileState.byte_count as number)).toBeGreaterThan(0);
        expect(fileState.checksum_sha256).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
        expect(typeof fileState.fetched_at).toBe('string');
      }

      const current = await parseCurrentLegislators(currentYaml);
      const historical = await parseHistoricalLegislators(historicalYaml);
      const committees = await parseCurrentCommittees(committeesYaml);

      expect(Array.isArray(current)).toBe(true);
      expect(Array.isArray(historical)).toBe(true);
      expect(Array.isArray(committees)).toBe(true);
      expect(JSON.stringify(current)).toContain('A000360');
      expect(JSON.stringify(historical)).toContain('B000001');
      expect(JSON.stringify(committees)).toContain('HSAG');
    } finally {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });
});
