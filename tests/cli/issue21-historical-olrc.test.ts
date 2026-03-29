import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';

const projectRoot = resolve(process.cwd());
const distEntry = resolve(projectRoot, 'dist', 'index.js');
const title01Zip = readFileSync(resolve(projectRoot, 'tests', 'fixtures', 'title-01', 'title-01.zip'));

function buildDist(): void {
  execSync('npm run build', {
    cwd: projectRoot,
    stdio: 'pipe',
    env: process.env,
    timeout: 120_000,
  });
}

function createMockOlrcImport(tempRoot: string): string {
  const importPath = join(tempRoot, 'mock-olrc.mjs');
  writeFileSync(importPath, `
const spec = JSON.parse(Buffer.from(process.env.OLRC_FIXTURE_SPEC_B64 || '', 'base64').toString('utf8'));
const title01Zip = Buffer.from(process.env.OLRC_TITLE01_ZIP_B64 || '', 'base64');
globalThis.__olrcRequestLog = [];

function buildListingEntries(vintage) {
  const configured = (spec.listingTitles || []).find((entry) => entry.vintage === vintage);
  if (configured) {
    return configured.titles.flatMap((title) => {
      if (typeof title === 'string') {
        return [
          '<a href="/download/releasepoints/us/pl/' + vintage.replace('-', '/') + '/xml_usc' + title + '@' + vintage + '.zip">Title ' + title + '</a>',
        ];
      }

      return [
        '<a href="/download/releasepoints/us/pl/' + vintage.replace('-', '/') + '/xml_usc' + String(title).padStart(2, '0') + '@' + vintage + '.zip">Title ' + title + '</a>',
      ];
    });
  }

  return [
    '<a href="/download/releasepoints/us/pl/' + vintage.replace('-', '/') + '/xml_usc01@' + vintage + '.zip">Title 1</a>',
    '<a href="/download/releasepoints/us/pl/' + vintage.replace('-', '/') + '/xml_usc02@' + vintage + '.zip">Title 2</a>',
    '<a href="/download/releasepoints/us/pl/' + vintage.replace('-', '/') + '/xml_usc05a@' + vintage + '.zip">Appendix 5a</a>',
  ];
}

function htmlForListing(vintages) {
  return '<html><body>' + vintages.flatMap((vintage) => buildListingEntries(vintage)).join('') + '</body></html>';
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  globalThis.__olrcRequestLog.push(url);

  if (url === 'https://uscode.house.gov/') {
    return new Response('<html>home</html>', {
      status: 200,
      headers: {
        'Set-Cookie': 'JSESSIONID=issue21-session; Path=/; HttpOnly',
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  }

  if (url === 'https://uscode.house.gov/download/download.shtml') {
    return new Response(htmlForListing(spec.vintages), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const zipMatch = url.match(/xml_usc(\\d{2})@([0-9]+-[0-9]+)\\.zip$/);
  if (zipMatch) {
    const title = Number(zipMatch[1]);
    const vintage = zipMatch[2];
    if ((spec.failVintages || []).includes(vintage)) {
      return new Response('upstream failure for ' + vintage, {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    const configured = (spec.listingTitles || []).find((entry) => entry.vintage === vintage);
    if (configured && !configured.titles.includes(title) && !configured.titles.includes(String(title).padStart(2, '0'))) {
      return new Response('missing from listing for ' + vintage + ' title ' + title, {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    if ((spec.htmlPayloadTitles || []).some((entry) => entry.vintage === vintage && entry.title === title)) {
      return new Response('<html><body>Reserved</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    return new Response(title01Zip, {
      status: 200,
      headers: { 'Content-Type': 'application/zip' },
    });
  }

  return originalFetch(input, init);
};
`);

  return importPath;
}

