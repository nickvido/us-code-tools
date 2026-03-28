import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile, rename, rm } from 'node:fs/promises';
import { basename, normalize, resolve } from 'node:path';
import yauzl from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';
import type { XmlEntry } from '../domain/model.js';
import { padTitleNumber } from '../domain/normalize.js';
import { getCachePaths } from '../utils/cache.js';
import { readManifest, writeManifest } from '../utils/manifest.js';

const inflightDownloads = new Map<string, Promise<string>>();
const resolvedDownloads = new Map<string, string>();
const FIXTURE_ENV_PREFIX = 'US_CODE_TOOLS_TITLE_';
const nativeFetch = globalThis.fetch;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const DOWNLOAD_RETRY_COUNT = 1;
const MAX_XML_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_XML_BYTES = 256 * 1024 * 1024;

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
  const zipFile = await (Buffer.isBuffer(input) ? openZipFromBuffer(input) : openZipFromPath(input));

  return new Promise<XmlEntry[]>((resolveEntries, reject) => {
    const entries: XmlEntry[] = [];
    const normalizedDestinations = new Set<string>();
    let totalExtractedBytes = 0;
    let isSettled = false;

    const fail = (error: Error) => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      zipFile.close();
      reject(error);
    };

    zipFile.on('entry', (entry: Entry) => {
      if (isSettled) {
        return;
      }

      if (!entry.fileName.endsWith('.xml')) {
        zipFile.readEntry();
        return;
      }

      let normalizedXmlPath: string;
      try {
        assertRegularXmlEntry(entry);
        normalizedXmlPath = normalizeZipXmlPath(entry.fileName);
      } catch (error) {
        fail(toError(error));
        return;
      }

      if (normalizedDestinations.has(normalizedXmlPath)) {
        fail(new Error(`Duplicate normalized XML destination detected: ${normalizedXmlPath}`));
        return;
      }
      normalizedDestinations.add(normalizedXmlPath);

      if (entry.uncompressedSize > MAX_XML_ENTRY_BYTES) {
        fail(new Error(`XML entry exceeds size limit (${MAX_XML_ENTRY_BYTES} bytes): ${normalizedXmlPath}`));
        return;
      }

      if (totalExtractedBytes + entry.uncompressedSize > MAX_TOTAL_XML_BYTES) {
        fail(new Error(`XML extraction exceeds total byte cap (${MAX_TOTAL_XML_BYTES} bytes)`));
        return;
      }

      zipFile.openReadStream(entry, (streamError: Error | null, stream) => {
        if (streamError || !stream) {
          fail(streamError ?? new Error(`Failed to read ZIP entry: ${normalizedXmlPath}`));
          return;
        }

        const chunks: Buffer[] = [];
        let entryBytes = 0;

        stream.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          entryBytes += buffer.byteLength;

          if (entryBytes > MAX_XML_ENTRY_BYTES) {
            stream.destroy(new Error(`XML entry exceeds size limit (${MAX_XML_ENTRY_BYTES} bytes): ${normalizedXmlPath}`));
            return;
          }

          if (totalExtractedBytes + entryBytes > MAX_TOTAL_XML_BYTES) {
            stream.destroy(new Error(`XML extraction exceeds total byte cap (${MAX_TOTAL_XML_BYTES} bytes)`));
            return;
          }

          chunks.push(buffer);
        });

        stream.on('end', () => {
          totalExtractedBytes += entryBytes;
          entries.push({ xmlPath: normalizedXmlPath, xml: Buffer.concat(chunks).toString('utf8') });
          zipFile.readEntry();
        });

        stream.on('error', (error: Error) => {
          fail(error);
        });
      });
    });

    zipFile.once('end', () => {
      if (isSettled) {
        return;
      }
      isSettled = true;
      resolveEntries(entries.sort((a, b) => a.xmlPath.localeCompare(b.xmlPath)));
    });
    zipFile.once('error', (error) => fail(toError(error)));
    zipFile.readEntry();
  });
}

