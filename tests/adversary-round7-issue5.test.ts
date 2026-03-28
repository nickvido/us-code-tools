import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
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

const projectRoot = resolve(process.cwd());
const distEntry = resolve(projectRoot, 'dist', 'index.js');

function buildDist(): void {
  if (existsSync(distEntry)) {
    return;
  }

  execSync('npm run build', {
    cwd: projectRoot,
    stdio: 'pipe',
    env: process.env,
    timeout: 120_000,
  });
}

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

function writeManifest(tempDataDir: string, manifest: Record<string, unknown>) {
  mkdirSync(tempDataDir, { recursive: true });
  writeFileSync(resolve(tempDataDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

function readManifest(tempDataDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(tempDataDir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
}

function runVoteViewFetchWithPreload(tempRoot: string) {
  const preloadPath = resolve(tempRoot, 'mock-voteview-fetch.mjs');

  writeFileSync(
    preloadPath,
    `
      globalThis.fetch = async (input) => {
        const url = String(input);
        const makeText = (body, type) => ({
          ok: true,
          status: 200,
          headers: { get: () => type },
          text: async () => body,
          arrayBuffer: async () => Buffer.from(body, 'utf8').buffer.slice(
            Buffer.from(body, 'utf8').byteOffset,
            Buffer.from(body, 'utf8').byteOffset + Buffer.from(body, 'utf8').byteLength,
          ),
        });

        if (url.endsWith('HSall_members.csv')) return makeText('congress,icpsr,bioguide_id\\n118,1,A000001\\n', 'text/csv');
        if (url.endsWith('HSall_votes.csv')) return makeText('congress,rollnumber\\n118,12\\n', 'text/csv');
        if (url.endsWith('HSall_rollcalls.csv')) return makeText('congress,rollnumber,icpsr\\n118,12,1\\n', 'text/csv');

        throw new Error('Unexpected VoteView URL: ' + url);
      };
    `,
  );

  return spawnSync(process.execPath, [distEntry, 'fetch', '--source=voteview'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      HOME: tempRoot,
      XDG_CACHE_HOME: join(tempRoot, '.cache'),
      US_CODE_TOOLS_DATA_DIR: join(tempRoot, 'data'),
      NODE_OPTIONS: `--import=${preloadPath}`,
    },
  });
}

beforeAll(() => {
  buildDist();
});

afterEach(() => {
  delete process.env.API_DATA_GOV_KEY;
  delete process.env.CURRENT_CONGRESS_OVERRIDE;
  delete process.env.US_CODE_TOOLS_DATA_DIR;
  vi.restoreAllMocks();
});

describe('adversary regressions for issue #5 — round 7', () => {
  it('appends API_DATA_GOV_KEY to Congress member-detail and bill subrequests, not just the list endpoints', async () => {
    const tempDataDir = mkdtempSync(join(tmpdir(), 'us-code-tools-congress-subrequest-key-'));
    process.env.API_DATA_GOV_KEY = 'test-key';
    process.env.US_CODE_TOOLS_DATA_DIR = tempDataDir;

    const congressMod = await importFresh(resolve(projectRoot, 'src', 'sources', 'congress.ts'));
    const fetchCongressSource = pickCallable(congressMod, ['fetchCongressSource']);
    const requestLog: string[] = [];

    try {
      const result = await withStubbedFetch(async (url) => {
        requestLog.push(url);

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

        if (/\/bill\/118\/hr\/7$/.test(url)) {
          return makeJsonResponse({ bill: { type: 'hr', number: '7', congress: 118 } });
        }

        if (url.includes('/committee/118')) {
          return makeJsonResponse({ committees: [{ systemCode: 'HSAG' }], pagination: { count: 1, next: null } });
        }

        throw new Error(`Unexpected Congress URL: ${url}`);
      }, async () => {
        // NOTE: Use the existing production signature; do not add a test-only overload.
        return await fetchCongressSource({ congress: 118, force: false });
      });

      expect(result).toMatchObject({ ok: true });

      const memberDetailUrl = requestLog.find((url) => /\/member\/[A-Z0-9]+/.test(url));
      const billDetailUrl = requestLog.find((url) => /\/bill\/118\/hr\/7(?:\?|$)/.test(url) && !url.includes('/actions') && !url.includes('/cosponsors'));
      const billActionsUrl = requestLog.find((url) => /\/bill\/118\/hr\/7\/actions/.test(url));
      const billCosponsorsUrl = requestLog.find((url) => /\/bill\/118\/hr\/7\/cosponsors/.test(url));

      expect(memberDetailUrl).toContain('api_key=test-key');
      expect(billDetailUrl).toContain('api_key=test-key');
      expect(billActionsUrl).toContain('api_key=test-key');
      expect(billCosponsorsUrl).toContain('api_key=test-key');
    } finally {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  it('records GovInfo listed vs retained counts separately and persists malformed package IDs skipped by the congress filter', async () => {
    const tempDataDir = mkdtempSync(join(tmpdir(), 'us-code-tools-govinfo-manifest-counts-'));
    process.env.API_DATA_GOV_KEY = 'test-key';
    process.env.US_CODE_TOOLS_DATA_DIR = tempDataDir;
    writeManifest(tempDataDir, createBaseManifest());

    const govinfoMod = await importFresh(resolve(projectRoot, 'src', 'sources', 'govinfo.ts'));
    const fetchGovInfoSource = pickCallable(govinfoMod, ['fetchGovInfoSource']);

    try {
      const result = await withStubbedFetch(async (url) => {
        if (url.includes('/collections/PLAW')) {
          return makeJsonResponse({
            packages: [
              { packageId: 'PLAW-118publ12' },
              { packageId: 'PLAW-117publ99' },
              { packageId: 'PLAW-ABCpubl1' },
              { packageId: '' },
            ],
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

        throw new Error(`Unexpected GovInfo URL: ${url}`);
      }, async () => {
        // NOTE: Use the existing production signature; do not add a test-only overload.
        return await fetchGovInfoSource({ congress: 118, force: false });
      });

      expect(result).toMatchObject({ ok: true });

      const manifest = readManifest(tempDataDir);
      const govinfoState = (manifest.sources as Record<string, unknown>).govinfo as Record<string, unknown>;
      const scopes = govinfoState.query_scopes as Record<string, Record<string, unknown>>;
      const scopedEntry = Object.values(scopes).find((entry) => entry.query_scope === 'congress=118');

      expect(scopedEntry).toBeTruthy();
      expect(scopedEntry?.listed_package_count).toBe(3);
      expect(scopedEntry?.retained_package_count).toBe(1);
      expect(scopedEntry?.summary_count).toBe(1);
      expect(scopedEntry?.granule_count).toBe(1);
      expect(scopedEntry?.malformed_package_ids).toEqual(['PLAW-ABCpubl1']);
    } finally {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  it('emits structured network logs from a real fetch path instead of staying silent', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-structured-logs-'));

    try {
      const result = runVoteViewFetchWithPreload(tempRoot);

      expect(result.status).toBe(0);
      expect(result.stderr.trim()).not.toBe('');
      expect(result.stderr).toContain('"source":"voteview"');
      expect(result.stderr).toContain('"method":"GET"');
      expect(result.stderr).toContain('"attempt"');
      expect(result.stderr).toContain('"cache_status"');
      expect(result.stderr).toContain('"duration');
      expect(result.stderr).toContain('"url"');
      expect(result.stderr).toContain('HSall_members.csv');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
