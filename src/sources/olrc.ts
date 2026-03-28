import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile, rename, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import yauzl from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';
import type { XmlEntry } from '../domain/model.js';
import { padTitleNumber } from '../domain/normalize.js';

const inflightDownloads = new Map<string, Promise<string>>();
const resolvedDownloads = new Map<string, string>();
const FIXTURE_ENV_PREFIX = 'US_CODE_TOOLS_TITLE_';
const nativeFetch = globalThis.fetch;

export function resolveTitleUrl(titleNumber: number): string {
  return `https://uscode.house.gov/download/releasepoints/us/pl/118/200/xml_usc${padTitleNumber(titleNumber)}@118-200.zip`;
}

export async function getTitleZipPath(titleNumber: number, cacheRoot: string): Promise<string> {
  const cacheKey = `${titleNumber}:${resolve(cacheRoot)}`;
  const resolvedPath = resolvedDownloads.get(cacheKey);
  if (resolvedPath) {
    return resolvedPath;
  }

  const existing = inflightDownloads.get(cacheKey);
  if (existing) {
    return existing;
  }

  const pending = getOrCreateZipPath(titleNumber, cacheRoot);
  inflightDownloads.set(cacheKey, pending);

  try {
    const zipPath = await pending;
    resolvedDownloads.set(cacheKey, zipPath);
    return zipPath;
  } finally {
    inflightDownloads.delete(cacheKey);
  }
}

export async function extractXmlEntriesFromZip(input: string | Buffer): Promise<XmlEntry[]> {
  const open = Buffer.isBuffer(input) ? openZipFromBuffer(input) : openZipFromPath(input);
  const zipFile = await open;

  return new Promise<XmlEntry[]>((resolveEntries, reject) => {
    const entries: XmlEntry[] = [];

    zipFile.on('entry', (entry: Entry) => {
      if (!entry.fileName.endsWith('.xml')) {
        zipFile.readEntry();
        return;
      }

      if (isUnsafeZipPath(entry.fileName)) {
        reject(new Error(`Unsafe XML entry path: ${entry.fileName}`));
        zipFile.close();
        return;
      }

      zipFile.openReadStream(entry, (streamError: Error | null, stream) => {
        if (streamError || !stream) {
          reject(streamError ?? new Error(`Failed to read ZIP entry: ${entry.fileName}`));
          zipFile.close();
          return;
        }

        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        stream.on('end', () => {
          entries.push({ xmlPath: entry.fileName, xml: Buffer.concat(chunks).toString('utf8') });
          zipFile.readEntry();
        });
        stream.on('error', (error: Error) => {
          reject(error);
          zipFile.close();
        });
      });
    });

    zipFile.once('end', () => resolveEntries(entries.sort((a, b) => a.xmlPath.localeCompare(b.xmlPath))));
    zipFile.once('error', reject);
    zipFile.readEntry();
  });
}

async function getOrCreateZipPath(titleNumber: number, cacheRoot: string): Promise<string> {
  const fixturePath = process.env[`${FIXTURE_ENV_PREFIX}${padTitleNumber(titleNumber)}_FIXTURE_ZIP`];
  if (fixturePath) {
    return fixturePath;
  }

  const url = resolveTitleUrl(titleNumber);
  const titleDirectory = resolve(cacheRoot, 'olrc', `title-${padTitleNumber(titleNumber)}`);
  const zipPath = resolve(titleDirectory, basename(url));

  const shouldTrustExistingCache = globalThis.fetch === nativeFetch;
  if (shouldTrustExistingCache && await isValidZipArtifact(zipPath)) {
    return zipPath;
  }

  await mkdir(titleDirectory, { recursive: true });
  const response = await fetch(url);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`failed to download title ${titleNumber} from ${url} (HTTP ${response.status})`);
  }

  const rawBuffer = Buffer.from(await response.arrayBuffer());
  const buffer = normalizeZipBuffer(rawBuffer);
  if (!isZipBuffer(buffer)) {
    throw new Error(`failed to download title ${titleNumber} from ${url} (non-ZIP payload)`);
  }

  const tempPath = `${zipPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, buffer);
  const manifest = {
    title: titleNumber,
    source_url: url,
    cache_key: `title-${padTitleNumber(titleNumber)}__${basename(url, '.zip')}`,
    zip_filename: basename(url),
    sha256: sha256(buffer),
    bytes: buffer.byteLength,
    downloaded_at: new Date().toISOString(),
    content_type: response.headers.get('content-type') ?? 'application/zip',
  };
  await rename(tempPath, zipPath);
  await writeFile(resolve(titleDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  await writeFile(resolve(titleDirectory, `${basename(url)}.sha256`), `${manifest.sha256}\n`, 'utf8');
  return zipPath;
}

async function isValidZipArtifact(zipPath: string): Promise<boolean> {
  try {
    const fileStat = await stat(zipPath);
    if (fileStat.size <= 0) {
      await rm(zipPath, { force: true });
      return false;
    }

    const buffer = await readFile(zipPath);
    return isZipBuffer(buffer);
  } catch {
    return false;
  }
}

function isZipBuffer(buffer: Buffer): boolean {
  return buffer.length >= 4
    && buffer[0] === 0x50
    && buffer[1] === 0x4b
    && buffer[2] === 0x03
    && buffer[3] === 0x04;
}

function normalizeZipBuffer(buffer: Buffer): Buffer {
  if (isZipBuffer(buffer)) {
    return buffer;
  }

  const signatureIndex = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  return signatureIndex >= 0 ? buffer.subarray(signatureIndex) : buffer;
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function isUnsafeZipPath(fileName: string): boolean {
  return fileName.startsWith('/') || fileName.includes('..') || /^[a-zA-Z]:/.test(fileName);
}

function openZipFromPath(path: string): Promise<ZipFile> {
  return new Promise((resolveZip, reject) => {
    yauzl.open(path, { lazyEntries: true }, (error: Error | null, zipFile?: ZipFile) => {
      if (error || !zipFile) {
        reject(error ?? new Error(`Failed to open ZIP: ${path}`));
        return;
      }
      resolveZip(zipFile);
    });
  });
}

function openZipFromBuffer(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolveZip, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error: Error | null, zipFile?: ZipFile) => {
      if (error || !zipFile) {
        reject(error ?? new Error('Failed to open ZIP buffer'));
        return;
      }
      resolveZip(zipFile);
    });
  });
}
