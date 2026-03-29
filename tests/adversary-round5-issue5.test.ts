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

  throw new Error(`No callable export found for ${label}`);
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

function makeTextResponse(body: string, contentType: string): JsonResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => contentType },
    text: async () => body,
    arrayBuffer: async () => Uint8Array.from(Buffer.from(body, 'utf8')).buffer,
  };
}

function makeBinaryResponse(bytes: Uint8Array, contentType: string): JsonResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => contentType },
    text: async () => Buffer.from(bytes).toString('binary'),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
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

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

const crcTable = makeCrcTable();

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(filename: string, contents: string) {
  const name = Buffer.from(filename, 'utf8');
  const data = Buffer.from(contents, 'utf8');
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(crc32(data), 14);
  localHeader.writeUInt32LE(data.length, 18);
  localHeader.writeUInt32LE(data.length, 22);
  localHeader.writeUInt16LE(name.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0, 14);
  centralHeader.writeUInt32LE(crc32(data), 16);
  centralHeader.writeUInt32LE(data.length, 20);
  centralHeader.writeUInt32LE(data.length, 24);
  centralHeader.writeUInt16LE(name.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralHeader.length + name.length, 12);
  end.writeUInt32LE(localHeader.length + name.length + data.length, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([localHeader, name, data, centralHeader, name, end]);
}

afterEach(() => {
  delete process.env.API_DATA_GOV_KEY;
  delete process.env.CURRENT_CONGRESS_OVERRIDE;
  delete process.env.US_CODE_TOOLS_DATA_DIR;
  vi.restoreAllMocks();
});

describe('adversary regressions for issue #5 — round 5', () => {
  it('selects the latest OLRC vintage from the annual listing and reports latest-vintage gaps as missing_from_vintage without falling back', async () => {
    const root = process.cwd();
    const tempDataDir = mkdtempSync(join(tmpdir(), 'us-code-tools-olrc-vintage-'));
    process.env.US_CODE_TOOLS_DATA_DIR = tempDataDir;

    const olrcMod = await importFresh(resolve(root, 'src', 'sources', 'olrc.ts'));
    const fetchOlrcSource = pickCallable(olrcMod, ['fetchOlrcSource']);

    const latestVintage = '2025';
    const fallbackVintage = '2024';
    const zipBytes = createStoredZip('usc01.xml', '<uslm><section identifier="1"/></uslm>');
    const requestedUrls: string[] = [];
    const listingHtml = [
      '<html><body>',
      ...Array.from({ length: 54 }, (_, index) => {
        const title = index + 1;
        const padded = String(title).padStart(2, '0');
        const latestLink = title === 54
          ? ''
          : `<a href="https://uscode.house.gov/download/releasepoints/us/pl/${latestVintage}/xml_usc${padded}@${latestVintage}.zip">Title ${title} ${latestVintage}</a>`;
        const olderLink = `<a href="https://uscode.house.gov/download/releasepoints/us/pl/${fallbackVintage}/xml_usc${padded}@${fallbackVintage}.zip">Title ${title} ${fallbackVintage}</a>`;
        return `${latestLink}${olderLink}`;
      }),
      '</body></html>',
    ].join('');

    try {
      const result = await withStubbedFetch(async (url) => {
        requestedUrls.push(url);

        if (url === 'https://uscode.house.gov/') {
          return new Response('', {
            status: 200,
            headers: { 'set-cookie': 'JSESSIONID=test-session; Path=/; HttpOnly' },
          });
        }

        if (url === 'https://uscode.house.gov/download/download.shtml') {
          return makeTextResponse(listingHtml, 'text/html');
        }

        if (url.includes(`/releasepoints/us/pl/${latestVintage}/`)) {
          return makeBinaryResponse(Uint8Array.from(zipBytes), 'application/zip');
        }

        if (url.includes(`/releasepoints/us/pl/${fallbackVintage}/`)) {
          throw new Error(`OLRC should not fall back to older vintages: ${url}`);
        }

        throw new Error(`Unexpected OLRC URL: ${url}`);
      }, async () => {
        // NOTE: Use the existing production signature. Do not create a test-only overload.
        return await fetchOlrcSource({ force: false });
      });

      expect(result).toMatchObject({
        ok: true,
        selected_vintage: latestVintage,
      });

      const nonListingUrls = requestedUrls.filter(
        (url) => url !== 'https://uscode.house.gov/' && url !== 'https://uscode.house.gov/download/download.shtml',
      );
      expect(requestedUrls).toContain('https://uscode.house.gov/download/download.shtml');
      expect(requestedUrls).not.toContain('https://uscode.house.gov/download/annualtitlefiles.shtml');
      expect(nonListingUrls.length).toBe(53);
      expect(nonListingUrls.every((url) => url.includes(`/releasepoints/us/pl/${latestVintage}/`))).toBe(true);
      expect(nonListingUrls.some((url) => url.includes(`/releasepoints/us/pl/${fallbackVintage}/`))).toBe(false);

      const manifest = readManifest(tempDataDir);
      const olrcState = (manifest.sources as Record<string, unknown>).olrc as Record<string, unknown>;
      const titles = olrcState.titles as Record<string, unknown>;

      expect(olrcState.selected_vintage).toBe(latestVintage);
      expect(titles['54']).toBeUndefined();
      expect(titles['1']).toBeTruthy();
    } finally {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  it('walks every Congress pagination cursor for bills, committees, and the global member snapshot before finalizing counts', async () => {
    const root = process.cwd();
    const tempDataDir = mkdtempSync(join(tmpdir(), 'us-code-tools-congress-pagination-'));
    process.env.API_DATA_GOV_KEY = 'test-key';
    process.env.US_CODE_TOOLS_DATA_DIR = tempDataDir;

    const congressMod = await importFresh(resolve(root, 'src', 'sources', 'congress.ts'));
    const fetchCongressSource = pickCallable(congressMod, ['fetchCongressSource']);
    const requestLog: string[] = [];

    try {
      await withStubbedFetch(async (url) => {
        requestLog.push(url);

        if (url.includes('/member') && !url.match(/\/member\/[A-Z0-9]+/)) {
          if (url.includes('offset=250')) {
            return makeJsonResponse({
              members: [{ bioguideId: 'B000002' }],
              pagination: { count: 2, next: null },
            });
          }

          return makeJsonResponse({
            members: [{ bioguideId: 'A000001' }],
            pagination: { count: 2, next: 'https://api.congress.gov/v3/member?offset=250' },
          });
        }

        if (url.match(/\/member\/[A-Z0-9]+/)) {
          const bioguideId = url.match(/\/member\/([A-Z0-9]+)/)?.[1] ?? 'UNKNOWN';
          return makeJsonResponse({ member: { bioguideId } });
        }

        if (url.includes('/bill/118') && !url.includes('/actions') && !url.includes('/cosponsors') && !/\/bill\/118\/[a-z]+\/\d+/.test(url)) {
          if (url.includes('offset=250')) {
            return makeJsonResponse({
              bills: [{ type: 's', number: '2', congress: 118 }],
              pagination: { count: 2, next: null },
            });
          }

          return makeJsonResponse({
            bills: [{ type: 'hr', number: '1', congress: 118 }],
            pagination: { count: 2, next: 'https://api.congress.gov/v3/bill/118?offset=250' },
          });
        }

        if (url.includes('/committee/118')) {
          if (url.includes('offset=250')) {
            return makeJsonResponse({ committees: [{ systemCode: 'HSRU' }], pagination: { count: 2, next: null } });
          }

          return makeJsonResponse({
            committees: [{ systemCode: 'HSAG' }],
            pagination: { count: 2, next: 'https://api.congress.gov/v3/committee/118?offset=250' },
          });
        }

        if (/\/bill\/118\/(hr|s)\/\d+\/actions/.test(url)) {
          return makeJsonResponse({ actions: [] });
        }

        if (/\/bill\/118\/(hr|s)\/\d+\/cosponsors/.test(url)) {
          return makeJsonResponse({ cosponsors: [] });
        }

        if (/\/bill\/118\/hr\/1$/.test(url)) {
          return makeJsonResponse({ bill: { type: 'hr', number: '1', congress: 118 } });
        }

        if (/\/bill\/118\/s\/2$/.test(url)) {
          return makeJsonResponse({ bill: { type: 's', number: '2', congress: 118 } });
        }

        throw new Error(`Unexpected Congress URL: ${url}`);
      }, async () => {
        // NOTE: Use the existing production signature. Do not create a test-only overload.
        await fetchCongressSource({ congress: 118, force: false });
      });

      expect(requestLog.some((url) => url.includes('/bill/118?offset=250'))).toBe(true);
      expect(requestLog.some((url) => url.includes('/committee/118?offset=250'))).toBe(true);
      expect(requestLog.some((url) => url.includes('/member?offset=250'))).toBe(true);
      expect(requestLog.filter((url) => /\/member\/[A-Z0-9]+/.test(url))).toHaveLength(2);
      expect(requestLog.filter((url) => /\/bill\/118\/(hr|s)\/\d+\/actions/.test(url))).toHaveLength(2);
      expect(requestLog.filter((url) => /\/bill\/118\/(hr|s)\/\d+\/cosponsors/.test(url))).toHaveLength(2);

      const manifest = readManifest(tempDataDir);
      const congressState = (manifest.sources as Record<string, unknown>).congress as Record<string, unknown>;
      const memberSnapshot = congressState.member_snapshot as Record<string, unknown>;
      const congressRuns = congressState.congress_runs as Record<string, Record<string, unknown>>;
      const run118 = (congressRuns['118'] ?? congressRuns['118.0']) as Record<string, unknown> | undefined;

      expect(memberSnapshot.member_page_count).toBe(2);
      expect(memberSnapshot.member_detail_count).toBe(2);
      expect(run118).toBeTruthy();
      expect(run118?.bill_page_count).toBe(2);
      expect(run118?.committee_page_count).toBe(2);
      expect(run118?.bill_detail_count).toBe(2);
      expect(run118?.bill_action_count).toBe(2);
      expect(run118?.bill_cosponsor_count).toBe(2);
    } finally {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  it('reuses cached VoteView CSV artifacts on non-force runs, records per-file metadata, and exposes indexed lookup surfaces', async () => {
    const root = process.cwd();
    const tempDataDir = mkdtempSync(join(tmpdir(), 'us-code-tools-voteview-cache-'));
    process.env.US_CODE_TOOLS_DATA_DIR = tempDataDir;

    const voteviewMod = await importFresh(resolve(root, 'src', 'sources', 'voteview.ts'));
    const fetchVoteViewSource = pickCallable(voteviewMod, ['fetchVoteViewSource', 'fetchVoteviewSource']);
    const lookupByCongress = pickCallableByPattern(voteviewMod, /(lookup|get|find).*(congress|member)|build.*index/i, 'VoteView lookup/index surface');

    const requestLog: string[] = [];
    const csvBodies: Record<string, string> = {
      'HSall_members.csv': 'congress,icpsr,bioguide_id\n118,1,A000001\n',
      'HSall_votes.csv': 'congress,rollnumber\n118,12\n',
      'HSall_rollcalls.csv': 'congress,rollnumber,icpsr\n118,12,1\n',
    };

    try {
      await withStubbedFetch(async (url) => {
        requestLog.push(url);
        const matched = Object.keys(csvBodies).find((filename) => url.endsWith(filename));
        if (!matched) {
          throw new Error(`Unexpected VoteView URL: ${url}`);
        }

        return makeTextResponse(csvBodies[matched], 'text/csv');
      }, async () => {
        await fetchVoteViewSource({ force: false });
      });

      expect(requestLog).toHaveLength(3);

      const firstManifest = readManifest(tempDataDir);
      const voteviewState = (firstManifest.sources as Record<string, unknown>).voteview as Record<string, unknown>;
      const files = voteviewState.files as Record<string, Record<string, unknown>>;

      expect(Object.keys(files)).toHaveLength(3);
      for (const record of Object.values(files)) {
        expect(record).toMatchObject({
          path: expect.any(String),
          byte_count: expect.any(Number),
          checksum_sha256: expect.any(String),
          fetched_at: expect.any(String),
        });
      }

      requestLog.length = 0;

      await withStubbedFetch(async (url) => {
        requestLog.push(url);
        const matched = Object.keys(csvBodies).find((filename) => url.endsWith(filename));
        if (!matched) {
          throw new Error(`Unexpected VoteView URL on cached run: ${url}`);
        }

        return makeTextResponse(csvBodies[matched], 'text/csv');
      }, async () => {
        await fetchVoteViewSource({ force: false });
      });

      expect(requestLog).toHaveLength(0);

      await withStubbedFetch(async (url) => {
        requestLog.push(url);
        const matched = Object.keys(csvBodies).find((filename) => url.endsWith(filename));
        if (!matched) {
          throw new Error(`Unexpected VoteView URL on forced run: ${url}`);
        }

        return makeTextResponse(csvBodies[matched], 'text/csv');
      }, async () => {
        await fetchVoteViewSource({ force: true });
      });

      expect(requestLog).toHaveLength(3);
      expect(typeof lookupByCongress).toBe('function');
    } finally {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  it('reuses cached legislators YAML artifacts on non-force runs and only re-downloads them on force', async () => {
    const root = process.cwd();
    const tempDataDir = mkdtempSync(join(tmpdir(), 'us-code-tools-legislators-cache-'));
    process.env.US_CODE_TOOLS_DATA_DIR = tempDataDir;

    writeManifest(tempDataDir, createBaseManifest());

    const legislatorsMod = await importFresh(resolve(root, 'src', 'sources', 'unitedstates.ts'));
    const fetchUnitedStatesSource = pickCallable(legislatorsMod, ['fetchUnitedStatesSource', 'fetchLegislatorsSource']);

    const requestLog: string[] = [];
    const yamlBodies: Record<string, string> = {
      'legislators-current.yaml': '- id:\n    bioguide: A000360\n',
      'legislators-historical.yaml': '- id:\n    bioguide: B000001\n',
      'committees-current.yaml': '- thomas_id: HSAG\n',
    };

    try {
      await withStubbedFetch(async (url) => {
        requestLog.push(url);
        const matched = Object.keys(yamlBodies).find((filename) => url.endsWith(filename));
        if (!matched) {
          throw new Error(`Unexpected legislators URL: ${url}`);
        }

        return makeTextResponse(yamlBodies[matched], 'application/x-yaml');
      }, async () => {
        await fetchUnitedStatesSource({ force: false });
      });

      expect(requestLog).toHaveLength(3);
      expect(existsSync(resolve(tempDataDir, 'cache', 'legislators', 'legislators-current.yaml'))).toBe(true);

      requestLog.length = 0;

      await withStubbedFetch(async (url) => {
        requestLog.push(url);
        const matched = Object.keys(yamlBodies).find((filename) => url.endsWith(filename));
        if (!matched) {
          throw new Error(`Unexpected legislators URL on cached run: ${url}`);
        }

        return makeTextResponse(yamlBodies[matched], 'application/x-yaml');
      }, async () => {
        await fetchUnitedStatesSource({ force: false });
      });

      expect(requestLog).toHaveLength(0);

      await withStubbedFetch(async (url) => {
        requestLog.push(url);
        const matched = Object.keys(yamlBodies).find((filename) => url.endsWith(filename));
        if (!matched) {
          throw new Error(`Unexpected legislators URL on forced run: ${url}`);
        }

        return makeTextResponse(yamlBodies[matched], 'application/x-yaml');
      }, async () => {
        await fetchUnitedStatesSource({ force: true });
      });

      expect(requestLog).toHaveLength(3);

      const manifest = readManifest(tempDataDir);
      const legislatorsState = (manifest.sources as Record<string, unknown>).legislators as Record<string, unknown>;
      const files = legislatorsState.files as Record<string, Record<string, unknown>>;
      expect(Object.keys(files)).toHaveLength(3);
    } finally {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });
});
