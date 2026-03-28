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

function makeJsonResponse(payload: unknown, status = 200): JsonResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
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

afterEach(() => {
  delete process.env.API_DATA_GOV_KEY;
  delete process.env.CURRENT_CONGRESS_OVERRIDE;
  delete process.env.US_CODE_TOOLS_DATA_DIR;
  vi.restoreAllMocks();
  vi.doUnmock(resolve(process.cwd(), 'src', 'utils', 'rate-limit.ts'));
});

describe('adversary regressions for issue #5 — round 2', () => {
  it('walks the full 93..current Congress bulk range and persists completion metadata only for bare --all runs', async () => {
    const root = process.cwd();
    const tempDataDir = mkdtempSync(join(tmpdir(), 'us-code-tools-congress-bulk-'));
    process.env.API_DATA_GOV_KEY = 'test-key';
    process.env.CURRENT_CONGRESS_OVERRIDE = '94';
    process.env.US_CODE_TOOLS_DATA_DIR = tempDataDir;

    const congressMod = await importFresh(resolve(root, 'src', 'sources', 'congress.ts'));
    const fetchCongressSource = pickCallable(congressMod, ['fetchCongressSource']);

    const requestLog: string[] = [];

    try {
      await withStubbedFetch(async (url) => {
        requestLog.push(url);

        if (url.includes('/member')) {
          if (url.match(/\/member\/[A-Z0-9]+/)) {
            return makeJsonResponse({ member: { bioguideId: 'A000360' } });
          }

          return makeJsonResponse({
            members: [{ bioguideId: 'A000360' }],
            pagination: { next: null, count: 1 },
          });
        }

        if (url.includes('/committee/93') || url.includes('/committee/94')) {
          return makeJsonResponse({ committees: [], pagination: { next: null, count: 0 } });
        }

        if (url.includes('/bill/93') || url.includes('/bill/94')) {
          if (url.includes('/actions')) {
            return makeJsonResponse({ actions: [] });
          }
          if (url.includes('/cosponsors')) {
            return makeJsonResponse({ cosponsors: [] });
          }
          if (/\/bill\/(93|94)\/hr\/1/.test(url)) {
            return makeJsonResponse({ bill: { type: 'hr', number: '1' } });
          }

          return makeJsonResponse({
            bills: [{ type: 'hr', number: '1', congress: Number(url.match(/\/bill\/(\d+)/)?.[1] ?? '93') }],
            pagination: { next: null, count: 1 },
          });
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
      }, async () => {
        // NOTE: Use the existing production signature. Do not create a test-only overload.
        await fetchCongressSource({ mode: 'all', congress: null, force: false });
      });

      expect(requestLog.some((url) => url.includes('/bill/93'))).toBe(true);
      expect(requestLog.some((url) => url.includes('/bill/94'))).toBe(true);

      const manifest = readManifest(tempDataDir);
      const congressState = (manifest.sources as Record<string, unknown>)?.congress as Record<string, unknown> | undefined;
      expect(congressState).toBeTruthy();
      expect(congressState).toHaveProperty('bulk_history_checkpoint');

      requestLog.length = 0;

      await withStubbedFetch(async (url) => {
        requestLog.push(url);
        if (url.includes('/member')) {
          if (url.match(/\/member\/[A-Z0-9]+/)) {
            return makeJsonResponse({ member: { bioguideId: 'A000360' } });
          }

          return makeJsonResponse({
            members: [{ bioguideId: 'A000360' }],
            pagination: { next: null, count: 1 },
          });
        }

        if (url.includes('/committee/94')) {
          return makeJsonResponse({ committees: [], pagination: { next: null, count: 0 } });
        }

        if (url.includes('/bill/94')) {
          if (url.includes('/actions')) {
            return makeJsonResponse({ actions: [] });
          }
          if (url.includes('/cosponsors')) {
            return makeJsonResponse({ cosponsors: [] });
          }
          if (url.includes('/bill/94/hr/1')) {
            return makeJsonResponse({ bill: { type: 'hr', number: '1' } });
          }

          return makeJsonResponse({
            bills: [{ type: 'hr', number: '1', congress: 94 }],
            pagination: { next: null, count: 1 },
          });
        }

        throw new Error(`Unexpected narrowed fetch URL: ${url}`);
      }, async () => {
        await fetchCongressSource({ mode: 'all', congress: 94, force: false });
      });

      expect(requestLog.some((url) => url.includes('/bill/93'))).toBe(false);
      expect(requestLog.some((url) => url.includes('/bill/94'))).toBe(true);
    } finally {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  it('stops Congress.gov immediately with rate_limit_exhausted when the shared limiter reports no budget', async () => {
    const root = process.cwd();
    const tempDataDir = mkdtempSync(join(tmpdir(), 'us-code-tools-congress-rate-limit-'));
    process.env.API_DATA_GOV_KEY = 'test-key';
    process.env.US_CODE_TOOLS_DATA_DIR = tempDataDir;

    const limiterModulePath = resolve(root, 'src', 'utils', 'rate-limit.ts');
    vi.doMock(limiterModulePath, () => ({
      createRateLimitState: () => ({ mocked: true }),
      markRateLimitUse: vi.fn(),
      isRateLimitExhausted: vi.fn(() => ({ exhausted: true, nextRequestAt: 1_800_000 })),
    }));

    const congressMod = await importFresh(resolve(root, 'src', 'sources', 'congress.ts'));
    const fetchCongressSource = pickCallable(congressMod, ['fetchCongressSource']);

    const requestLog: string[] = [];

    try {
      const result = await withStubbedFetch(async (url) => {
        requestLog.push(url);
        return makeJsonResponse({ bills: [], pagination: { next: null, count: 0 } });
      }, async () => {
        return await fetchCongressSource({ congress: 118, force: false });
      });

      expect(result).toMatchObject({
        ok: false,
        rate_limit_exhausted: true,
        error: { code: 'rate_limit_exhausted' },
        next_request_at: expect.anything(),
      });
      expect(requestLog).toHaveLength(0);
    } finally {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  it('follows GovInfo nextPage cursors, finalizes page packages before the next page, and persists query-scope checkpoints', async () => {
    const root = process.cwd();
    const tempDataDir = mkdtempSync(join(tmpdir(), 'us-code-tools-govinfo-'));
    process.env.API_DATA_GOV_KEY = 'test-key';
    process.env.US_CODE_TOOLS_DATA_DIR = tempDataDir;

    const govinfoMod = await importFresh(resolve(root, 'src', 'sources', 'govinfo.ts'));
    const fetchGovInfoSource = pickCallable(govinfoMod, ['fetchGovInfoSource', 'fetchGovinfoSource']);

    const requestLog: string[] = [];

    try {
      await withStubbedFetch(async (url) => {
        requestLog.push(url);

        if (url.includes('/collections/PLAW') && !url.includes('page=2')) {
          return makeJsonResponse({
            packages: [{ packageId: 'PLAW-118publ1' }],
            nextPage: 'https://api.govinfo.gov/collections/PLAW?page=2',
            count: 2,
          });
        }

        if (url.includes('/collections/PLAW?page=2')) {
          return makeJsonResponse({
            packages: [{ packageId: 'PLAW-118publ2' }],
            nextPage: null,
            count: 2,
          });
        }

        if (url.includes('/packages/PLAW-118publ1/summary')) {
          return makeJsonResponse({ packageId: 'PLAW-118publ1' });
        }

        if (url.includes('/packages/PLAW-118publ1/granules')) {
          return makeJsonResponse({ granules: [] });
        }

        if (url.includes('/packages/PLAW-118publ2/summary')) {
          return makeJsonResponse({ packageId: 'PLAW-118publ2' });
        }

        if (url.includes('/packages/PLAW-118publ2/granules')) {
          return makeJsonResponse({ granules: [] });
        }

        throw new Error(`Unexpected GovInfo URL: ${url}`);
      }, async () => {
        // NOTE: Use the existing production signature. Do not add a test-only wrapper.
        await fetchGovInfoSource({ force: false, congress: null });
      });

      expect(requestLog).toContain('https://api.govinfo.gov/collections/PLAW?page=2');
      const firstPageIndex = requestLog.findIndex((url) => url.includes('/collections/PLAW') && !url.includes('page=2'));
      const firstSummaryIndex = requestLog.findIndex((url) => url.includes('/packages/PLAW-118publ1/summary'));
      const secondPageIndex = requestLog.findIndex((url) => url.includes('/collections/PLAW?page=2'));
      expect(firstSummaryIndex).toBeGreaterThan(firstPageIndex);
      expect(secondPageIndex).toBeGreaterThan(firstSummaryIndex);

      const manifest = readManifest(tempDataDir);
      const govinfoState = (manifest.sources as Record<string, unknown>)?.govinfo as Record<string, unknown> | undefined;
      expect(govinfoState).toBeTruthy();
      expect(govinfoState).toHaveProperty('query_scopes');
      expect(govinfoState).toHaveProperty('checkpoints');
    } finally {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  it('records an explicit legislators cross-reference skip status when no complete Congress snapshot is available', async () => {
    const root = process.cwd();
    const tempDataDir = mkdtempSync(join(tmpdir(), 'us-code-tools-legislators-'));
    process.env.US_CODE_TOOLS_DATA_DIR = tempDataDir;
    mkdirSync(tempDataDir, { recursive: true });

    writeFileSync(
      resolve(tempDataDir, 'manifest.json'),
      JSON.stringify({
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
      }),
    );

    const legislatorsMod = await importFresh(resolve(root, 'src', 'sources', 'unitedstates.ts'));
    const fetchUnitedStatesSource = pickCallable(legislatorsMod, ['fetchUnitedStatesSource', 'fetchLegislatorsSource']);

    try {
      await withStubbedFetch(async (url) => {
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
        await fetchUnitedStatesSource({ force: false });
      });

      const manifest = readManifest(tempDataDir);
      const legislatorsState = (manifest.sources as Record<string, unknown>)?.legislators as Record<string, unknown> | undefined;
      expect(legislatorsState).toBeTruthy();
      expect(JSON.stringify(legislatorsState)).toMatch(/skipped_missing_congress_cache|skipped_stale_congress_snapshot|skipped_incomplete_congress_snapshot/);
      expect(existsSync(resolve(tempDataDir, 'cache', 'legislators', 'bioguide-crosswalk.json'))).toBe(false);
    } finally {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });
});
