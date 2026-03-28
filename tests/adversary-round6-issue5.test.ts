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

function toExactArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
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

function runFetchWithPreload(args: string[], mode: 'voteview' | 'legislators', tempRoot: string) {
  const preloadPath = resolve(tempRoot, 'mock-fetch.mjs');
  const requestLogPath = resolve(tempRoot, 'request-log.json');

  writeFileSync(
    preloadPath,
    `
      import { readFileSync, writeFileSync, existsSync } from 'node:fs';
      const logPath = process.env.MOCK_FETCH_LOG_PATH;
      const mode = process.env.MOCK_FETCH_MODE;
      const requests = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : [];
      globalThis.fetch = async (input) => {
        const url = String(input);
        requests.push(url);
        writeFileSync(logPath, JSON.stringify(requests));

        const makeText = (body, type) => ({
          ok: true,
          status: 200,
          headers: { get: () => type },
          text: async () => body,
          arrayBuffer: async () => Buffer.from(body, 'utf8').buffer.slice(Buffer.from(body, 'utf8').byteOffset, Buffer.from(body, 'utf8').byteOffset + Buffer.from(body, 'utf8').byteLength),
        });

        if (mode === 'voteview') {
          if (url.endsWith('HSall_members.csv')) return makeText('congress,icpsr,bioguide_id\\n118,1,A000001\\n', 'text/csv');
          if (url.endsWith('HSall_votes.csv')) return makeText('congress,rollnumber\\n118,12\\n', 'text/csv');
          if (url.endsWith('HSall_rollcalls.csv')) return makeText('congress,rollnumber,icpsr\\n118,12,1\\n', 'text/csv');
        }

        if (mode === 'legislators') {
          if (url.endsWith('legislators-current.yaml')) return makeText('- id:\\n    bioguide: A000360\\n', 'application/x-yaml');
          if (url.endsWith('legislators-historical.yaml')) return makeText('- id:\\n    bioguide: B000001\\n', 'application/x-yaml');
          if (url.endsWith('committees-current.yaml')) return makeText('- thomas_id: HSAG\\n', 'application/x-yaml');
        }

        throw new Error('Unexpected URL: ' + url);
      };
    `,
  );

  const result = spawnSync(process.execPath, [distEntry, 'fetch', ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      HOME: tempRoot,
      XDG_CACHE_HOME: join(tempRoot, '.cache'),
      US_CODE_TOOLS_DATA_DIR: join(tempRoot, 'data'),
      NODE_OPTIONS: `--import=${preloadPath}`,
      MOCK_FETCH_LOG_PATH: requestLogPath,
      MOCK_FETCH_MODE: mode,
    },
  });

  const requestLog = existsSync(requestLogPath)
    ? (JSON.parse(readFileSync(requestLogPath, 'utf8')) as string[])
    : [];

  return { result, requestLog, dataDir: join(tempRoot, 'data') };
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

