import { createHash } from 'node:crypto';
import { readFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import yauzl from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';
import type { XmlEntry } from '../domain/model.js';
import { padTitleNumber } from '../domain/normalize.js';
import { getCachePaths } from '../utils/cache.js';
import { readManifest, writeManifest } from '../utils/manifest.js';
import type { DownloadedFileManifestEntry, OlrcTitleReservedEmptyState, OlrcTitleState } from '../utils/manifest.js';
import { logNetworkEvent } from '../utils/logger.js';

const DOWNLOAD_TIMEOUT_MS = 500;
const DOWNLOAD_RETRY_COUNT = 1;
const MAX_XML_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_LARGE_TITLE_XML_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_TOTAL_XML_BYTES = 256 * 1024 * 1024;
const OLRC_HOME_URL = 'https://uscode.house.gov/';
const OLRC_LISTING_URL = 'https://uscode.house.gov/download/download.shtml';
const OLRC_LEGACY_LISTING_URL = 'https://uscode.house.gov/download/annualtitlefiles.shtml';
const FIXTURE_ENV_PREFIX = 'US_CODE_TOOLS_TITLE_';
const RESERVED_EMPTY_TITLE = 53;
const TITLE_RANGE = { start: 1, end: 54 };

export interface OlrcFetchResult {
  source: 'olrc';
  ok: boolean;
  requested_scope: { titles: string };
  counts?: { titles_downloaded: number };
  selected_vintage?: string;
  missing_titles?: number[];
  reserved_empty_titles?: Array<{ title: number; status: 'reserved_empty'; classification_reason: OlrcTitleReservedEmptyState['classification_reason'] }>;
  error?: { code: string; message: string };
}

export async function getTitleZipPath(titleNumber: number, cacheRoot: string): Promise<string> {
  const url = resolveTitleUrl(titleNumber, '118-200');
  const titleDirectory = resolve(cacheRoot, 'olrc', `title-${padTitleNumber(titleNumber)}`);
  return getOrCreateZipPath({
    titleNumber,
    url,
    titleDirectory,
    force: false,
    requestContext: createOlrcRequestContext(),
    bootstrapCookies: false,
  });
}

interface OlrcVintagePlan {
  selectedVintage: string;
  titleUrls: Map<number, string>;
  missingTitles: number[];
  listingUrl: string;
  toJSON(): { selectedVintage: string; titleUrls: Record<string, string>; missingTitles: number[]; listingUrl: string };
}

interface OlrcRequestContext {
  cookieHeader: string | null;
  hasBootstrapped: boolean;
}

interface ReservedEmptyClassification {
  classification_reason: OlrcTitleReservedEmptyState['classification_reason'];
}

export function resolveTitleUrl(titleNumber: number, selectedVintage = '118-200'): string {
  const [congress, version] = selectedVintage.split('-');
  if (congress && version) {
    return `https://uscode.house.gov/download/releasepoints/us/pl/${congress}/${version}/xml_usc${padTitleNumber(titleNumber)}@${selectedVintage}.zip`;
  }
  return `https://uscode.house.gov/download/releasepoints/us/pl/${selectedVintage}/xml_usc${padTitleNumber(titleNumber)}@${selectedVintage}.zip`;
}

export async function fetchOlrcSource(invocation?: { force?: boolean; cacheRoot?: string }): Promise<OlrcFetchResult> {
  const force = invocation?.force ?? false;
  const sourceDirectory = invocation?.cacheRoot ?? getCachePaths('olrc').sourceDirectory;
  await mkdir(sourceDirectory, { recursive: true });

  const requestContext = createOlrcRequestContext();

  let plan: OlrcVintagePlan;
  try {
    plan = await fetchOlrcVintagePlan(requestContext, 'current');
  } catch (error) {
    return await recordOlrcFailure('upstream_request_failed', error instanceof Error ? error.message : 'OLRC fetch failed');
  }

  const manifest = await readManifest();
  manifest.sources.olrc.selected_vintage = plan.selectedVintage;
  const titlesState: Record<string, OlrcTitleState> = { ...manifest.sources.olrc.titles };

  let titlesDownloaded = 0;
  try {
    for (const [titleNumber, url] of plan.titleUrls) {
      const titleDirectory = resolve(sourceDirectory, 'vintages', plan.selectedVintage, `title-${padTitleNumber(titleNumber)}`);

      try {
        const zipPath = await getOrCreateZipPath({
          titleNumber,
          url,
          titleDirectory,
          force,
          requestContext,
          bootstrapCookies: plan.listingUrl === OLRC_LISTING_URL,
        });
        const xmlEntries = await extractXmlEntriesFromZip(zipPath);

        const reservedEmpty = classifyReservedEmptyXmlEntries(titleNumber, xmlEntries);
        if (reservedEmpty) {
          await removeTitleDirectoryIfPresent(titleDirectory);
          applyReservedEmptyState(titlesState, titleNumber, plan.selectedVintage, url, reservedEmpty.classification_reason);
          continue;
        }

        const extractionDirectory = resolve(titleDirectory, 'extracted');
        await mkdir(extractionDirectory, { recursive: true });

        const fetchedAt = new Date().toISOString();
        const extractedArtifacts: DownloadedFileManifestEntry[] = [];
        for (const entry of xmlEntries) {
          const outputPath = resolve(extractionDirectory, entry.xmlPath);
          await mkdir(resolve(outputPath, '..'), { recursive: true });
          await writeFile(outputPath, entry.xml, { encoding: 'utf8', mode: 0o640 });
          extractedArtifacts.push({
            path: outputPath,
            byte_count: Buffer.byteLength(entry.xml, 'utf8'),
            checksum_sha256: sha256(Buffer.from(entry.xml, 'utf8')),
            fetched_at: fetchedAt,
          });
        }

        const zipBytes = await readFile(zipPath);
        titlesState[String(titleNumber)] = {
          title: titleNumber,
          vintage: plan.selectedVintage,
          status: 'downloaded',
          zip_path: zipPath,
          extraction_path: extractionDirectory,
          byte_count: zipBytes.byteLength,
          fetched_at: fetchedAt,
          extracted_xml_artifacts: extractedArtifacts,
        };
        titlesDownloaded += 1;
      } catch (error) {
        const classification = classifyReservedEmptyError(titleNumber, error);
        if (classification) {
          await removeTitleDirectoryIfPresent(titleDirectory);
          applyReservedEmptyState(titlesState, titleNumber, plan.selectedVintage, url, classification.classification_reason);
          continue;
        }

        throw error;
      }
    }

    manifest.sources.olrc.titles = titlesState;
    manifest.sources.olrc.last_success_at = new Date().toISOString();

    const reservedEmptyTitles = summarizeReservedEmptyTitles(titlesState);
    if (plan.listingUrl === OLRC_LEGACY_LISTING_URL && plan.missingTitles.length > 0) {
      manifest.sources.olrc.last_failure = {
        code: 'missing_from_vintage',
        message: `Selected OLRC vintage ${plan.selectedVintage} is missing titles: ${plan.missingTitles.join(', ')}`,
      };
      await writeManifest(manifest);
      return {
        source: 'olrc',
        ok: false,
        requested_scope: { titles: '1..54' },
        selected_vintage: plan.selectedVintage,
        counts: { titles_downloaded: titlesDownloaded },
        missing_titles: plan.missingTitles,
        reserved_empty_titles: reservedEmptyTitles,
        error: manifest.sources.olrc.last_failure,
      };
    }

    manifest.sources.olrc.last_failure = null;
    await writeManifest(manifest);

    return {
      source: 'olrc',
      ok: true,
      requested_scope: { titles: '1..54' },
      selected_vintage: plan.selectedVintage,
      counts: { titles_downloaded: titlesDownloaded },
      missing_titles: plan.missingTitles,
      reserved_empty_titles: reservedEmptyTitles,
    };
  } catch (error) {
    manifest.sources.olrc.titles = titlesState;
    manifest.sources.olrc.last_failure = {
      code: 'upstream_request_failed',
      message: error instanceof Error ? error.message : 'OLRC fetch failed',
    };
    await writeManifest(manifest);
    return {
      source: 'olrc',
      ok: false,
      requested_scope: { titles: '1..54' },
      selected_vintage: plan.selectedVintage,
      counts: { titles_downloaded: titlesDownloaded },
      missing_titles: plan.missingTitles,
      reserved_empty_titles: summarizeReservedEmptyTitles(titlesState),
      error: manifest.sources.olrc.last_failure,
    };
  }
}

export async function fetchOlrcVintagePlan(
  requestContext: OlrcRequestContext = createOlrcRequestContext(),
  preferredListing: 'current' | 'legacy' = 'current',
): Promise<OlrcVintagePlan> {
  const listing = await fetchPreferredOlrcListing(requestContext, preferredListing);
  const html = await listing.response.text();
  const byVintage = new Map<string, Map<number, string>>();

  for (const link of extractReleasepointLinks(html, listing.listingUrl)) {
    const titles = byVintage.get(link.vintage) ?? new Map<number, string>();
    if (!titles.has(link.title)) {
      titles.set(link.title, link.url);
    }
    byVintage.set(link.vintage, titles);
  }

  if (byVintage.size === 0) {
    throw new Error('OLRC listing did not expose any releasepoint title ZIP links');
  }

  const selectedVintage = [...byVintage.keys()].sort(compareVintageDescending)[0] ?? '';
  const titleUrls = byVintage.get(selectedVintage) ?? new Map<number, string>();
  const missingTitles: number[] = [];
  for (let title = TITLE_RANGE.start; title <= TITLE_RANGE.end; title += 1) {
    if (title !== RESERVED_EMPTY_TITLE && !titleUrls.has(title)) {
      missingTitles.push(title);
    }
  }

  return {
    selectedVintage,
    titleUrls,
    missingTitles,
    listingUrl: listing.listingUrl,
    toJSON() {
      return {
        selectedVintage,
        titleUrls: Object.fromEntries(titleUrls),
        missingTitles,
        listingUrl: listing.listingUrl,
      };
    },
  };
}

async function fetchPreferredOlrcListing(
  requestContext: OlrcRequestContext,
  preferredListing: 'current' | 'legacy',
): Promise<{ response: Response; listingUrl: string }> {
  if (preferredListing === 'current') {
    return {
      response: await fetchWithRetry(OLRC_LISTING_URL, requestContext, true),
      listingUrl: OLRC_LISTING_URL,
    };
  }

  try {
    return {
      response: await fetchWithRetry(OLRC_LEGACY_LISTING_URL, requestContext, false),
      listingUrl: OLRC_LEGACY_LISTING_URL,
    };
  } catch {
    return {
      response: await fetchWithRetry(OLRC_LISTING_URL, requestContext, true),
      listingUrl: OLRC_LISTING_URL,
    };
  }
}

function extractReleasepointLinks(html: string, baseUrl: string): Array<{ title: number; vintage: string; url: string }> {
  const matches = [...html.matchAll(/href\s*=\s*"([^"]+)"/gi)];
  const links: Array<{ title: number; vintage: string; url: string }> = [];

  for (const match of matches) {
    const href = match[1];
    if (!href) {
      continue;
    }

    const absoluteUrl = href.startsWith('http') ? href : new URL(href, baseUrl).toString();
    const parsed = absoluteUrl.match(/\/releasepoints\/us\/pl\/(?:\d+\/\d+\/|\d+\/)?xml_usc(\d{2})@(\d+(?:-\d+)?)\.zip$/i);
    if (!parsed) {
      continue;
    }

    const title = Number.parseInt(parsed[1] ?? '', 10);
    const vintage = parsed[2] ?? '';
    if (!Number.isInteger(title) || title < TITLE_RANGE.start || title > TITLE_RANGE.end || vintage.length === 0) {
      continue;
    }

    links.push({ title, vintage, url: absoluteUrl });
  }

  return links;
}

async function getOrCreateZipPath(args: {
  titleNumber: number;
  url: string;
  titleDirectory: string;
  force: boolean;
  requestContext: OlrcRequestContext;
  bootstrapCookies?: boolean;
}): Promise<string> {
  const fixturePath = process.env[`${FIXTURE_ENV_PREFIX}${padTitleNumber(args.titleNumber)}_FIXTURE_ZIP`];
  if (fixturePath) {
    return fixturePath;
  }

  const zipPath = resolve(args.titleDirectory, basename(args.url));
  if (!args.force) {
    const cacheStatus = await validateCachedZip({ titleNumber: args.titleNumber, titleDirectory: args.titleDirectory, zipPath, url: args.url });
    if (cacheStatus === 'valid') {
      return zipPath;
    }
  }

  await mkdir(args.titleDirectory, { recursive: true });
  try {
    const response = await fetchWithRetry(args.url, args.requestContext, args.bootstrapCookies ?? false);
    const isOk = response.ok ?? (response.status >= 200 && response.status < 300);
    if (!isOk) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type');
    const reservedEmpty = classifyReservedEmptyPayload(args.titleNumber, buffer, contentType);
    if (reservedEmpty) {
      throw new Error(`reserved_empty:${reservedEmpty.classification_reason}`);
    }

    const normalizedBuffer = normalizeZipBuffer(buffer);
    const emptyZip = await isZipEmpty(normalizedBuffer);
    if (emptyZip) {
      throw new Error('reserved_empty:empty_zip');
    }

    await assertZipReadable(normalizedBuffer, args.titleNumber, args.url);
    const tempPath = `${zipPath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tempPath, normalizedBuffer, { mode: 0o640 });
    await rename(tempPath, zipPath);
    await writeLegacyMetadataIfNeeded(args.titleNumber, args.titleDirectory, zipPath, args.url, normalizedBuffer);
    return zipPath;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to download title ${args.titleNumber} from ${args.url} (${message})`);
  }
}

