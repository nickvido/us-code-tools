import { access, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getDataDirectory, type SourceName } from './manifest.js';

export interface CachePaths {
  dataDirectory: string;
  cacheDirectory: string;
  sourceDirectory: string;
}

export interface RawResponseCacheMetadata {
  url: string;
  cache_key: string;
  fetched_at: string;
  content_type: string | null;
  status_code: number;
}

export interface RawResponseCachePaths {
  cacheKey: string;
  bodyPath: string;
  metadataPath: string;
}

export interface RawResponseCacheEntry {
  body: string;
  metadata: RawResponseCacheMetadata;
}

export function getCachePaths(source: SourceName, dataDirectory = getDataDirectory()): CachePaths {
  const cacheDirectory = resolve(dataDirectory, 'cache');
  return {
    dataDirectory,
    cacheDirectory,
    sourceDirectory: resolve(cacheDirectory, source),
  };
}

export async function ensureSourceCacheDirectory(source: SourceName, dataDirectory = getDataDirectory()): Promise<string> {
  const { sourceDirectory } = getCachePaths(source, dataDirectory);
  await mkdir(sourceDirectory, { recursive: true });
  return sourceDirectory;
}

export function createRawResponseCachePaths(source: SourceName, url: string, dataDirectory = getDataDirectory()): RawResponseCachePaths {
  const { sourceDirectory } = getCachePaths(source, dataDirectory);
  const normalizedUrl = normalizeCacheUrl(url);
  const cacheKey = createHash('sha256').update(normalizedUrl).digest('hex');
  const prefix = resolve(sourceDirectory, 'raw-responses', cacheKey.slice(0, 2), cacheKey);

  return {
    cacheKey,
    bodyPath: `${prefix}.body`,
    metadataPath: `${prefix}.json`,
  };
}

export async function readFreshRawResponseCache(
  source: SourceName,
  url: string,
  ttlMs: number,
  dataDirectory = getDataDirectory(),
): Promise<RawResponseCacheEntry | null> {
  const { bodyPath, metadataPath } = createRawResponseCachePaths(source, url, dataDirectory);

  try {
    await access(bodyPath, fsConstants.F_OK);
    await access(metadataPath, fsConstants.F_OK);
  } catch {
    return null;
  }

  const metadataRaw = await readFile(metadataPath, 'utf8');
  const metadata = JSON.parse(metadataRaw) as Partial<RawResponseCacheMetadata>;
  if (!isRawResponseCacheMetadata(metadata)) {
    return null;
  }

  const fetchedAtMs = Date.parse(metadata.fetched_at);
  if (!Number.isFinite(fetchedAtMs) || (Date.now() - fetchedAtMs) > ttlMs) {
    return null;
  }

  const [body, bodyStats] = await Promise.all([readFile(bodyPath, 'utf8'), stat(bodyPath)]);
  if (!bodyStats.isFile()) {
    return null;
  }

  return { body, metadata };
}

export async function writeRawResponseCache(
  source: SourceName,
  url: string,
  body: string,
  options: { statusCode: number; contentType: string | null },
  dataDirectory = getDataDirectory(),
): Promise<RawResponseCacheMetadata> {
  const { cacheKey, bodyPath, metadataPath } = createRawResponseCachePaths(source, url, dataDirectory);
  await mkdir(dirname(bodyPath), { recursive: true });

  const metadata: RawResponseCacheMetadata = {
    url: normalizeCacheUrl(url),
    cache_key: cacheKey,
    fetched_at: new Date().toISOString(),
    content_type: options.contentType,
    status_code: options.statusCode,
  };

  await writeFileAtomically(bodyPath, body, 0o640);
  await writeFileAtomically(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 0o640);
  return metadata;
}

function normalizeCacheUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete('api_key');
  parsed.hash = '';
  parsed.searchParams.sort();
  return parsed.toString();
}

function isRawResponseCacheMetadata(value: Partial<RawResponseCacheMetadata>): value is RawResponseCacheMetadata {
  return typeof value.url === 'string'
    && typeof value.cache_key === 'string'
    && typeof value.fetched_at === 'string'
    && (typeof value.content_type === 'string' || value.content_type === null)
    && typeof value.status_code === 'number';
}

async function writeFileAtomically(path: string, content: string, mode: number): Promise<void> {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, content, { encoding: 'utf8', mode });
  await rename(temporaryPath, path);
}
