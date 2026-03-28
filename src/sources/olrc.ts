import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import yauzl from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';
import type { XmlEntry } from '../domain/model.js';
import { padTitleNumber } from '../domain/normalize.js';
import { getCachePaths } from '../utils/cache.js';
import { readManifest, writeManifest } from '../utils/manifest.js';

const DOWNLOAD_TIMEOUT_MS = 30_000;
const DOWNLOAD_RETRY_COUNT = 1;
const MAX_XML_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_XML_BYTES = 256 * 1024 * 1024;
const OLRC_LISTING_URL = 'https://uscode.house.gov/download/annualtitlefiles.shtml';
const nativeFetch = globalThis.fetch;
const FIXTURE_ENV_PREFIX = 'US_CODE_TOOLS_TITLE_';

export interface OlrcFetchResult {
  source: 'olrc';
  ok: boolean;
  requested_scope: { titles: string };
  counts?: { titles_downloaded: number };
  selected_vintage?: string;
  missing_titles?: number[];
  error?: { code: string; message: string };
}


export async function getTitleZipPath(titleNumber: number, cacheRoot: string): Promise<string> {
  const plan = await fetchOlrcVintagePlan();
  const url = plan.titleUrls.get(titleNumber);
  if (!url) {
    throw new Error(`failed to download title ${titleNumber} from ${OLRC_LISTING_URL} (missing from selected vintage ${plan.selectedVintage})`);
  }
  const titleDirectory = resolve(cacheRoot, 'olrc', 'vintages', plan.selectedVintage, `title-${padTitleNumber(titleNumber)}`);
  return getOrCreateZipPath({ titleNumber, url, titleDirectory, force: false });
}
interface OlrcVintagePlan {
  selectedVintage: string;
  titleUrls: Map<number, string>;
  missingTitles: number[];
}

export function resolveTitleUrl(titleNumber: number, selectedVintage = '118-200'): string {
  return `https://uscode.house.gov/download/releasepoints/us/pl/${selectedVintage}/xml_usc${padTitleNumber(titleNumber)}@${selectedVintage}.zip`;
}

export async function fetchOlrcSource(invocation?: { force?: boolean }): Promise<OlrcFetchResult> {
  const force = invocation?.force ?? false;
  const { sourceDirectory } = getCachePaths('olrc');
  await mkdir(sourceDirectory, { recursive: true });

  let plan: OlrcVintagePlan;
  try {
    plan = await fetchOlrcVintagePlan();
  } catch (error) {
    return await recordOlrcFailure('upstream_request_failed', error instanceof Error ? error.message : 'OLRC fetch failed');
  }

  const manifest = await readManifest();
  manifest.sources.olrc.selected_vintage = plan.selectedVintage;
  const titlesState = isRecord(manifest.sources.olrc.titles) ? manifest.sources.olrc.titles : {};

  if (plan.missingTitles.length > 0) {
    for (const title of plan.missingTitles) {
      delete titlesState[String(title)];
    }
  }

  let titlesDownloaded = 0;
  try {
    for (const [titleNumber, url] of plan.titleUrls) {
      const titleDirectory = resolve(sourceDirectory, 'vintages', plan.selectedVintage, `title-${padTitleNumber(titleNumber)}`);
      const zipPath = await getOrCreateZipPath({ titleNumber, url, titleDirectory, force });
      const xmlEntries = await extractXmlEntriesFromZip(zipPath);
      const extractionDirectory = resolve(titleDirectory, 'extracted');
      await mkdir(extractionDirectory, { recursive: true });

      const extractedArtifacts: Array<{ path: string; byte_count: number; checksum_sha256: string; fetched_at: string }> = [];
      for (const entry of xmlEntries) {
        const outputPath = resolve(extractionDirectory, entry.xmlPath);
        await mkdir(resolve(outputPath, '..'), { recursive: true });
        await writeFile(outputPath, entry.xml, { encoding: 'utf8', mode: 0o640 });
        extractedArtifacts.push({
          path: outputPath,
          byte_count: Buffer.byteLength(entry.xml, 'utf8'),
          checksum_sha256: sha256(Buffer.from(entry.xml, 'utf8')),
          fetched_at: new Date().toISOString(),
        });
      }

      const zipBytes = await (await import('node:fs/promises')).readFile(zipPath);
      titlesState[String(titleNumber)] = {
        title: titleNumber,
        vintage: plan.selectedVintage,
        zip_path: zipPath,
        extraction_path: extractionDirectory,
        byte_count: zipBytes.byteLength,
        fetched_at: new Date().toISOString(),
        extracted_xml_artifacts: extractedArtifacts,
      };
      titlesDownloaded += 1;
    }

    manifest.sources.olrc.titles = titlesState;
    manifest.sources.olrc.last_success_at = new Date().toISOString();
    manifest.sources.olrc.last_failure = null;

    if (plan.missingTitles.length > 0) {
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
        missing_titles: plan.missingTitles,
        counts: { titles_downloaded: titlesDownloaded },
        error: manifest.sources.olrc.last_failure,
      };
    }

    await writeManifest(manifest);
    return {
      source: 'olrc',
      ok: true,
      requested_scope: { titles: '1..54' },
      selected_vintage: plan.selectedVintage,
      counts: { titles_downloaded: titlesDownloaded },
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
      error: manifest.sources.olrc.last_failure,
    };
  }
}

