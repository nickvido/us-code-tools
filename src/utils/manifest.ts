import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type SourceName = 'olrc' | 'congress' | 'govinfo' | 'voteview' | 'legislators';

export interface SourceStatusSummary {
  last_success_at: string | null;
  last_failure: { code: string; message: string } | null;
}

export interface FetchManifest {
  version: 1;
  updated_at: string;
  sources: Record<SourceName, SourceStatusSummary>;
}

export function createEmptyManifest(): FetchManifest {
  return {
    version: 1,
    updated_at: new Date(0).toISOString(),
    sources: {
      olrc: { last_success_at: null, last_failure: null },
      congress: { last_success_at: null, last_failure: null },
      govinfo: { last_success_at: null, last_failure: null },
      voteview: { last_success_at: null, last_failure: null },
      legislators: { last_success_at: null, last_failure: null },
    },
  };
}

export function getDataDirectory(): string {
  return resolve(process.env.US_CODE_TOOLS_DATA_DIR ?? 'data');
}

export function getManifestPath(dataDirectory = getDataDirectory()): string {
  return resolve(dataDirectory, 'manifest.json');
}

export async function manifestExists(dataDirectory = getDataDirectory()): Promise<boolean> {
  try {
    await access(getManifestPath(dataDirectory), fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readManifest(dataDirectory = getDataDirectory()): Promise<FetchManifest> {
  const manifestPath = getManifestPath(dataDirectory);

  try {
    const raw = await readFile(manifestPath, 'utf8');
    const parsed = parseManifestJson(raw);
    return normalizeManifest(parsed);
  } catch (error) {
    if (isMissingFileError(error)) {
      return createEmptyManifest();
    }

    throw error instanceof Error
      ? error
      : new Error('Manifest read failed with a non-Error value');
  }
}

export async function writeManifest(manifest: FetchManifest, dataDirectory = getDataDirectory()): Promise<void> {
  const manifestPath = getManifestPath(dataDirectory);
  await mkdir(dirname(manifestPath), { recursive: true });
  const payload = JSON.stringify({ ...manifest, updated_at: new Date().toISOString() }, null, 2);
  const temporaryPath = `${manifestPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${payload}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, manifestPath);
}

function parseManifestJson(raw: string): Partial<FetchManifest> {
  try {
    return JSON.parse(raw) as Partial<FetchManifest>;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown JSON parse error';
    throw new Error(`Manifest JSON is corrupt or unreadable: ${message}`);
  }
}

function normalizeManifest(parsed: Partial<FetchManifest>): FetchManifest {
  if (parsed.version !== 1 || !parsed.sources || typeof parsed.sources !== 'object') {
    throw new Error('Manifest is corrupt: missing version=1 sources object');
  }

  return {
    version: 1,
    updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : new Date(0).toISOString(),
    sources: {
      olrc: normalizeSourceStatus(parsed.sources.olrc),
      congress: normalizeSourceStatus(parsed.sources.congress),
      govinfo: normalizeSourceStatus(parsed.sources.govinfo),
      voteview: normalizeSourceStatus(parsed.sources.voteview),
      legislators: normalizeSourceStatus(parsed.sources.legislators),
    },
  };
}

function normalizeSourceStatus(value: unknown): SourceStatusSummary {
  if (!value || typeof value !== 'object') {
    return { last_success_at: null, last_failure: null };
  }

  const candidate = value as Partial<SourceStatusSummary>;
  return {
    last_success_at:
      typeof candidate.last_success_at === 'string' || candidate.last_success_at === null
        ? candidate.last_success_at ?? null
        : null,
    last_failure: isFailure(candidate.last_failure) ? candidate.last_failure : null,
  };
}

function isFailure(value: unknown): value is { code: string; message: string } {
  return Boolean(
    value
      && typeof value === 'object'
      && 'code' in value
      && 'message' in value
      && typeof value.code === 'string'
      && typeof value.message === 'string',
  );
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