async function recordOlrcFailure(code: string, message: string): Promise<OlrcFetchResult> {
  const manifest = await readManifest();
  manifest.sources.olrc.last_failure = { code, message };
  await writeManifest(manifest);
  return {
    source: 'olrc',
    ok: false,
    requested_scope: { titles: '1..54' },
    error: { code, message },
  };
}

function compareVintageDescending(left: string, right: string): number {
  const leftParts = left.split(/[-_.]/).map((part) => Number.parseInt(part, 10)).filter(Number.isFinite);
  const rightParts = right.split(/[-_.]/).map((part) => Number.parseInt(part, 10)).filter(Number.isFinite);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return right.localeCompare(left);
}

async function validateCachedZip(args: { titleNumber: number; titleDirectory: string; zipPath: string; url: string }): Promise<'valid' | 'invalid'> {
  try {
    const fs = await import('node:fs/promises');
    await fs.access(args.zipPath);
    const buffer = await fs.readFile(args.zipPath);
    await assertZipReadable(buffer, args.titleNumber, args.url);

    if (!isLegacyTitleDirectory(args.titleDirectory)) {
      return 'valid';
    }

    const shaPath = `${args.zipPath}.sha256`;
    const manifestPath = resolve(args.titleDirectory, 'manifest.json');
    await fs.access(shaPath);
    await fs.access(manifestPath);

    const expectedSha = sha256(buffer);
    const shaBody = (await fs.readFile(shaPath, 'utf8')).trim();
    if (shaBody !== expectedSha) {
      return 'invalid';
    }

    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    if (manifest.sha256 !== expectedSha || manifest.zip_filename !== basename(args.zipPath) || manifest.source_url !== args.url) {
      return 'invalid';
    }

    return 'valid';
  } catch {
    return 'invalid';
  }
}