export async function getOrCreateZipPath(titleNumber: number, cacheRoot: string): Promise<string> {
  const fixturePath = process.env[`${FIXTURE_ENV_PREFIX}${padTitleNumber(titleNumber)}_FIXTURE_ZIP`];
  if (fixturePath) {
    return fixturePath;
  }

  const url = resolveTitleUrl(titleNumber);
  const titleDirectory = resolve(cacheRoot, 'olrc', `title-${padTitleNumber(titleNumber)}`);
  const zipFileName = basename(url);
  const zipPath = resolve(titleDirectory, zipFileName);

  const shouldTrustExistingCache = globalThis.fetch === nativeFetch;
  if (shouldTrustExistingCache) {
    const cacheValidation = await validateCachedZipArtifact({
      titleNumber,
      titleDirectory,
      zipPath,
      zipFileName,
      sourceUrl: url,
    });

    if (cacheValidation.ok) {
      return zipPath;
    }

    await deleteCacheArtifactSet(titleDirectory, zipPath);
  }

  await mkdir(titleDirectory, { recursive: true });

  let response: Response;
  try {
    response = await fetchWithRetry(url);
  } catch (error) {
    throw new Error(formatDownloadError(titleNumber, url, toError(error)));
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`failed to download title ${titleNumber} from ${url} (HTTP ${response.status})`);
  }

  const rawBuffer = Buffer.from(await response.arrayBuffer());
  const buffer = normalizeZipBuffer(rawBuffer);
  if (!isZipBuffer(buffer)) {
    throw new Error(`failed to download title ${titleNumber} from ${url} (non-ZIP payload)`);
  }

  if (!(await isReadableZipBuffer(buffer))) {
    throw new Error(`failed to download title ${titleNumber} from ${url} (unreadable ZIP payload)`);
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

interface CacheValidationInput {
  titleNumber: number;
  titleDirectory: string;
  zipPath: string;
  zipFileName: string;
  sourceUrl: string;
}

async function validateCachedZipArtifact(input: CacheValidationInput): Promise<{ ok: true } | { ok: false }> {
  const { titleNumber, titleDirectory, zipPath, zipFileName, sourceUrl } = input;
  const manifestPath = resolve(titleDirectory, 'manifest.json');
  const shaPath = `${zipPath}.sha256`;

  try {
    const fileStat = await stat(zipPath);
    if (fileStat.size <= 0) {
      return { ok: false };
    }

    const [buffer, manifestRaw, shaRaw] = await Promise.all([
      readFile(zipPath),
      readFile(manifestPath, 'utf8'),
      readFile(shaPath, 'utf8'),
    ]);

    if (!isZipBuffer(buffer) || !(await isReadableZipBuffer(buffer))) {
      return { ok: false };
    }

    const manifest = parseCacheManifest(manifestRaw);
    if (!manifest) {
      return { ok: false };
    }

    const computedSha = sha256(buffer);
    const sidecarSha = shaRaw.trim();
    if (!isSha256Hex(sidecarSha)) {
      return { ok: false };
    }

    const expectedCacheKey = `title-${padTitleNumber(titleNumber)}__${basename(sourceUrl, '.zip')}`;
    const manifestMatches = manifest.title === titleNumber
      && manifest.source_url === sourceUrl
      && manifest.cache_key === expectedCacheKey
      && manifest.zip_filename === zipFileName
      && manifest.bytes === fileStat.size
      && manifest.sha256 === computedSha
      && sidecarSha === computedSha;

    return manifestMatches ? { ok: true } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function parseCacheManifest(raw: string): {
  title: number;
  source_url: string;
  cache_key: string;
  zip_filename: string;
  sha256: string;
  bytes: number;
} | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.title !== 'number'
      || typeof parsed.source_url !== 'string'
      || typeof parsed.cache_key !== 'string'
      || typeof parsed.zip_filename !== 'string'
      || typeof parsed.sha256 !== 'string'
      || typeof parsed.bytes !== 'number') {
      return null;
    }

    return {
      title: parsed.title,
      source_url: parsed.source_url,
      cache_key: parsed.cache_key,
      zip_filename: parsed.zip_filename,
      sha256: parsed.sha256,
      bytes: parsed.bytes,
    };
  } catch {
    return null;
  }
}

function isSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

async function deleteCacheArtifactSet(titleDirectory: string, zipPath: string): Promise<void> {
  await Promise.all([
    rm(zipPath, { force: true }),
    rm(resolve(titleDirectory, 'manifest.json'), { force: true }),
    rm(`${zipPath}.sha256`, { force: true }),
  ]);
}

async function fetchWithRetry(url: string): Promise<Response> {
  let attempt = 0;

  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`Request timed out after ${DOWNLOAD_TIMEOUT_MS}ms`)), DOWNLOAD_TIMEOUT_MS);

    try {
      return await fetch(url, { signal: controller.signal });
    } catch (error) {
      const normalizedError = toError(error);
      if (attempt >= DOWNLOAD_RETRY_COUNT || !isTransientDownloadError(normalizedError)) {
        throw normalizedError;
      }
      attempt += 1;
    } finally {
      clearTimeout(timeout);
    }
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
  const localFileHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const signatureIndex = isZipBuffer(buffer) ? 0 : buffer.indexOf(localFileHeader);
  const normalizedStart = signatureIndex >= 0 ? buffer.subarray(signatureIndex) : buffer;

  const endOfCentralDirectory = findEndOfCentralDirectory(normalizedStart);
  return endOfCentralDirectory === null ? normalizedStart : normalizedStart.subarray(0, endOfCentralDirectory);
}

