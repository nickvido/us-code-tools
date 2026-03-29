import { describe, it, expect, vi } from 'vitest';
import { dirname, resolve, join } from 'node:path';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
type CandidateModule = Record<string, unknown>;

function pickCallable(module: CandidateModule, candidates: string[]) {
  for (const name of candidates) {
    if (typeof module[name as keyof CandidateModule] === 'function') {
      return module[name as keyof CandidateModule] as (...args: unknown[]) => unknown;
    }
  }

  throw new Error(`No callable found in module for candidates: ${candidates.join(', ')}`);
}

async function safeImport(modulePath: string): Promise<CandidateModule> {
  const asUrl = pathToFileURL(modulePath).href;
  return (await import(asUrl)) as CandidateModule;
}

function ensureModuleLoaded(modulePath: string, module: CandidateModule) {
  if (Object.keys(module).length === 0) {
    throw new Error(`Could not load module at ${modulePath}`);
  }
}

describe('OLRC source and cache behavior', () => {
  it('constructs deterministic OLRC title-01 URL', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'sources', 'olrc.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);

    const resolveUrl = pickCallable(mod, [
      'resolveTitleUrl',
      'buildTitleZipUrl',
      'getTitleUrl',
      'olrcUrlForTitle',
      'resolveOlrcUrl',
      'resolveTitleZipUrl',
    ]);

    const url = resolveUrl(1);
    expect(url).toBe('https://uscode.house.gov/download/releasepoints/us/pl/118/200/xml_usc01@118-200.zip');
  });

  it('parses XML entries in lexical order when handling multiple entries', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'sources', 'olrc.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);

    const selectXmlEntries = pickCallable(mod, [
      'extractXmlEntriesFromZip',
      'listXmlEntriesFromZip',
      'collectXmlEntries',
      'getXmlEntriesFromZip',
      'parseZipEntries',
    ]);

    const zipPath = resolve(process.cwd(), 'tests', 'fixtures', 'title-01', 'title-01.zip');
    const zipBytes = readFileSync(zipPath);

    const entries = await selectXmlEntries(zipBytes);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThanOrEqual(2);

    const paths = entries.map((entry: any) => entry.xmlPath ?? entry.path ?? entry.name);
    expect(paths).toEqual([...paths].sort());
    expect(paths[0]).toContain('nested/usc01-extra.xml');
  });

  it('rejects duplicate normalized XML destinations in one ZIP', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'sources', 'olrc.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);

    const selectXmlEntries = pickCallable(mod, [
      'extractXmlEntriesFromZip',
      'listXmlEntriesFromZip',
      'collectXmlEntries',
      'getXmlEntriesFromZip',
      'parseZipEntries',
    ]);

    const zipPath = buildFixtureZip([
      { name: 'safe.xml', content: '<title>first</title>' },
      { name: 'nested/../safe.xml', content: '<title>second</title>' },
    ]);

    const zipBytes = readFileSync(zipPath);

    await expect(selectXmlEntries(zipBytes)).rejects.toThrow(/duplicate|normalized|destination|path/i);
    rmSync(dirname(zipPath), { recursive: true, force: true });
  });

  it('rejects non-regular XML entries like symlinks before extraction', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'sources', 'olrc.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);

    const selectXmlEntries = pickCallable(mod, [
      'extractXmlEntriesFromZip',
      'listXmlEntriesFromZip',
      'collectXmlEntries',
      'getXmlEntriesFromZip',
      'parseZipEntries',
    ]);

    const zipPath = buildFixtureZip([
      { name: 'regular.xml', content: '<title>ok</title>' },
      { name: 'bad-link.xml', symlinkTo: 'regular.xml' },
    ]);

    const zipBytes = readFileSync(zipPath);
    await expect(selectXmlEntries(zipBytes)).rejects.toThrow(/symlink|non-regular|special|entry/i);

    rmSync(dirname(zipPath), { recursive: true, force: true });
  });

  it('rejects oversized XML entries that exceed bounded extraction caps', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'sources', 'olrc.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);

    const selectXmlEntries = pickCallable(mod, [
      'extractXmlEntriesFromZip',
      'listXmlEntriesFromZip',
      'collectXmlEntries',
      'getXmlEntriesFromZip',
      'parseZipEntries',
    ]);

    const zipPath = buildFixtureZip([
      { name: 'gigantic.xml', bytes: 70 * 1024 * 1024 },
    ]);

    const zipBytes = readFileSync(zipPath);
    await expect(selectXmlEntries(zipBytes)).rejects.toThrow(/bytes?|size|limit|cap|quota|entry/i);
    rmSync(dirname(zipPath), { recursive: true, force: true });
  });

  it('downloads title 1 with at-most-once semantics in mocked runtime', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'sources', 'olrc.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);

    const getZipPath = pickCallable(mod, [
      'getTitleZipPath',
      'getOrCreateZipPath',
      'fetchAndCacheTitle',
      'downloadTitleZip',
      'ensureTitleZip',
      'ensureTitleXml',
      'obtainTitleArchive',
    ]);

    const requestMock = vi.fn().mockResolvedValue({
      status: 200,
      headers: { get: () => 'application/zip' },
      arrayBuffer: async () => readFileSync(resolve(process.cwd(), 'tests/fixtures/title-01/title-01.zip')).buffer,
    });

    const cacheRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-cache-'));
    const originalFetch = globalThis.fetch;
    const ctx: Record<string, unknown> = {};
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const req = String(input);
      ctx.lastUrl = req;
      return requestMock(req);
    }) as typeof fetch;

    try {
      const firstRun = await getZipPath(1, cacheRoot);
      const secondRun = await getZipPath(1, cacheRoot);

      expect(firstRun).toBeTypeOf('string');
      expect(secondRun).toBe(firstRun);
      expect(requestMock).toHaveBeenCalledTimes(1);
      expect(String(ctx.lastUrl)).toContain('xml_usc01@118-200.zip');
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it('retries once on transient timeout/connection errors before succeeding', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'sources', 'olrc.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);

    const getZipPath = pickCallable(mod, [
      'getOrCreateZipPath',
      'getTitleZipPath',
      'fetchAndCacheTitle',
      'downloadTitleZip',
      'ensureTitleZip',
      'ensureTitleXml',
      'obtainTitleArchive',
    ]);

    const transient = new Error('timed out') as NodeJS.ErrnoException;
    transient.code = 'ETIMEDOUT';

    let calls = 0;
    const requestMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        throw transient;
      }

      return {
        status: 200,
        headers: { get: () => 'application/zip' },
        arrayBuffer: async () => readFileSync(resolve(process.cwd(), 'tests/fixtures/title-01/title-01.zip')).buffer,
      };
    });

    const cacheRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-cache-retry-'));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => requestMock(String(input))) as typeof fetch;

    try {
      await expect(getZipPath(1, cacheRoot)).resolves.toBeTypeOf('string');
      expect(calls).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  }, 45000);

  it('fails with title and URL text after transient failure retry budget is exhausted', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'sources', 'olrc.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);

    const getZipPath = pickCallable(mod, [
      'getOrCreateZipPath',
      'getTitleZipPath',
      'fetchAndCacheTitle',
      'downloadTitleZip',
      'ensureTitleZip',
      'ensureTitleXml',
      'obtainTitleArchive',
    ]);

    const transient = new Error('socket hang up') as NodeJS.ErrnoException;
    transient.code = 'ECONNRESET';

    const requestMock = vi.fn().mockRejectedValue(transient);

    const cacheRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-cache-fail-'));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => requestMock(String(input))) as typeof fetch;

    try {
      const result = getZipPath(1, cacheRoot);
      await expect(result).rejects.toThrow(/title 1/i);
      await expect(result).rejects.toThrow(/xml_usc01@118-200.zip/i);
      expect(requestMock).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  }, 45000);

  it('bootstraps homepage cookies before requesting download.shtml and releasepoint ZIPs', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'sources', 'olrc.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);

    // NOTE: Use the EXISTING fetchOlrcSource signature — do NOT add a new overload for this test.
    const fetchOlrcSource = pickCallable(mod, [
      'fetchOlrcSource',
      'fetchOlrc',
      'runOlrcFetch',
      'fetchSourceOlrc',
    ]);

    const cacheRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-olrc-cookie-'));
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; headers: Headers }> = [];
    const title01Zip = readFileSync(resolve(process.cwd(), 'tests/fixtures/title-01/title-01.zip'));

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      requests.push({ url, headers });

      if (url === 'https://uscode.house.gov/') {
        return new Response('<html>home</html>', {
          status: 200,
          headers: {
            'Set-Cookie': 'JSESSIONID=test-session; Path=/; Secure; HttpOnly',
            'Content-Type': 'text/html; charset=utf-8',
          },
        });
      }

      if (url === 'https://uscode.house.gov/download/download.shtml') {
        return new Response(`
          <html><body>
            <a href="/download/releasepoints/us/pl/119/73/xml_usc01@119-73.zip">Title 1</a>
          </body></html>
        `, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }

      if (url.endsWith('xml_usc01@119-73.zip')) {
        return new Response(title01Zip, { status: 200, headers: { 'Content-Type': 'application/zip' } });
      }

      return new Response('not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
    }) as typeof fetch;

    try {
      const result = await fetchOlrcSource({ force: false, cacheRoot });
      expect((result as any)?.ok).toBe(true);

      const listing = requests.find((request) => request.url === 'https://uscode.house.gov/download/download.shtml');
      const zip = requests.find((request) => request.url.endsWith('xml_usc01@119-73.zip'));

      expect(requests[0]?.url).toBe('https://uscode.house.gov/');
      expect(listing?.headers.get('cookie') ?? listing?.headers.get('Cookie')).toContain('JSESSIONID=test-session');
      expect(zip?.headers.get('cookie') ?? zip?.headers.get('Cookie')).toContain('JSESSIONID=test-session');
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it('parses download.shtml releasepoint listings by newest numeric vintage and ignores appendix links', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'sources', 'olrc.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);

    const fetchPlan = pickCallable(mod, [
      'fetchOlrcVintagePlan',
      'getOlrcVintagePlan',
      'discoverOlrcVintagePlan',
      'discoverOlrcReleasePlan',
    ]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://uscode.house.gov/') {
        return new Response('ok', { status: 200, headers: { 'Set-Cookie': 'JSESSIONID=listing-session; Path=/; HttpOnly' } });
      }

      if (url === 'https://uscode.house.gov/download/download.shtml') {
        return new Response(`
          <html><body>
            <a href="/download/releasepoints/us/pl/118/200/xml_usc01@118-200.zip">older title 1</a>
            <a href="/download/releasepoints/us/pl/119/73/xml_usc01@119-73.zip">newer title 1</a>
            <a href="/download/releasepoints/us/pl/119/73/xml_usc05a@119-73.zip">appendix 5a</a>
            <a href="https://uscode.house.gov/download/releasepoints/us/pl/119/73/xml_usc02@119-73.zip">newer title 2</a>
          </body></html>
        `, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }

      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    try {
      const plan = await fetchPlan();
      const anyPlan = plan as any;
      const urls = JSON.stringify(anyPlan);
      expect(urls).toContain('119-73');
      expect(urls).toContain('xml_usc01@119-73.zip');
      expect(urls).toContain('xml_usc02@119-73.zip');
      expect(urls).not.toContain('xml_usc05a@119-73.zip');
      expect(urls).not.toContain('xml_usc01@118-200.zip');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('accepts a bounded large XML entry fixture for current Title 42 sized extraction', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'sources', 'olrc.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);

    const selectXmlEntries = pickCallable(mod, [
      'extractXmlEntriesFromZip',
      'listXmlEntriesFromZip',
      'collectXmlEntries',
      'getXmlEntriesFromZip',
      'parseZipEntries',
    ]);

    const zipPath = buildFixtureZip([
      { name: 'usc42.xml', bytes: 80 * 1024 * 1024 },
    ]);

    try {
      const entries = await selectXmlEntries(readFileSync(zipPath));
      expect(Array.isArray(entries)).toBe(true);
      expect(entries).toHaveLength(1);
      expect((entries[0] as any).xmlPath ?? (entries[0] as any).path ?? (entries[0] as any).name).toContain('usc42.xml');
    } finally {
      rmSync(dirname(zipPath), { recursive: true, force: true });
    }
  }, 45000);

  it('classifies Title 53 HTML payloads as reserved_empty and avoids caching unreadable artifacts', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'sources', 'olrc.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);

    // NOTE: Use the EXISTING fetchOlrcSource signature — do NOT add a new overload for this test.
    const fetchOlrcSource = pickCallable(mod, [
      'fetchOlrcSource',
      'fetchOlrc',
      'runOlrcFetch',
      'fetchSourceOlrc',
    ]);

    const cacheRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-olrc-53-'));
    const originalFetch = globalThis.fetch;
    const title01Zip = readFileSync(resolve(process.cwd(), 'tests/fixtures/title-01/title-01.zip'));

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://uscode.house.gov/') {
        return new Response('ok', { status: 200, headers: { 'Set-Cookie': 'JSESSIONID=reserved-empty; Path=/; HttpOnly' } });
      }

      if (url === 'https://uscode.house.gov/download/download.shtml') {
        return new Response(`
          <html><body>
            <a href="/download/releasepoints/us/pl/119/73/xml_usc01@119-73.zip">Title 1</a>
            <a href="/download/releasepoints/us/pl/119/73/xml_usc53@119-73.zip">Title 53</a>
          </body></html>
        `, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }

      if (url.endsWith('xml_usc01@119-73.zip')) {
        return new Response(title01Zip, { status: 200, headers: { 'Content-Type': 'application/zip' } });
      }

      if (url.endsWith('xml_usc53@119-73.zip')) {
        return new Response('<html><body>Reserved</body></html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }

      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    try {
      const result = await fetchOlrcSource({ force: false, cacheRoot });
      const encoded = JSON.stringify(result);
      expect((result as any)?.ok).toBe(true);
      expect(encoded).toContain('reserved_empty');
      expect(encoded).toContain('53');
      expect(encoded).toContain('119-73');
      expect(existsSync(resolve(cacheRoot, 'title-53'))).toBe(false);
      expect(existsSync(resolve(cacheRoot, 'vintages', '119-73', 'title-53'))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });
});

function buildFixtureZip(entries: Array<{ name: string; content?: string; symlinkTo?: string; bytes?: number }>): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-zip-'));
  const zipPath = resolve(fixtureRoot, 'fixture.zip');
  const scriptPath = resolve(fixtureRoot, 'make_zip.py');

  const payloadB64 = Buffer.from(JSON.stringify(entries), 'utf8').toString('base64');
  const pythonScript = `
import base64
import json
import sys
import zipfile

zip_path = sys.argv[1]
entries = json.loads(base64.b64decode(sys.argv[2]).decode('utf-8'))

with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
    for entry in entries:
        name = entry['name']
        if entry.get('symlinkTo'):
            info = zipfile.ZipInfo(name)
            info.create_system = 3
            # 0o120000 denotes symbolic link in Unix permissions; include a file-mode for lint safety.
            info.external_attr = (0o120777 << 16)
            zf.writestr(info, entry['symlinkTo'])
            continue

        if 'bytes' in entry:
            pattern = entry.get('content', 'x')
            zf.writestr(name, pattern * int(entry['bytes']))
        else:
            zf.writestr(name, entry.get('content', ''))
`;

  writeFileSync(scriptPath, pythonScript);
  const cmd = `python3 ${JSON.stringify(scriptPath)} ${JSON.stringify(zipPath)} ${JSON.stringify(payloadB64)}`;
  execSync(cmd, { stdio: 'ignore' });
  return zipPath;
}