async function writeLegacyMetadataIfNeeded(titleNumber: number, titleDirectory: string, zipPath: string, url: string, buffer: Buffer): Promise<void> {
  if (!isLegacyTitleDirectory(titleDirectory)) {
    return;
  }

  const checksum = sha256(buffer);
  await writeFile(`${zipPath}.sha256`, `${checksum}\n`, { encoding: 'utf8', mode: 0o640 });
  await writeFile(resolve(titleDirectory, 'manifest.json'), JSON.stringify({
    title: titleNumber,
    source_url: url,
    cache_key: `title-${padTitleNumber(titleNumber)}__${basename(zipPath, '.zip')}`,
    zip_filename: basename(zipPath),
    sha256: checksum,
    bytes: buffer.byteLength,
    downloaded_at: new Date().toISOString(),
    content_type: 'application/zip',
  }, null, 2), { encoding: 'utf8', mode: 0o640 });
}

function isLegacyTitleDirectory(titleDirectory: string): boolean {
  return basename(resolve(titleDirectory, '..')) === 'olrc';
}

function normalizeZipBuffer(buffer: Buffer): Buffer {
  const start = buffer.indexOf('PK\x03\x04');
  const endOfCentralDirectory = buffer.lastIndexOf('PK\x05\x06');
  if (start === -1 || endOfCentralDirectory === -1 || endOfCentralDirectory + 22 > buffer.length) {
    return buffer;
  }

  const commentLength = buffer.readUInt16LE(endOfCentralDirectory + 20);
  const archiveEnd = endOfCentralDirectory + 22 + commentLength;
  if (archiveEnd > buffer.length || archiveEnd <= start) {
    return buffer;
  }

  return buffer.subarray(start, archiveEnd);
}

