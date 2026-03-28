import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
    arrayBuffer: async () => Uint8Array.from(Buffer.from(JSON.stringify(payload), 'utf8')).buffer,
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
  delete process.env.US_CODE_TOOLS_DATA_DIR;
  vi.restoreAllMocks();
});

describe('adversary regressions for issue #5 — round 8', () => {
  it('reuses fresh Congress API cache entries on a later non-force run instead of issuing new bill and committee requests', async () => {
    const root = process.cwd();
    const tempDataDir = mkdtempSync(join(tmpdir(), 'us-code-tools-congress-cache-hit-'));
    process.env.API_DATA_GOV_KEY = 'test-key';
    process.env.US_CODE_TOOLS_DATA_DIR = tempDataDir;

    const congressMod = await importFresh(resolve(root, 'src', 'sources', 'congress.ts'));
    const fetchCongressSource = pickCallable(congressMod, ['fetchCongressSource']);

    try {
      const firstRunLog: string[] = [];
      const firstRun = await withStubbedFetch(async (url) => {
        firstRunLog.push(url);

        if (url.includes('/member') && !url.match(/\/member\/[A-Z0-9]+/)) {
          return makeJsonResponse({ members: [{ bioguideId: 'A000001' }], pagination: { count: 1, next: null } });
        }

        if (url.match(/\/member\/[A-Z0-9]+/)) {
          return makeJsonResponse({ member: { bioguideId: 'A000001' } });
        }

        if (url.includes('/bill/118') && !url.includes('/actions') && !url.includes('/cosponsors') && !/\/bill\/118\/[a-z]+\/\d+/.test(url)) {
          return makeJsonResponse({ bills: [{ type: 'hr', number: '7', congress: 118 }], pagination: { count: 1, next: null } });
        }

        if (/\/bill\/118\/hr\/7\/actions/.test(url)) {
          return makeJsonResponse({ actions: [] });
        }

        if (/\/bill\/118\/hr\/7\/cosponsors/.test(url)) {
          return makeJsonResponse({ cosponsors: [] });
        }

        if (/\/bill\/118\/hr\/7(?:\?|$)/.test(url)) {
          return makeJsonResponse({ bill: { type: 'hr', number: '7', congress: 118 } });
        }

        if (url.includes('/committee/118')) {
          return makeJsonResponse({ committees: [{ systemCode: 'HSAG' }], pagination: { count: 1, next: null } });
        }

        throw new Error(`Unexpected Congress URL during initial cache fill: ${url}`);
      }, async () => {
        // NOTE: Use the existing production signature; do not add a test-only overload.
        return await fetchCongressSource({ congress: 118, force: false });
      });

      expect(firstRun).toMatchObject({ ok: true });
      expect(firstRunLog.some((url) => url.includes('/bill/118'))).toBe(true);
      expect(firstRunLog.some((url) => url.includes('/committee/118'))).toBe(true);

      const secondRun = await withStubbedFetch(async (url) => {
        throw new Error(`Fresh Congress cache should prevent outbound fetches, but requested: ${url}`);
      }, async () => {
        return await fetchCongressSource({ congress: 118, force: false });
      });

      expect(secondRun).toMatchObject({ ok: true });

      const manifest = readManifest(tempDataDir);
      const congressState = (manifest.sources as Record<string, unknown>).congress as Record<string, unknown>;
      expect(congressState.last_success_at).toBeTruthy();
    } finally {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  it('reuses fresh GovInfo listing and package artifacts on a later non-force run instead of refetching page 1 and finalized packages', async () => {
    const root = process.cwd();
    const tempDataDir = mkdtempSync(join(tmpdir(), 'us-code-tools-govinfo-cache-hit-'));
    process.env.API_DATA_GOV_KEY = 'test-key';
    process.env.US_CODE_TOOLS_DATA_DIR = tempDataDir;

    const govinfoMod = await importFresh(resolve(root, 'src', 'sources', 'govinfo.ts'));
    const fetchGovInfoSource = pickCallable(govinfoMod, ['fetchGovInfoSource']);

    try {
      const firstRunLog: string[] = [];
      const firstRun = await withStubbedFetch(async (url) => {
        firstRunLog.push(url);

        if (url.includes('/collections/PLAW')) {
          return makeJsonResponse({
            packages: [{ packageId: 'PLAW-118publ12' }],
            nextPage: null,
            pagination: { next: null },
          });
        }

        if (url.includes('/packages/PLAW-118publ12/summary')) {
          return makeJsonResponse({ packageId: 'PLAW-118publ12' });
        }

        if (url.includes('/packages/PLAW-118publ12/granules')) {
          return makeJsonResponse({ granules: [] });
        }

        throw new Error(`Unexpected GovInfo URL during initial cache fill: ${url}`);
      }, async () => {
        // NOTE: Use the existing production signature; do not add a test-only overload.
        return await fetchGovInfoSource({ congress: 118, force: false });
      });

      expect(firstRun).toMatchObject({ ok: true });
      expect(firstRunLog).toEqual(
        expect.arrayContaining([
          expect.stringContaining('/collections/PLAW'),
          expect.stringContaining('/packages/PLAW-118publ12/summary'),
          expect.stringContaining('/packages/PLAW-118publ12/granules'),
        ]),
      );

      const secondRun = await withStubbedFetch(async (url) => {
        throw new Error(`Fresh GovInfo cache should prevent outbound fetches, but requested: ${url}`);
      }, async () => {
        return await fetchGovInfoSource({ congress: 118, force: false });
      });

      expect(secondRun).toMatchObject({ ok: true });

      const manifest = readManifest(tempDataDir);
      const govinfoState = (manifest.sources as Record<string, unknown>).govinfo as Record<string, unknown>;
      const scopes = govinfoState.query_scopes as Record<string, Record<string, unknown>>;
      const scopedEntry = Object.values(scopes).find((entry) => entry.query_scope === 'congress=118');

      expect(scopedEntry).toBeTruthy();
      expect(scopedEntry?.termination).toBe('complete');
    } finally {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });
});
