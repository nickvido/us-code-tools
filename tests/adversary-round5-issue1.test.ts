import { describe, it, expect, vi } from 'vitest';
import { basename, resolve, join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { pickCallable, safeImport, ensureModuleLoaded } from './utils/module-helpers';

function getZipNameForTitle(resolveUrl: (...args: unknown[]) => unknown, title: number): string {
  const titleUrl = resolveUrl(title) as string;
  return basename(new URL(titleUrl).pathname);
}

function toExactArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function loadOlrcWithMockFetch(mockFetch: (input: RequestInfo | URL) => Promise<unknown>) {
  const modulePath = resolve(process.cwd(), 'src', 'sources', 'olrc.ts');
  const originalFetch = globalThis.fetch;

  vi.resetModules();
  globalThis.fetch = ((input: RequestInfo | URL) => mockFetch(input)) as typeof fetch;

  const module = await safeImport(modulePath);
  ensureModuleLoaded(modulePath, module);

  return {
    module,
    restore: () => {
      globalThis.fetch = originalFetch;
      vi.resetModules();
    },
  };
}

describe('adversary round5 regressions for #1', () => {
  it('re-downloads cached zip artifacts that are PK-only but not readable', async () => {
    const fixtureZip = resolve(process.cwd(), 'tests', 'fixtures', 'title-01', 'title-01.zip');
    const fixtureBytes = readFileSync(fixtureZip);

    const requestMock = vi.fn(async () => ({
      status: 200,
      headers: {
        get: () => 'application/zip',
      },
      arrayBuffer: async () => toExactArrayBuffer(fixtureBytes),
    }));

    const { module, restore } = await loadOlrcWithMockFetch(async (input: RequestInfo | URL) => requestMock(String(input)));

    const resolveUrl = pickCallable(module, [
      'resolveTitleUrl',
      'buildTitleZipUrl',
      'getTitleUrl',
      'olrcUrlForTitle',
      'resolveOlrcUrl',
      'resolveTitleZipUrl',
      'buildTitleZipName',
    ]);

    const getZipPath = pickCallable(module, [
      'getOrCreateZipPath',
      'getTitleZipPath',
      'fetchAndCacheTitle',
      'downloadTitleZip',
      'ensureTitleZip',
      'ensureTitleXml',
      'obtainTitleArchive',
    ]);

    const cacheRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-cache-unreadable-'));
    const titleDir = resolve(cacheRoot, 'olrc', 'title-01');
    mkdirSync(titleDir, { recursive: true });

    const zipName = getZipNameForTitle(resolveUrl, 1);
    const zipPath = resolve(titleDir, zipName);
    const manifestPath = resolve(titleDir, 'manifest.json');
    const shaPath = `${zipPath}.sha256`;

    const unreadableZip = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('corrupted-zip-bytes')]);
    const unreadableSha = createHash('sha256').update(unreadableZip).digest('hex');

    writeFileSync(zipPath, unreadableZip);
    writeFileSync(
      manifestPath,
      JSON.stringify({
        title: 1,
        source_url: resolveUrl(1),
        cache_key: 'title-01__xml_usc01@118-200',
        zip_filename: zipName,
        sha256: unreadableSha,
        bytes: unreadableZip.length,
        downloaded_at: new Date(0).toISOString(),
        content_type: 'application/zip',
      }),
    );
    writeFileSync(shaPath, unreadableSha);

    try {
      const resolvedPath = await getZipPath(1, cacheRoot);

      expect(resolvedPath).toBe(zipPath);
      expect(requestMock).toHaveBeenCalledTimes(1);
    } finally {
      restore();
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it('rejects unreadable downloaded archive payloads that still start with ZIP magic bytes', async () => {
    const badZip = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('just a local-header and nothing else')]);

    const requestMock = vi.fn(async () => ({
      status: 200,
      headers: {
        get: () => 'application/zip',
      },
      arrayBuffer: async () => toExactArrayBuffer(badZip),
    }));

    const { module, restore } = await loadOlrcWithMockFetch(async (input: RequestInfo | URL) => requestMock(String(input)));

    const getZipPath = pickCallable(module, [
      'getOrCreateZipPath',
      'getTitleZipPath',
      'fetchAndCacheTitle',
      'downloadTitleZip',
      'ensureTitleZip',
      'ensureTitleXml',
      'obtainTitleArchive',
    ]);

    const cacheRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-cache-unreadable-download-'));

    try {
      await expect(getZipPath(1, cacheRoot)).rejects.toThrow(/zip|archive|invalid|unreadable|title 1/i);
      expect(requestMock).toHaveBeenCalledTimes(1);
    } finally {
      restore();
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });
});
