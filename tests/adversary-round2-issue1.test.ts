import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pickCallable, safeImport, ensureModuleLoaded } from './utils/module-helpers';

function getZipPathFromUrl(url: string): string {
  return basename(new URL(url).pathname);
}

async function loadOlrcWithFetch(mockFetch: ((input: RequestInfo | URL) => Promise<unknown>) | typeof fetch) {
  const modulePath = resolve(process.cwd(), 'src', 'sources', 'olrc.ts');
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockFetch as typeof fetch;

  // Ensure ESM module cache does not reuse `nativeFetch` captured in an earlier test.
  vi.resetModules();

  const module = await safeImport(modulePath);
  ensureModuleLoaded(modulePath, module);

  return {
    module,
    restore: () => {
      globalThis.fetch = previousFetch;
      vi.resetModules();
    },
  };
}


describe('adversary round 2 regressions for #1', () => {
  it('rejects --output values that are existing files before doing transform work', () => {
    const outputFile = mkdtempSync(join(tmpdir(), 'us-code-tools-output-file-'));
    const outputAsFile = join(outputFile, 'existing.txt');
    writeFileSync(outputAsFile, 'occupied output target');

    const distEntry = resolve(process.cwd(), 'dist', 'index.js');
    const fixtureZip = resolve(process.cwd(), 'tests', 'fixtures', 'title-01', 'title-01.zip');

    const result = spawnSync(process.execPath, [distEntry, 'transform', '--title', '1', '--output', outputAsFile], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 20_000,
      env: {
        ...process.env,
        US_CODE_TOOLS_TITLE_01_FIXTURE_ZIP: fixtureZip,
      },
    });

    expect(result.status).not.toBe(0);
    const stderrPlusStdout = `${result.stdout}\n${result.stderr}`;

    expect(stderrPlusStdout).toMatch(/transform --title <number> --output <dir>/i);
    expect(stderrPlusStdout).toMatch(/output/i);
    expect(stderrPlusStdout).toMatch(/directory|folder/i);
    expect(stderrPlusStdout).not.toMatch(/EEXIST/i);

    rmSync(outputFile, { recursive: true, force: true });
  });

  it('re-downloads title zip when cached manifest or sha files are missing', async () => {
    const fixtureZip = resolve(process.cwd(), 'tests', 'fixtures', 'title-01', 'title-01.zip');
    const fixtureZipBytes = readFileSync(fixtureZip);
    const requestMock = vi.fn(async () => ({
      status: 200,
      headers: {
        get: () => 'application/zip',
      },
      arrayBuffer: async () => fixtureZipBytes.buffer,
    }));

    const { module, restore } = await loadOlrcWithFetch(async (input: RequestInfo | URL) => requestMock(String(input)));

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

    const cacheRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-cache-missing-manifest-'));
    const titleDir = resolve(cacheRoot, 'olrc', 'title-01');
    mkdirSync(titleDir, { recursive: true });

    const titleZipUrl = resolveUrl(1) as string;
    const zipFileName = getZipPathFromUrl(titleZipUrl);
    const zipPath = resolve(titleDir, zipFileName);
    const shaPath = `${zipPath}.sha256`;
    copyFileSync(fixtureZip, zipPath);

    // Missing manifest file intentionally.
    writeFileSync(shaPath, 'deadbeef');

    try {
      const resolvedPath = await getZipPath(1, cacheRoot);
      expect(resolvedPath).toBe(resolve(titleDir, zipFileName));
      expect(requestMock).toHaveBeenCalledTimes(1);
      expect(existsSync(zipPath)).toBe(true);
    } finally {
      restore();
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it('re-downloads when cached manifest/sha metadata is malformed or mismatched', async () => {
    const fixtureZip = resolve(process.cwd(), 'tests', 'fixtures', 'title-01', 'title-01.zip');
    const fixtureZipBytes = readFileSync(fixtureZip);
    const requestMock = vi.fn(async () => ({
      status: 200,
      headers: {
        get: () => 'application/zip',
      },
      arrayBuffer: async () => fixtureZipBytes.buffer,
    }));

    const { module, restore } = await loadOlrcWithFetch(async (input: RequestInfo | URL) => requestMock(String(input)));

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

    const cacheRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-cache-mismatch-'));
    const titleDir = resolve(cacheRoot, 'olrc', 'title-01');
    mkdirSync(titleDir, { recursive: true });

    const titleZipUrl = resolveUrl(1) as string;
    const zipFileName = getZipPathFromUrl(titleZipUrl);
    const zipPath = resolve(titleDir, zipFileName);
    const shaPath = `${zipPath}.sha256`;
    const manifestPath = resolve(titleDir, 'manifest.json');

    const fixtureStat = statSync(fixtureZip);
    copyFileSync(fixtureZip, zipPath);
    writeFileSync(
      manifestPath,
      JSON.stringify({
        title: 1,
        source_url: 'https://uscode.house.gov/download/releasepoints/us/pl/118/200/xml_usc01@118-200.zip',
        cache_key: 'title-01__xml_usc01@118-200',
        zip_filename: zipFileName,
        sha256: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        bytes: fixtureStat.size,
        downloaded_at: new Date(0).toISOString(),
        content_type: 'application/zip',
      }),
    );
    // Deliberately malformed sha sidecar content.
    writeFileSync(shaPath, 'sha-mismatch');

    try {
      const resolvedPath = await getZipPath(1, cacheRoot);
      expect(resolvedPath).toBe(resolve(titleDir, zipFileName));
      expect(requestMock).toHaveBeenCalledTimes(1);
    } finally {
      restore();
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });
});
