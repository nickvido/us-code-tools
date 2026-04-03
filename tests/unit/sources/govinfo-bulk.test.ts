import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readManifest } from '../../../src/utils/manifest.js';
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
});
