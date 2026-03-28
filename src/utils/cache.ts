import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getDataDirectory, type SourceName } from './manifest.js';

export interface CachePaths {
  dataDirectory: string;
  cacheDirectory: string;
  sourceDirectory: string;
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