async function assertZipReadable(buffer: Buffer, titleNumber: number, url: string): Promise<void> {
  try {
    const zipFile = await openZipFromBuffer(buffer);
    zipFile.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ZIP archive is unreadable';
    throw new Error(`invalid ZIP archive for title ${titleNumber} from ${url}: ${message}`);
  }
}

function createOlrcRequestContext(): OlrcRequestContext {
  return {
    cookieHeader: null,
    hasBootstrapped: false,
  };
}

async function fetchWithRetry(url: string, requestContext: OlrcRequestContext, bootstrapCookies: boolean): Promise<Response> {
  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    const startedAt = Date.now();
    try {
      const response = await fetchWithOlrcCookies(url, requestContext, controller.signal, bootstrapCookies);
      logNetworkEvent({ level: 'info', event: 'network.request', source: 'olrc', method: 'GET', url, attempt: attempt + 1, cache_status: 'miss', duration_ms: Date.now() - startedAt, status_code: response.status });
      return response;
    } catch (error) {
      const normalizedError = toError(error);
      logNetworkEvent({ level: 'error', event: 'network.request', source: 'olrc', method: 'GET', url, attempt: attempt + 1, cache_status: 'miss', duration_ms: Date.now() - startedAt });
      if (attempt >= DOWNLOAD_RETRY_COUNT || !isTransientDownloadError(normalizedError)) {
        throw new Error(`failed to download from ${url}: ${normalizedError.message}`);
      }
      attempt += 1;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function fetchWithOlrcCookies(url: string, requestContext: OlrcRequestContext, signal: AbortSignal, bootstrapCookies: boolean): Promise<Response> {
  if (bootstrapCookies && !requestContext.hasBootstrapped && url !== OLRC_HOME_URL) {
    await bootstrapOlrcSession(requestContext, signal);
  }

  const headers = new Headers();
  if (requestContext.cookieHeader) {
    headers.set('Cookie', requestContext.cookieHeader);
  }

  return fetch(url, { signal, headers });
}

async function bootstrapOlrcSession(requestContext: OlrcRequestContext, signal: AbortSignal): Promise<void> {
  requestContext.hasBootstrapped = true;
  const response = await fetch(OLRC_HOME_URL, { signal });
  const cookieHeader = extractCookieHeader(response.headers);
  if (cookieHeader) {
    requestContext.cookieHeader = cookieHeader;
  }
}

function extractCookieHeader(headers: Headers): string | null {
  const rawSetCookie = headers.get('set-cookie');
  if (!rawSetCookie) {
    return null;
  }

  const cookiePairs = rawSetCookie
    .split(/,(?=[^;,]+=)/)
    .map((entry) => entry.trim().split(';')[0]?.trim())
    .filter((entry): entry is string => Boolean(entry && entry.includes('=')));

  return cookiePairs.length > 0 ? cookiePairs.join('; ') : null;
}

export async function extractXmlEntriesFromZip(input: string | Buffer): Promise<XmlEntry[]> {
  const zipFile = await (Buffer.isBuffer(input) ? openZipFromBuffer(input) : openZipFromPath(input));
  return new Promise<XmlEntry[]>((resolveEntries, reject) => {
    const entries: XmlEntry[] = [];
    const normalizedDestinations = new Set<string>();
    let totalExtractedBytes = 0;
    let isSettled = false;
    const fail = (error: Error) => {
      if (isSettled) return;
      isSettled = true;
      zipFile.close();
      reject(error);
    };
    zipFile.on('entry', (entry: Entry) => {
      if (isSettled) return;
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
      const maxEntryBytes = isLargeTitleXmlPath(normalizedXmlPath) ? MAX_LARGE_TITLE_XML_ENTRY_BYTES : MAX_XML_ENTRY_BYTES;
      if (entry.uncompressedSize > maxEntryBytes || totalExtractedBytes + entry.uncompressedSize > MAX_TOTAL_XML_BYTES) {
        fail(new Error(`XML extraction exceeds size limits for ${normalizedXmlPath}`));
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
          chunks.push(buffer);
        });
        stream.on('end', () => {
          totalExtractedBytes += entryBytes;
          entries.push({ xmlPath: normalizedXmlPath, xml: Buffer.concat(chunks).toString('utf8') });
          zipFile.readEntry();
        });
        stream.on('error', fail);
      });
    });
    zipFile.once('end', () => {
      if (isSettled) return;
      isSettled = true;
      resolveEntries(entries.sort((a, b) => a.xmlPath.localeCompare(b.xmlPath)));
    });
    zipFile.once('error', (error) => fail(toError(error)));
    zipFile.readEntry();
  });
}

