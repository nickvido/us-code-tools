import { describe, it, expect, vi } from 'vitest';
import { resolve } from 'node:path';
import { pickCallable, safeImport, ensureModuleLoaded } from '../../utils/module-helpers';
import { readFileSync } from 'node:fs';

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

  it('downloads title 1 with at-most-once semantics in mocked runtime', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'sources', 'olrc.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);

    const getZipPath = pickCallable(mod, [
      'getTitleZipPath',
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

    const originalFetch = globalThis.fetch;
    const ctx: Record<string, unknown> = {};
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const req = String(input);
      ctx.lastUrl = req;
      return requestMock(req);
    }) as typeof fetch;

    try {
      const firstRun = await getZipPath(1, resolve(process.cwd(), '.cache'));
      const secondRun = await getZipPath(1, resolve(process.cwd(), '.cache'));

      expect(firstRun).toBeTypeOf('string');
      expect(secondRun).toBe(firstRun);
      expect(requestMock).toHaveBeenCalledTimes(1);
      expect(String(ctx.lastUrl)).toContain('xml_usc01@118-200.zip');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
