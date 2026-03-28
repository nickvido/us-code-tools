import { describe, it, expect, vi } from 'vitest';
import { dirname, resolve, join } from 'node:path';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