async function fetchOlrcVintagePlan(): Promise<OlrcVintagePlan> {
  const response = await fetchWithRetry(OLRC_LISTING_URL);
  const html = await response.text();
  const matches = [...html.matchAll(/href="([^"]*xml_usc(\d{2})@([^"/]+)\.zip)"/gi)];
  const byVintage = new Map<string, Map<number, string>>();

  for (const match of matches) {
    const url = match[1];
    const title = Number.parseInt(match[2] ?? '', 10);
    const vintage = match[3] ?? '';
    if (!Number.isInteger(title) || title < 1 || title > 54 || vintage.length === 0) {
      continue;
    }
    const absoluteUrl = url.startsWith('http') ? url : new URL(url, OLRC_LISTING_URL).toString();
    const titles = byVintage.get(vintage) ?? new Map<number, string>();
    if (!titles.has(title)) {
      titles.set(title, absoluteUrl);
    }
    byVintage.set(vintage, titles);
  }

  if (byVintage.size === 0) {
    throw new Error('OLRC listing did not expose any annual title ZIP links');
  }

  const selectedVintage = [...byVintage.keys()].sort(compareVintageDescending)[0] ?? '';
  const titleUrls = byVintage.get(selectedVintage) ?? new Map<number, string>();
  const missingTitles: number[] = [];
  for (let title = 1; title <= 54; title += 1) {
    if (!titleUrls.has(title)) {
      missingTitles.push(title);
    }
  }

  return { selectedVintage, titleUrls, missingTitles };
}

async function getOrCreateZipPath(args: { titleNumber: number; url: string; titleDirectory: string; force: boolean }): Promise<string> {
  const fixturePath = process.env[`${FIXTURE_ENV_PREFIX}${padTitleNumber(args.titleNumber)}_FIXTURE_ZIP`];
  if (fixturePath) {
    return fixturePath;
  }

  const zipPath = resolve(args.titleDirectory, basename(args.url));
  if (!args.force && globalThis.fetch === nativeFetch) {
    try {
      await (await import('node:fs/promises')).access(zipPath);
      return zipPath;
    } catch {
      // continue
    }
  }

  await mkdir(args.titleDirectory, { recursive: true });
  const response = await fetchWithRetry(args.url);
  if (!response.ok) {
    throw new Error(`failed to download title ${args.titleNumber} from ${args.url} (HTTP ${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const tempPath = `${zipPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, buffer, { mode: 0o640 });
  await rename(tempPath, zipPath);
  return zipPath;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function fetchWithRetry(url: string): Promise<Response> {
  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
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
      if (entry.uncompressedSize > MAX_XML_ENTRY_BYTES || totalExtractedBytes + entry.uncompressedSize > MAX_TOTAL_XML_BYTES) {
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