function isLargeTitleXmlPath(xmlPath: string): boolean {
  return /(?:^|\/)(?:xml_)?usc\d{2}(?:[a-z])?\.xml$/i.test(xmlPath);
}

function normalizeZipXmlPath(fileName: string): string {
  const normalizedPath = fileName.replace(/^\.\//, '');
  if (fileName.includes('..') || fileName.includes('\\') || normalizedPath.startsWith('/')) {
    throw new Error(`Unsafe XML entry path: ${fileName}`);
  }
  return normalizedPath;
}

function assertRegularXmlEntry(entry: Entry): void {
  if (entry.fileName.endsWith('/')) {
    throw new Error(`Non-regular XML entry is not allowed: ${entry.fileName}`);
  }

  const unixMode = entry.externalFileAttributes >>> 16;
  const fileType = unixMode & 0o170000;
  if (fileType !== 0 && fileType !== 0o100000) {
    throw new Error(`Non-regular XML entry is not allowed: ${entry.fileName}`);
  }
}

async function isZipEmpty(buffer: Buffer): Promise<boolean> {
  const zipFile = await openZipFromBuffer(buffer);
  return new Promise<boolean>((resolveEmpty, reject) => {
    let hasEntries = false;
    zipFile.on('entry', () => {
      hasEntries = true;
      zipFile.close();
      resolveEmpty(false);
    });
    zipFile.once('end', () => resolveEmpty(!hasEntries));
    zipFile.once('error', (error) => reject(toError(error)));
    zipFile.readEntry();
  });
}

function classifyReservedEmptyPayload(titleNumber: number, buffer: Buffer, contentType: string | null): ReservedEmptyClassification | null {
  if (titleNumber !== RESERVED_EMPTY_TITLE) {
    return null;
  }

  if (buffer.byteLength === 0) {
    return { classification_reason: 'empty_zip' };
  }

  if (contentType && /html/i.test(contentType)) {
    return { classification_reason: 'html_payload' };
  }

  const trimmedPrefix = buffer.subarray(0, Math.min(buffer.length, 128)).toString('utf8').trimStart();
  if (trimmedPrefix.startsWith('<!DOCTYPE html') || trimmedPrefix.startsWith('<html')) {
    return { classification_reason: 'html_payload' };
  }

  return null;
}

function classifyReservedEmptyError(titleNumber: number, error: unknown): ReservedEmptyClassification | null {
  if (titleNumber !== RESERVED_EMPTY_TITLE) {
    return null;
  }

  const message = error instanceof Error ? error.message : String(error);
  const reservedMatch = message.match(/reserved_empty:([a-z_]+)/i);
  if (reservedMatch) {
    const classificationReason = reservedMatch[1];
    if (
      classificationReason === 'html_payload'
      || classificationReason === 'not_zip'
      || classificationReason === 'empty_zip'
      || classificationReason === 'no_xml_entries'
    ) {
      return { classification_reason: classificationReason };
    }
  }

  if (/invalid ZIP archive/i.test(message)) {
    return { classification_reason: 'not_zip' };
  }

  if (/no XML entries/i.test(message)) {
    return { classification_reason: 'no_xml_entries' };
  }

  return null;
}

function classifyReservedEmptyXmlEntries(titleNumber: number, xmlEntries: XmlEntry[]): ReservedEmptyClassification | null {
  if (titleNumber === RESERVED_EMPTY_TITLE && xmlEntries.length === 0) {
    return { classification_reason: 'no_xml_entries' };
  }

  return null;
}

async function removeTitleDirectoryIfPresent(titleDirectory: string): Promise<void> {
  await rm(titleDirectory, { recursive: true, force: true });
}

function applyReservedEmptyState(
  titlesState: Record<string, OlrcTitleState>,
  titleNumber: number,
  vintage: string,
  sourceUrl: string,
  classificationReason: OlrcTitleReservedEmptyState['classification_reason'],
): void {
  titlesState[String(titleNumber)] = {
    title: titleNumber,
    vintage,
    status: 'reserved_empty',
    skipped_at: new Date().toISOString(),
    source_url: sourceUrl,
    classification_reason: classificationReason,
  };
}

function summarizeReservedEmptyTitles(titlesState: Record<string, OlrcTitleState>): NonNullable<OlrcFetchResult['reserved_empty_titles']> {
  return Object.values(titlesState)
    .filter((titleState): titleState is OlrcTitleReservedEmptyState => titleState.status === 'reserved_empty')
    .map((titleState) => ({
      title: titleState.title,
      status: 'reserved_empty' as const,
      classification_reason: titleState.classification_reason,
    }))
    .sort((left, right) => left.title - right.title);
}

function isTransientDownloadError(error: Error): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return error.name === 'AbortError' || code === 'ETIMEDOUT' || code === 'ECONNRESET' || /timed out|timeout|socket hang up|connection reset/i.test(error.message);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
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