function runFetch(
  args: string[],
  fixture: {
    vintages: string[];
    failVintages?: string[];
    htmlPayloadTitles?: Array<{ vintage: string; title: number }>;
    listingTitles?: Array<{ vintage: string; titles: Array<number | string> }>;
  },
) {
  const tempRoot = join(tmpdir(), `us-code-tools-issue21-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempRoot, { recursive: true });
  const mockImport = createMockOlrcImport(tempRoot);

  const result = spawnSync(process.execPath, ['--import', mockImport, distEntry, 'fetch', ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      HOME: tempRoot,
      XDG_CACHE_HOME: join(tempRoot, '.cache'),
      US_CODE_TOOLS_DATA_DIR: join(tempRoot, 'data'),
      OLRC_FIXTURE_SPEC_B64: Buffer.from(JSON.stringify(fixture), 'utf8').toString('base64'),
      OLRC_TITLE01_ZIP_B64: title01Zip.toString('base64'),
    },
  });

  return {
    ...result,
    tempRoot,
    dataDir: join(tempRoot, 'data'),
    cleanup() {
      rmSync(tempRoot, { recursive: true, force: true });
    },
  };
}

describe('issue 21 historical OLRC fetch CLI', () => {
  beforeAll(() => {
    buildDist();
  });

  it('rejects duplicate --vintage flags before OLRC discovery and leaves cache and manifest untouched', () => {
    const result = runFetch(['--source=olrc', '--vintage=113-1', '--vintage=113-1'], {
      vintages: ['119-73', '118-200', '113-1'],
    });

    try {
      expect(result.status).toBe(2);
      expect(result.stdout.trim()).toBe('');
      const payload = JSON.parse(result.stderr.trim()) as { error?: { code?: string; message?: string } };
      expect(payload.error?.code).toBe('invalid_arguments');
      expect(payload.error?.message ?? '').toMatch(/vintage/i);
      expect(existsSync(join(result.dataDir, 'manifest.json'))).toBe(false);
      expect(existsSync(join(result.dataDir, 'cache', 'olrc'))).toBe(false);
    } finally {
      result.cleanup();
    }
  });

  it('lists available vintages in descending order without mutating manifest or cache state', () => {
    const result = runFetch(['--source=olrc', '--list-vintages'], {
      vintages: ['117-163', '119-73', '118-200', '119-73'],
    });

    try {
      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout.trim()) as {
        source?: string;
        ok?: boolean;
        available_vintages?: string[];
        latest_vintage?: string;
      };
      expect(payload.source).toBe('olrc');
      expect(payload.ok).toBe(true);
      expect(payload.available_vintages).toEqual(['119-73', '118-200', '117-163']);
      expect(payload.latest_vintage).toBe('119-73');
      expect(existsSync(join(result.dataDir, 'manifest.json'))).toBe(false);
      expect(existsSync(join(result.dataDir, 'cache', 'olrc', 'vintages'))).toBe(false);
    } finally {
      result.cleanup();
    }
  });

  it('returns unknown_vintage without creating a vintage directory when the requested vintage is absent', () => {
    const result = runFetch(['--source=olrc', '--vintage=113-1'], {
      vintages: ['119-73', '118-200', '117-163'],
    });

    try {
      expect(result.status).toBe(1);
      const payload = JSON.parse(result.stdout.trim()) as {
        source?: string;
        ok?: boolean;
        selected_vintage?: string;
        error?: { code?: string };
      };
      expect(payload.source).toBe('olrc');
      expect(payload.ok).toBe(false);
      expect(payload.selected_vintage).toBe('113-1');
      expect(payload.error?.code).toBe('unknown_vintage');
      expect(existsSync(join(result.dataDir, 'cache', 'olrc', 'vintages', '113-1'))).toBe(false);
      if (existsSync(join(result.dataDir, 'manifest.json'))) {
        const manifest = readFileSync(join(result.dataDir, 'manifest.json'), 'utf8');
        expect(manifest).not.toContain('113-1');
      }
    } finally {
      result.cleanup();
    }
  });

  it('keeps going across vintages and reports per-vintage outcomes for --all-vintages partial failure', () => {
    const result = runFetch(['--source=olrc', '--all-vintages'], {
      vintages: ['119-73', '118-200', '117-163'],
      failVintages: ['118-200'],
      htmlPayloadTitles: [{ vintage: '119-73', title: 2 }, { vintage: '117-163', title: 2 }],
    });

    try {
      expect(result.status).toBe(1);
      const payload = JSON.parse(result.stdout.trim()) as {
        source?: string;
        ok?: boolean;
        mode?: string;
        available_vintages?: string[];
        results?: Array<{ vintage?: string; ok?: boolean; error?: { code?: string } }>;
      };
      expect(payload.source).toBe('olrc');
      expect(payload.ok).toBe(false);
      expect(payload.mode).toBe('all_vintages');
      expect(payload.available_vintages).toEqual(['119-73', '118-200', '117-163']);
      expect(payload.results).toHaveLength(3);
      expect(payload.results?.map((entry) => [entry.vintage, entry.ok])).toEqual([
        ['119-73', true],
        ['118-200', false],
        ['117-163', true],
      ]);
      expect(payload.results?.[1]?.error?.code).toBe('upstream_request_failed');
      expect(existsSync(join(result.dataDir, 'cache', 'olrc', 'vintages', '119-73'))).toBe(true);
      expect(existsSync(join(result.dataDir, 'cache', 'olrc', 'vintages', '117-163'))).toBe(true);
    } finally {
      result.cleanup();
    }
  }, 45_000);

  it('fetches a sparse historical vintage using only discovered title URLs and reports missing titles instead of fabricated download failures', () => {
    const result = runFetch(['--source=olrc', '--vintage=118-200'], {
      vintages: ['119-73', '118-200'],
      listingTitles: [
        { vintage: '119-73', titles: [1, 2, '05a'] },
        { vintage: '118-200', titles: [1] },
      ],
    });

    try {
      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout.trim()) as {
        source?: string;
        ok?: boolean;
        selected_vintage?: string;
        missing_titles?: number[];
        counts?: { titles_downloaded?: number };
        error?: { code?: string };
      };
      expect(payload.source).toBe('olrc');
      expect(payload.ok).toBe(true);
      expect(payload.selected_vintage).toBe('118-200');
      expect(payload.counts?.titles_downloaded).toBe(1);
      expect(payload.missing_titles).toContain(2);
      expect(payload.error).toBeUndefined();
      expect(existsSync(join(result.dataDir, 'cache', 'olrc', 'vintages', '118-200', 'title-01'))).toBe(true);
      expect(existsSync(join(result.dataDir, 'cache', 'olrc', 'vintages', '118-200', 'title-02'))).toBe(false);

      const manifest = JSON.parse(readFileSync(join(result.dataDir, 'manifest.json'), 'utf8')) as {
        sources?: {
          olrc?: {
            vintages?: Record<string, { missing_titles?: number[]; titles?: Record<string, { status?: string }> }>;
          };
        };
      };
      expect(manifest.sources?.olrc?.vintages?.['118-200']?.missing_titles).toContain(2);
      expect(manifest.sources?.olrc?.vintages?.['118-200']?.titles?.['2']).toBeUndefined();
    } finally {
      result.cleanup();
    }
  }, 45_000);
});