describe('adversary regressions for issue #5 — round 6', () => {
  it('keeps direct title fetch offline-safe by using the deterministic legacy title URL without scraping the annual listing first', async () => {
    const modulePath = resolve(projectRoot, 'src', 'sources', 'olrc.ts');
    const mod = await importFresh(modulePath);
    const getZipPath = pickCallable(mod, [
      'getOrCreateZipPath',
      'getTitleZipPath',
      'fetchAndCacheTitle',
      'downloadTitleZip',
      'ensureTitleZip',
      'ensureTitleXml',
      'obtainTitleArchive',
    ]);
    const resolveUrl = pickCallable(mod, [
      'resolveTitleUrl',
      'buildTitleZipUrl',
      'getTitleUrl',
      'olrcUrlForTitle',
      'resolveOlrcUrl',
      'resolveTitleZipUrl',
    ]);

    const fixtureZip = readFileSync(resolve(projectRoot, 'tests', 'fixtures', 'title-01', 'title-01.zip'));
    const cacheRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-olrc-direct-title-'));
    const requests: string[] = [];
    const expectedUrl = resolveUrl(1) as string;

    try {
      const zipPath = await withStubbedFetch(async (url) => {
        requests.push(url);
        if (url !== expectedUrl) {
          throw new Error(`Unexpected OLRC URL during direct-title fetch: ${url}`);
        }

        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/zip' },
          arrayBuffer: async () => toExactArrayBuffer(fixtureZip),
        };
      }, async () => {
        // NOTE: Use the existing production signature; do not add a test-only overload.
        return await getZipPath(1, cacheRoot);
      });

      expect(zipPath).toBeTypeOf('string');
      expect(requests).toEqual([expectedUrl]);
      expect(requests.some((url) => url.includes('annualtitlefiles.shtml'))).toBe(false);
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it('forwards --force from the CLI into VoteView fetches so cached runs still re-download when explicitly forced', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-voteview-force-cli-'));

    try {
      const warm = runFetchWithPreload(['--source=voteview'], 'voteview', tempRoot);
      expect(warm.result.status).toBe(0);
      expect(warm.requestLog).toHaveLength(3);

      rmSync(resolve(tempRoot, 'request-log.json'), { force: true });

      const forced = runFetchWithPreload(['--source=voteview', '--force'], 'voteview', tempRoot);
      expect(forced.result.status).toBe(0);
      expect(forced.requestLog).toHaveLength(3);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('forwards --force from the CLI into legislators fetches so cached YAML artifacts are re-downloaded on demand', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-legislators-force-cli-'));

    try {
      const warm = runFetchWithPreload(['--source=legislators'], 'legislators', tempRoot);
      expect(warm.result.status).toBe(0);
      expect(warm.requestLog).toHaveLength(3);

      rmSync(resolve(tempRoot, 'request-log.json'), { force: true });

      const forced = runFetchWithPreload(['--source=legislators', '--force'], 'legislators', tempRoot);
      expect(forced.result.status).toBe(0);
      expect(forced.requestLog).toHaveLength(3);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('resumes bare fetch-all Congress history from the recorded next_congress checkpoint instead of restarting at 93', async () => {
    const root = process.cwd();
    const tempDataDir = mkdtempSync(join(tmpdir(), 'us-code-tools-congress-bulk-resume-'));
    process.env.API_DATA_GOV_KEY = 'test-key';
    process.env.CURRENT_CONGRESS_OVERRIDE = '95';
    process.env.US_CODE_TOOLS_DATA_DIR = tempDataDir;

    writeManifest(tempDataDir, createBaseManifest({
      sources: {
        ...createBaseManifest().sources,
        congress: {
          last_success_at: '2026-03-28T00:00:00.000Z',
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
          congress_runs: {
            '93': {
              congress: 93,
              completed_at: '2026-03-28T00:00:00.000Z',
              bill_page_count: 1,
              bill_detail_count: 1,
              bill_action_count: 1,
              bill_cosponsor_count: 1,
              committee_page_count: 1,
              failed_bills: [],
            },
            '94': {
              congress: 94,
              completed_at: '2026-03-28T00:10:00.000Z',
              bill_page_count: 1,
              bill_detail_count: 1,
              bill_action_count: 1,
              bill_cosponsor_count: 1,
              committee_page_count: 1,
              failed_bills: [],
            },
          },
          bulk_history_checkpoint: {
            scope: 'all',
            current: 95,
            start: 93,
            next_congress: 95,
            updated_at: '2026-03-28T00:15:00.000Z',
          },
        },
      },
    }));

    const congressMod = await importFresh(resolve(root, 'src', 'sources', 'congress.ts'));
    const fetchCongressSource = pickCallable(congressMod, ['fetchCongressSource']);
    const requestLog: string[] = [];

    try {
      const result = await withStubbedFetch(async (url) => {
        requestLog.push(url);

        if (url.includes('/member') && !url.match(/\/member\/[A-Z0-9]+/)) {
          return makeJsonResponse({ members: [{ bioguideId: 'A000001' }], pagination: { count: 1, next: null } });
        }

        if (url.match(/\/member\/[A-Z0-9]+/)) {
          const bioguideId = url.match(/\/member\/([A-Z0-9]+)/)?.[1] ?? 'UNKNOWN';
          return makeJsonResponse({ member: { bioguideId } });
        }

        if (url.includes('/bill/95') && !url.includes('/actions') && !url.includes('/cosponsors') && !/\/bill\/95\/[a-z]+\/\d+/.test(url)) {
          return makeJsonResponse({ bills: [{ type: 'hr', number: '5', congress: 95 }], pagination: { count: 1, next: null } });
        }

        if (url.includes('/committee/95')) {
          return makeJsonResponse({ committees: [{ systemCode: 'HSAG' }], pagination: { count: 1, next: null } });
        }

        if (/\/bill\/95\/hr\/5\/actions/.test(url)) {
          return makeJsonResponse({ actions: [] });
        }

        if (/\/bill\/95\/hr\/5\/cosponsors/.test(url)) {
          return makeJsonResponse({ cosponsors: [] });
        }

        if (/\/bill\/95\/hr\/5$/.test(url)) {
          return makeJsonResponse({ bill: { type: 'hr', number: '5', congress: 95 } });
        }

        throw new Error(`Unexpected Congress bulk-resume URL: ${url}`);
      }, async () => {
        // NOTE: Adapt to the existing production signature; do not add a test-only overload.
        return await fetchCongressSource({ mode: 'all', congress: null, force: false });
      });

      expect(result).toMatchObject({ ok: true });
      expect(requestLog.some((url) => url.includes('/bill/93'))).toBe(false);
      expect(requestLog.some((url) => url.includes('/bill/94'))).toBe(false);
      expect(requestLog.some((url) => url.includes('/bill/95'))).toBe(true);

      const manifest = readManifest(tempDataDir);
      const congressState = (manifest.sources as Record<string, unknown>).congress as Record<string, unknown>;
      const checkpoint = congressState.bulk_history_checkpoint as Record<string, unknown> | null;
      const congressRuns = congressState.congress_runs as Record<string, Record<string, unknown>>;

      expect(congressRuns['93']).toBeTruthy();
      expect(congressRuns['94']).toBeTruthy();
      expect(congressRuns['95']).toBeTruthy();
      expect(checkpoint === null || checkpoint.next_congress === null).toBe(true);
    } finally {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

});
