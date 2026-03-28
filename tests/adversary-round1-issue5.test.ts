import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
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
    arrayBuffer: async () => Buffer.from(body, 'utf8').buffer,
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

afterEach(() => {
  delete process.env.API_DATA_GOV_KEY;
  delete process.env.CURRENT_CONGRESS_OVERRIDE;
  delete process.env.US_CODE_TOOLS_DATA_DIR;
  vi.restoreAllMocks();
});

describe('adversary regressions for issue #5', () => {
  it('source entrypoints do not stay on permanent not_implemented placeholders', async () => {
    const root = process.cwd();
    const tempDataDir = mkdtempSync(join(tmpdir(), 'us-code-tools-adversary-5-'));
    process.env.API_DATA_GOV_KEY = 'test-key';
    process.env.US_CODE_TOOLS_DATA_DIR = tempDataDir;

    const congressMod = await importFresh(resolve(root, 'src', 'sources', 'congress.ts'));
    const govinfoMod = await importFresh(resolve(root, 'src', 'sources', 'govinfo.ts'));
    const voteviewMod = await importFresh(resolve(root, 'src', 'sources', 'voteview.ts'));
    const legislatorsMod = await importFresh(resolve(root, 'src', 'sources', 'unitedstates.ts'));

    const fetchCongressSource = pickCallable(congressMod, ['fetchCongressSource']);
    const fetchGovInfoSource = pickCallable(govinfoMod, ['fetchGovInfoSource', 'fetchGovinfoSource']);
    const fetchVoteViewSource = pickCallable(voteviewMod, ['fetchVoteViewSource', 'fetchVoteviewSource']);
    const fetchUnitedStatesSource = pickCallable(legislatorsMod, ['fetchUnitedStatesSource', 'fetchLegislatorsSource']);

    const requestLog: string[] = [];

    try {
      await withStubbedFetch(async (url) => {
        requestLog.push(url);

        if (url.includes('api.congress.gov')) {
          return makeJsonResponse({
            bills: [],
            members: [],
            committees: [],
            pagination: { next: null, count: 0 },
          });
        }

        if (url.includes('api.govinfo.gov')) {
          return makeJsonResponse({
            packages: [],
            nextPage: null,
            count: 0,
          });
        }

        if (url.endsWith('.csv')) {
          return makeTextResponse('congress,icpsr\n118,1\n', 'text/csv');
        }

        if (url.endsWith('.yaml')) {
          return makeTextResponse('- id:\n    bioguide: A000360\n', 'application/x-yaml');
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
      }, async () => {
        // NOTE: Use the existing production signatures for these entrypoints.
        // If the invocation object below is missing fields, adapt the TEST to the existing signature;
        // do not create new overloads/wrappers just to satisfy this regression.
        const congressResult = await fetchCongressSource({ congress: 118, force: false });
        const govinfoResult = await fetchGovInfoSource({ congress: 118, force: false });
        const voteviewResult = await fetchVoteViewSource({ force: false });
        const legislatorsResult = await fetchUnitedStatesSource({ force: false });

        for (const result of [congressResult, govinfoResult, voteviewResult, legislatorsResult]) {
          const errorCode = (result as { error?: { code?: string } }).error?.code ?? null;
          expect(errorCode).not.toBe('not_implemented');
        }
      });

      expect(requestLog.some((url) => url.includes('api.congress.gov'))).toBe(true);
      expect(requestLog.some((url) => url.includes('api.govinfo.gov'))).toBe(true);
      expect(requestLog.some((url) => url.endsWith('.csv'))).toBe(true);
      expect(requestLog.some((url) => url.endsWith('.yaml'))).toBe(true);
    } finally {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });
});