function findEndOfCentralDirectory(buffer: Buffer): number | null {
  const minRecordLength = 22;
  if (buffer.length < minRecordLength) {
    return null;
  }

  const maxCommentLength = 0xffff;
  const searchStart = Math.max(0, buffer.length - (minRecordLength + maxCommentLength));
  const signature = 0x06054b50;

  for (let index = buffer.length - minRecordLength; index >= searchStart; index -= 1) {
    if (buffer.readUInt32LE(index) !== signature) {
      continue;
    }

    const commentLength = buffer.readUInt16LE(index + 20);
    const recordEnd = index + minRecordLength + commentLength;
    if (recordEnd <= buffer.length) {
      return recordEnd;
    }
  }

  return null;
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function normalizeZipXmlPath(fileName: string): string {
  if (fileName.includes('\\')) {
    throw new Error(`Unsafe XML entry path: ${fileName}`);
  }

  const normalizedPath = normalize(fileName).replace(/^\.\//, '');
  if (normalizedPath.length === 0 || normalizedPath.startsWith('/') || normalizedPath.startsWith('..') || normalizedPath.includes('/../') || /^[a-zA-Z]:/.test(normalizedPath)) {
    throw new Error(`Unsafe XML entry path: ${fileName}`);
  }

  const segments = normalizedPath.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe XML entry path: ${fileName}`);
  }

  return segments.join('/');
}

function assertRegularXmlEntry(entry: Entry): void {
  if (entry.fileName.endsWith('/')) {
    throw new Error(`Non-regular XML entry is not allowed: ${entry.fileName}`);
  }

  const unixMode = (entry.externalFileAttributes >>> 16) & 0o170000;
  if (unixMode !== 0 && unixMode !== 0o100000) {
    throw new Error(`Non-regular XML entry is not allowed: ${entry.fileName}`);
  }
}

function isTransientDownloadError(error: Error): boolean {
  const errorWithCode = error as NodeJS.ErrnoException;
  if (error.name === 'AbortError') {
    return true;
  }

  if (errorWithCode.code === 'ETIMEDOUT' || errorWithCode.code === 'ECONNRESET') {
    return true;
  }

  return /timed out|timeout|socket hang up|connection reset/i.test(error.message);
}

function formatDownloadError(titleNumber: number, url: string, error: Error): string {
  return `failed to download title ${titleNumber} from ${url} (${error.message})`;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function isReadableZipBuffer(buffer: Buffer): Promise<boolean> {
  try {
    const zipFile = await openZipFromBuffer(buffer);
    zipFile.close();
    return true;
  } catch {
    return false;
  }
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

export interface OlrcFetchResult {
  source: 'olrc';
  ok: boolean;
  requested_scope: { titles: string };
  counts?: { titles_downloaded: number };
  error?: { code: string; message: string };
}

export async function fetchOlrcSource(invocation?: { force?: boolean }): Promise<OlrcFetchResult> {
  try {
    const { cacheDirectory } = getCachePaths('olrc');
    let titlesDownloaded = 0;

    for (let titleNumber = 1; titleNumber <= 54; titleNumber += 1) {
      const zipPath = await getTitleZipPath(titleNumber, cacheDirectory);
      await extractXmlEntriesFromZip(zipPath);
      titlesDownloaded += 1;
    }

    const manifest = await readManifest();
    manifest.sources.olrc = {
      last_success_at: new Date().toISOString(),
      last_failure: null,
    };
    await writeManifest(manifest);

    return {
      source: 'olrc',
      ok: true,
      requested_scope: { titles: '1..54' },
      counts: { titles_downloaded: titlesDownloaded },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OLRC fetch failed';
    const manifest = await readManifest();
    manifest.sources.olrc = {
      last_success_at: manifest.sources.olrc.last_success_at,
      last_failure: { code: 'upstream_request_failed', message },
    };
    await writeManifest(manifest);

    return {
      source: 'olrc',
      ok: false,
      requested_scope: { titles: '1..54' },
      error: {
        code: 'upstream_request_failed',
        message,
      },
    };
  }
}
