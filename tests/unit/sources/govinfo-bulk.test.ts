import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readManifest, writeManifest } from '../../../src/utils/manifest.js';
import { fetchGovInfoBulkSource } from '../../../src/sources/govinfo-bulk.js';
import { parseGovInfoBulkListing, resolveGovInfoBulkUrl } from '../../../src/utils/govinfo-bulk-listing.js';

const BILLSTATUS_XML = '<?xml version="1.0"?><billStatus><bill><congress>119</congress></bill></billStatus>';

function response(body: string | Buffer, contentType: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': contentType, 'content-length': String(Buffer.byteLength(body)) } });
}

function createZipBytes(fileName: string, contents: string): Buffer {
  const root = mkdtempSync(join(tmpdir(), 'govinfo-bulk-zip-'));
  const sourcePath = resolve(root, fileName);
  const archivePath = resolve(root, 'archive.zip');
  writeFileSync(sourcePath, contents, 'utf8');
  execFileSync('zip', ['-q', archivePath, fileName], { cwd: root });
  const bytes = readFileSync(archivePath);
  rmSync(root, { recursive: true, force: true });
  return bytes;
}

describe('govinfo bulk utilities', () => {
  it('parses XML directory listings and resolves directory/file entries', () => {
    const entries = parseGovInfoBulkListing(
      `<?xml version="1.0"?><directory><entry><name>119</name><href>119/</href></entry><entry><name>BILLSTATUS-119hr.xml.zip</name><href>119/hr/BILLSTATUS-119hr.xml.zip</href></entry></directory>`,
      'https://www.govinfo.gov/bulkdata/BILLSTATUS/',
    );

    expect(entries).toEqual([
      {
        name: '119',
        href: '119/',
        url: 'https://www.govinfo.gov/bulkdata/BILLSTATUS/119/',
        kind: 'directory',
      },
      {
        name: 'BILLSTATUS-119hr.xml.zip',
        href: '119/hr/BILLSTATUS-119hr.xml.zip',
        url: 'https://www.govinfo.gov/bulkdata/BILLSTATUS/119/hr/BILLSTATUS-119hr.xml.zip',
        kind: 'file',
      },
    ]);
    expect(() => resolveGovInfoBulkUrl('https://www.govinfo.gov/bulkdata/', 'https://example.com/evil.xml')).toThrow(/disallowed/i);
  });

  it('downloads, extracts, and records manifest-backed resume state for a BILLSTATUS artifact', async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'govinfo-bulk-'));
    const zipBytes = createZipBytes('bill.xml', BILLSTATUS_XML);
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://www.govinfo.gov/bulkdata/BILLSTATUS/') {
        return response('<?xml version="1.0"?><directory><entry><name>119</name><href>119/</href></entry></directory>', 'application/xml');
      }
      if (url === 'https://www.govinfo.gov/bulkdata/BILLSTATUS/119/') {
        return response('<?xml version="1.0"?><directory><entry><name>hr</name><href>hr/</href></entry></directory>', 'application/xml');
      }
      if (url === 'https://www.govinfo.gov/bulkdata/BILLSTATUS/119/hr/') {
        return response('<?xml version="1.0"?><directory><entry><name>BILLSTATUS-119hr.xml.zip</name><href>BILLSTATUS-119hr.xml.zip</href></entry></directory>', 'application/xml');
      }
      if (url === 'https://www.govinfo.gov/bulkdata/BILLSTATUS/119/hr/BILLSTATUS-119hr.xml.zip') {
        return response(zipBytes, 'application/zip');
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    try {
      const firstRun = await fetchGovInfoBulkSource({
        force: false,
        congress: 119,
        collection: 'BILLSTATUS',
        dataDirectory,
        fetchImpl,
      });

      expect(firstRun.ok).toBe(true);
      expect(firstRun.files_downloaded).toBe(1);
      expect(firstRun.files_skipped).toBe(0);
      expect(existsSync(resolve(dataDirectory, 'cache/govinfo-bulk/BILLSTATUS/119/hr/BILLSTATUS-119hr.xml.zip'))).toBe(true);
      expect(existsSync(resolve(dataDirectory, 'cache/govinfo-bulk/BILLSTATUS/119/hr/extracted/bill.xml'))).toBe(true);

      const manifest = await readManifest(dataDirectory);
      const state = (manifest.sources as typeof manifest.sources & { 'govinfo-bulk': { files: Record<string, { download_status: string; validation_status: string }> } })['govinfo-bulk'];
      const fileEntry = Object.values(state.files)[0];
      expect(fileEntry.download_status).toBe('extracted');
      expect(fileEntry.validation_status).toBe('zip_valid');

      const secondRun = await fetchGovInfoBulkSource({
        force: false,
        congress: 119,
        collection: 'BILLSTATUS',
        dataDirectory,
        fetchImpl,
      });
      expect(secondRun.files_downloaded).toBe(0);
      expect(secondRun.files_skipped).toBe(1);
    } finally {
      rmSync(dataDirectory, { recursive: true, force: true });
    }
  });

  it('rejects HTML payloads instead of marking artifacts complete', async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'govinfo-bulk-html-'));
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://www.govinfo.gov/bulkdata/BILLSUM/') {
        return response('<?xml version="1.0"?><directory><entry><name>119</name><href>119/</href></entry></directory>', 'application/xml');
      }
      if (url === 'https://www.govinfo.gov/bulkdata/BILLSUM/119/') {
        return response('<?xml version="1.0"?><directory><entry><name>summaries.xml</name><href>summaries.xml</href></entry></directory>', 'application/xml');
      }
      if (url === 'https://www.govinfo.gov/bulkdata/BILLSUM/119/summaries.xml') {
        return response('<html>not xml</html>', 'text/html');
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    try {
      const result = await fetchGovInfoBulkSource({ force: false, congress: 119, collection: 'BILLSUM', dataDirectory, fetchImpl });
      expect(result.ok).toBe(true);
      expect(result.files_failed).toBe(1);

      const manifest = await readManifest(dataDirectory);
      const state = (manifest.sources as typeof manifest.sources & { 'govinfo-bulk': { files: Record<string, { validation_status: string; download_status: string }> } })['govinfo-bulk'];
      const fileEntry = Object.values(state.files)[0];
      expect(fileEntry.validation_status).toBe('invalid_payload');
      expect(fileEntry.download_status).toBe('failed');
    } finally {
      rmSync(dataDirectory, { recursive: true, force: true });
    }
  });

  it('merges manifest writes from stale snapshots instead of dropping another writer\'s completed file state', async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'govinfo-bulk-manifest-race-'));

    try {
      const baseManifest = await readManifest(dataDirectory);
      const writerOneManifest = structuredClone(baseManifest);
      const writerTwoManifest = structuredClone(baseManifest);

      const writerOneState = (writerOneManifest.sources as typeof writerOneManifest.sources & {
        'govinfo-bulk': { files: Record<string, unknown> };
      })['govinfo-bulk'];
      writerOneState.files['BILLSTATUS:119:hr/BILLSTATUS-119hr.xml.zip'] = {
        source_url: 'https://www.govinfo.gov/bulkdata/BILLSTATUS/119/hr/BILLSTATUS-119hr.xml.zip',
        relative_cache_path: 'BILLSTATUS/119/hr/BILLSTATUS-119hr.xml.zip',
        congress: 119,
        collection: 'BILLSTATUS',
        listing_path: ['BILLSTATUS', '119', 'hr'],
        upstream_byte_size: 123,
        fetched_at: '2026-04-03T15:00:00.000Z',
        completed_at: '2026-04-03T15:00:01.000Z',
        download_status: 'extracted',
        validation_status: 'zip_valid',
        file_kind: 'zip',
        extraction_root: 'cache/govinfo-bulk/BILLSTATUS/119/hr/extracted',
        error: null,
      };

      const writerTwoState = (writerTwoManifest.sources as typeof writerTwoManifest.sources & {
        'govinfo-bulk': { files: Record<string, unknown> };
      })['govinfo-bulk'];
      writerTwoState.files['PLAW:118:public/PLAW-118publ1.xml'] = {
        source_url: 'https://www.govinfo.gov/bulkdata/PLAW/118/public/PLAW-118publ1.xml',
        relative_cache_path: 'PLAW/118/public/PLAW-118publ1.xml',
        congress: 118,
        collection: 'PLAW',
        listing_path: ['PLAW', '118', 'public'],
        upstream_byte_size: 456,
        fetched_at: '2026-04-03T15:00:02.000Z',
        completed_at: '2026-04-03T15:00:03.000Z',
        download_status: 'downloaded',
        validation_status: 'xml_valid',
        file_kind: 'xml',
        extraction_root: null,
        error: null,
      };

      await writeManifest(writerOneManifest, dataDirectory);
      await writeManifest(writerTwoManifest, dataDirectory);

      const mergedManifest = await readManifest(dataDirectory);
      const mergedState = (mergedManifest.sources as typeof mergedManifest.sources & {
        'govinfo-bulk': { files: Record<string, unknown> };
      })['govinfo-bulk'];

      expect(Object.keys(mergedState.files).sort()).toEqual([
        'BILLSTATUS:119:hr/BILLSTATUS-119hr.xml.zip',
        'PLAW:118:public/PLAW-118publ1.xml',
      ]);
    } finally {
      rmSync(dataDirectory, { recursive: true, force: true });
    }
  });

  it('streams file downloads to disk instead of requiring response.arrayBuffer()', async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'govinfo-bulk-streaming-'));
    const streamedXml = '<?xml version="1.0"?><summary><writer>streamed</writer></summary>';

    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://www.govinfo.gov/bulkdata/BILLSUM/') {
        return response('<?xml version="1.0"?><directory><entry><name>119</name><href>119/</href></entry></directory>', 'application/xml');
      }
      if (url === 'https://www.govinfo.gov/bulkdata/BILLSUM/119/') {
        return response('<?xml version="1.0"?><directory><entry><name>summaries.xml</name><href>summaries.xml</href></entry></directory>', 'application/xml');
      }
      if (url === 'https://www.govinfo.gov/bulkdata/BILLSUM/119/summaries.xml') {
        const streamedResponse = new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(streamedXml));
            controller.close();
          },
        }), {
          status: 200,
          headers: {
            'content-type': 'application/xml',
            'content-length': String(Buffer.byteLength(streamedXml)),
          },
        });
        Object.defineProperty(streamedResponse, 'arrayBuffer', {
          value: async () => {
            throw new Error('download path must stream instead of buffering');
          },
        });
        return streamedResponse;
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    try {
      const result = await fetchGovInfoBulkSource({ force: false, congress: 119, collection: 'BILLSUM', dataDirectory, fetchImpl });
      expect(result.ok).toBe(true);
      expect(result.files_downloaded).toBe(1);
      expect(readFileSync(resolve(dataDirectory, 'cache/govinfo-bulk/BILLSUM/119/summaries.xml'), 'utf8')).toContain('<writer>streamed</writer>');
    } finally {
      rmSync(dataDirectory, { recursive: true, force: true });
    }
  });

  it('keeps the first completed artifact when overlapping runs target the same file', async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'govinfo-bulk-overlap-'));
    const firstXml = '<?xml version="1.0"?><summary><writer>first</writer></summary>';
    const secondXml = '<?xml version="1.0"?><summary><writer>second</writer></summary>';
    let releaseFirstDownload: (() => void) | null = null;
    const firstDownloadReady = new Promise<void>((resolveReady) => {
      releaseFirstDownload = resolveReady;
    });
    let fileRequestCount = 0;

    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://www.govinfo.gov/bulkdata/BILLSUM/') {
        return response('<?xml version="1.0"?><directory><entry><name>119</name><href>119/</href></entry></directory>', 'application/xml');
      }
      if (url === 'https://www.govinfo.gov/bulkdata/BILLSUM/119/') {
        return response('<?xml version="1.0"?><directory><entry><name>summaries.xml</name><href>summaries.xml</href></entry></directory>', 'application/xml');
      }
      if (url === 'https://www.govinfo.gov/bulkdata/BILLSUM/119/summaries.xml') {
        fileRequestCount += 1;
        if (fileRequestCount === 1) {
          await firstDownloadReady;
          return response(firstXml, 'application/xml');
        }
        return response(secondXml, 'application/xml');
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    try {
      const firstRun = fetchGovInfoBulkSource({ force: false, congress: 119, collection: 'BILLSUM', dataDirectory, fetchImpl });
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      const secondRun = fetchGovInfoBulkSource({ force: false, congress: 119, collection: 'BILLSUM', dataDirectory, fetchImpl });
      releaseFirstDownload?.();

      const [firstResult, secondResult] = await Promise.all([firstRun, secondRun]);
      expect(firstResult.ok).toBe(true);
      expect(secondResult.ok).toBe(true);

      const finalPath = resolve(dataDirectory, 'cache/govinfo-bulk/BILLSUM/119/summaries.xml');
      expect(readFileSync(finalPath, 'utf8')).toContain('<writer>first</writer>');

      const manifest = await readManifest(dataDirectory);
      const state = (manifest.sources as typeof manifest.sources & {
        'govinfo-bulk': { files: Record<string, { completed_at: string | null; relative_cache_path: string }> };
      })['govinfo-bulk'];
      expect(Object.values(state.files)).toHaveLength(1);
      expect(Object.values(state.files)[0].completed_at).not.toBeNull();
      expect(fileRequestCount).toBe(2);
    } finally {
      rmSync(dataDirectory, { recursive: true, force: true });
    }
  });
});
