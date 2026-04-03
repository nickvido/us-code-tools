import { createWriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { XMLParser } from 'fast-xml-parser';
import yauzl, { type Entry as YauzlEntry, type ZipFile as YauzlZipFile } from 'yauzl';
import { logNetworkEvent } from '../utils/logger.js';
import {
  readManifest,
  writeManifest,
  type FailureSummary,
  type FetchManifest,
  type SourceStatusSummary,
  getDataDirectory,
} from '../utils/manifest.js';
import {
  GOVINFO_BULK_COLLECTIONS,
  isGovInfoBulkCollection,
  isAllowedGovInfoBulkUrl,
  parseGovInfoBulkListing,
  resolveGovInfoBulkUrl,
  type GovInfoBulkCollection,
  type GovInfoBulkListingEntry,
} from '../utils/govinfo-bulk-listing.js';

const GOVINFO_BULK_ROOT_URL = 'https://www.govinfo.gov/bulkdata/';
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_CONCURRENT_DOWNLOADS = 2;
const ZIP_FILE_EXTENSIONS = ['.zip'];
const XML_FILE_EXTENSIONS = ['.xml'];
const XML_VALIDATOR = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });

export interface GovInfoBulkInvocation {
  force: boolean;
  congress: number | null;
  collection: GovInfoBulkCollection | null;
  dataDirectory?: string;
  fetchImpl?: typeof fetch;
}

export interface GovInfoBulkResult {
  source: 'govinfo-bulk';
  ok: boolean;
  collection?: GovInfoBulkCollection;
  collections: GovInfoBulkCollection[];
  congress: number | null;
  discovered_congresses: number[];
  directories_visited: number;
  files_discovered: number;
  files_downloaded: number;
  files_skipped: number;
  files_failed: number;
  error?: { code: string; message: string };
}

interface GovInfoBulkFileState {
  source_url: string;
  relative_cache_path: string;
  congress: number;
  collection: GovInfoBulkCollection;
  listing_path: string[];
  upstream_byte_size: number | null;
  fetched_at: string | null;
  completed_at: string | null;
  download_status: 'pending' | 'downloaded' | 'extracted' | 'failed';
  validation_status: 'not_checked' | 'xml_valid' | 'zip_valid' | 'invalid_payload';
  file_kind: 'zip' | 'xml' | 'unknown';
  extraction_root: string | null;
  error: FailureSummary | null;
}

interface GovInfoBulkCongressState {
  congress: number;
  discovered_at: string;
  completed_at: string | null;
  status: 'pending' | 'partial' | 'complete' | 'failed';
  directories_visited: number;
  files_discovered: number;
  files_downloaded: number;
  files_skipped: number;
  files_failed: number;
  file_keys: string[];
}

interface GovInfoBulkCollectionState {
  collection: GovInfoBulkCollection;
  discovered_at: string;
  completed_at: string | null;
  status: 'pending' | 'partial' | 'complete' | 'failed';
  discovered_congresses: number[];
  congress_runs: Record<string, GovInfoBulkCongressState>;
}

interface GovInfoBulkCheckpointState {
  selected_collections: GovInfoBulkCollection[];
  selected_congress: number | null;
  pending_directory_urls: string[];
  active_file_urls: string[];
  updated_at: string;
}

export interface GovInfoBulkManifestState extends SourceStatusSummary {
  checkpoints: Record<string, GovInfoBulkCheckpointState>;
  collections: Partial<Record<GovInfoBulkCollection, GovInfoBulkCollectionState>>;
  files: Record<string, GovInfoBulkFileState>;
}

interface QueueFile {
  entry: GovInfoBulkListingEntry;
  collection: GovInfoBulkCollection;
  congress: number;
  listingPath: string[];
}

export async function fetchGovInfoBulkSource(invocation: GovInfoBulkInvocation): Promise<GovInfoBulkResult> {
  const dataDirectory = invocation.dataDirectory ?? getDataDirectory();
  const fetchImpl = invocation.fetchImpl ?? fetch;
  const selectedCollections = invocation.collection === null ? [...GOVINFO_BULK_COLLECTIONS] : [invocation.collection];
  const requestCheckpointKey = buildCheckpointKey(selectedCollections, invocation.congress);

  try {
    const manifest = await readManifest(dataDirectory);
    const state = ensureGovInfoBulkState(manifest);
    if (invocation.force) {
      clearScope(state, selectedCollections, invocation.congress);
    }

    const result: GovInfoBulkResult = {
      source: 'govinfo-bulk',
      ok: true,
      collection: invocation.collection ?? undefined,
      collections: selectedCollections,
      congress: invocation.congress,
      discovered_congresses: [],
      directories_visited: 0,
      files_discovered: 0,
      files_downloaded: 0,
      files_skipped: 0,
      files_failed: 0,
    };

    state.checkpoints[requestCheckpointKey] = {
      selected_collections: selectedCollections,
      selected_congress: invocation.congress,
      pending_directory_urls: [],
      active_file_urls: [],
      updated_at: new Date().toISOString(),
    };
    await persistGovInfoBulkState(manifest, dataDirectory, state);

    for (const collection of selectedCollections) {
      const collectionRootUrl = resolveGovInfoBulkUrl(GOVINFO_BULK_ROOT_URL, `${collection}/`).toString();
      const collectionListing = await fetchListing(collectionRootUrl, fetchImpl);
      const congressEntries = collectionListing.filter((entry) => entry.kind === 'directory' && /^\d+$/.test(entry.name));
      const selectedCongresses = congressEntries
        .map((entry) => ({ entry, congress: Number.parseInt(entry.name, 10) }))
        .filter((item) => invocation.congress === null || item.congress === invocation.congress)
        .sort((left, right) => left.congress - right.congress);

      const collectionState = getOrCreateCollectionState(state, collection);
      collectionState.discovered_congresses = selectedCongresses.map((item) => item.congress);
      result.discovered_congresses.push(...selectedCongresses.map((item) => item.congress));

      for (const { entry, congress } of selectedCongresses) {
        const congressState = getOrCreateCongressState(collectionState, congress);
        const filesToProcess = await discoverFilesForCongress({
          fetchImpl,
          collection,
          congress,
          directoryEntry: entry,
          result,
          requestCheckpoint: state.checkpoints[requestCheckpointKey],
        });
        congressState.files_discovered += filesToProcess.length;
        await processQueue(filesToProcess, MAX_CONCURRENT_DOWNLOADS, async (item) => {
          const fileKey = buildManifestFileKey(item.collection, item.congress, deriveRelativeCachePath(item.entry.url));
          congressState.file_keys = mergeFileKey(congressState.file_keys, fileKey);
          const fileResult = await downloadBulkArtifact({
            dataDirectory,
            manifest,
            state,
            entry: item.entry,
            collection: item.collection,
            congress: item.congress,
            listingPath: item.listingPath,
            fileKey,
            force: invocation.force,
            fetchImpl,
          });
          if (fileResult === 'skipped') {
            result.files_skipped += 1;
            congressState.files_skipped += 1;
            return;
          }
          if (fileResult === 'downloaded') {
            result.files_downloaded += 1;
            congressState.files_downloaded += 1;
            return;
          }
          result.files_failed += 1;
          congressState.files_failed += 1;
        });

        congressState.status = deriveCongressStatus(congressState);
        congressState.completed_at = congressState.status === 'complete' ? new Date().toISOString() : congressState.completed_at;
      }

      collectionState.status = deriveCollectionStatus(collectionState);
      collectionState.completed_at = collectionState.status === 'complete' ? new Date().toISOString() : collectionState.completed_at;
    }

    delete state.checkpoints[requestCheckpointKey];
    state.last_success_at = new Date().toISOString();
    state.last_failure = null;
    await persistGovInfoBulkState(manifest, dataDirectory, state);
    result.discovered_congresses = [...new Set(result.discovered_congresses)].sort((left, right) => left - right);
    return result;
  } catch (error) {
    const manifest = await readManifest(dataDirectory);
    const state = ensureGovInfoBulkState(manifest);
    const normalized = normalizeGovInfoBulkError(error);
    state.last_failure = { code: normalized.code, message: normalized.message };
    delete state.checkpoints[requestCheckpointKey];
    await persistGovInfoBulkState(manifest, dataDirectory, state);
    return {
      source: 'govinfo-bulk',
      ok: false,
      collection: invocation.collection ?? undefined,
      collections: selectedCollections,
      congress: invocation.congress,
      discovered_congresses: [],
      directories_visited: 0,
      files_discovered: 0,
      files_downloaded: 0,
      files_skipped: 0,
      files_failed: 0,
      error: normalized,
    };
  }
}

async function discoverFilesForCongress(options: {
  fetchImpl: typeof fetch;
  collection: GovInfoBulkCollection;
  congress: number;
  directoryEntry: GovInfoBulkListingEntry;
  result: GovInfoBulkResult;
  requestCheckpoint: GovInfoBulkCheckpointState;
}): Promise<QueueFile[]> {
  const queue: Array<{ entry: GovInfoBulkListingEntry; listingPath: string[] }> = [{ entry: options.directoryEntry, listingPath: [] }];
  const files: QueueFile[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    options.result.directories_visited += 1;
    options.requestCheckpoint.pending_directory_urls = queue.map((item) => item.entry.url);
    const listing = await fetchListing(current.entry.url, options.fetchImpl);
    for (const entry of listing) {
      if (entry.kind === 'directory') {
        queue.push({ entry, listingPath: [...current.listingPath, entry.name] });
        continue;
      }
      files.push({
        entry,
        collection: options.collection,
        congress: options.congress,
        listingPath: current.listingPath,
      });
      options.result.files_discovered += 1;
    }
  }

  return files;
}

async function downloadBulkArtifact(options: {
  dataDirectory: string;
  manifest: FetchManifest;
  state: GovInfoBulkManifestState;
  entry: GovInfoBulkListingEntry;
  collection: GovInfoBulkCollection;
  congress: number;
  listingPath: string[];
  fileKey: string;
  force: boolean;
  fetchImpl: typeof fetch;
}): Promise<'skipped' | 'downloaded' | 'failed'> {
  const relativeCachePath = deriveRelativeCachePath(options.entry.url);
  const targetPath = resolve(options.dataDirectory, 'cache', 'govinfo-bulk', relativeCachePath);
  const initialState: GovInfoBulkFileState = {
    source_url: options.entry.url,
    relative_cache_path: relativeCachePath,
    congress: options.congress,
    collection: options.collection,
    listing_path: options.listingPath,
    upstream_byte_size: null,
    fetched_at: null,
    completed_at: null,
    download_status: 'pending',
    validation_status: 'not_checked',
    file_kind: detectFileKind(options.entry.url),
    extraction_root: null,
    error: null,
  };

  const existing = options.state.files[options.fileKey] ?? initialState;
  if (!options.force && await isResumeComplete(existing, options.dataDirectory)) {
    options.state.files[options.fileKey] = existing;
    return 'skipped';
  }

  options.state.files[options.fileKey] = { ...existing, download_status: 'pending', error: null };
  await persistGovInfoBulkState(options.manifest, options.dataDirectory, options.state);

  const response = await fetchFile(options.entry.url, options.fetchImpl);
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(dirname(targetPath), { recursive: true });
  let temporaryExtractionRoot: string | null = null;
  try {
    const streamedByteCount = await streamResponseToDisk(response, temporaryPath);
    const headerByteCount = Number.parseInt(response.headers.get('content-length') ?? '', 10);
    const byteSize = Number.isFinite(headerByteCount) && headerByteCount > 0 ? headerByteCount : streamedByteCount;
    const fileKind = detectFileKind(options.entry.url);
    const extractionRoot = fileKind === 'zip' ? resolve(dirname(targetPath), 'extracted') : null;

    if (fileKind === 'xml') {
      const xml = await readFile(temporaryPath, 'utf8');
      validateXmlPayload(xml);
    } else if (fileKind === 'zip') {
      temporaryExtractionRoot = await mkdtemp(resolve(dirname(targetPath), '.extract-'));
      await extractZipSafely(temporaryPath, temporaryExtractionRoot);
      const xmlFiles = await collectXmlFiles(temporaryExtractionRoot);
      if (xmlFiles.length === 0) {
        throw new Error('invalid_payload: ZIP file contained no XML artifacts');
      }
      if (options.collection === 'BILLSTATUS') {
        const sampleXml = await readFile(xmlFiles[0], 'utf8');
        validateXmlPayload(sampleXml);
      }
    } else {
      const payload = await readFile(temporaryPath, 'utf8');
      validateXmlPayload(payload);
    }

    if (!options.force && await wasArtifactCompletedByAnotherWriter({
      fileKey: options.fileKey,
      dataDirectory: options.dataDirectory,
      targetPath,
      fileKind,
      extractionRoot,
    })) {
      await rm(temporaryPath, { force: true });
      if (temporaryExtractionRoot !== null) {
        await rm(temporaryExtractionRoot, { recursive: true, force: true });
      }
      const refreshedManifest = await readManifest(options.dataDirectory);
      const refreshedState = ensureGovInfoBulkState(refreshedManifest);
      const refreshedEntry = refreshedState.files[options.fileKey];
      if (refreshedEntry) {
        options.state.files[options.fileKey] = refreshedEntry;
      }
      return 'skipped';
    }

    if (temporaryExtractionRoot !== null && extractionRoot !== null) {
      await rm(extractionRoot, { recursive: true, force: true });
      await rename(temporaryExtractionRoot, extractionRoot);
      temporaryExtractionRoot = null;
    }

    await rename(temporaryPath, targetPath);
    options.state.files[options.fileKey] = {
      ...initialState,
      source_url: options.entry.url,
      relative_cache_path: relativeCachePath,
      congress: options.congress,
      collection: options.collection,
      listing_path: options.listingPath,
      upstream_byte_size: Number.isFinite(byteSize) && byteSize > 0 ? byteSize : null,
      fetched_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      download_status: fileKind === 'zip' ? 'extracted' : 'downloaded',
      validation_status: fileKind === 'zip' ? 'zip_valid' : 'xml_valid',
      file_kind: fileKind,
      extraction_root: fileKind === 'zip' ? relative(options.dataDirectory, extractionRoot ?? dirname(targetPath)) : null,
      error: null,
    };
    await persistGovInfoBulkState(options.manifest, options.dataDirectory, options.state);
    return 'downloaded';
  } catch (error) {
    await rm(temporaryPath, { force: true });
    if (temporaryExtractionRoot !== null) {
      await rm(temporaryExtractionRoot, { recursive: true, force: true });
    }
    options.state.files[options.fileKey] = {
      ...initialState,
      source_url: options.entry.url,
      relative_cache_path: relativeCachePath,
      congress: options.congress,
      collection: options.collection,
      listing_path: options.listingPath,
      download_status: 'failed',
      validation_status: 'invalid_payload',
      error: normalizeGovInfoBulkError(error),
    };
    await persistGovInfoBulkState(options.manifest, options.dataDirectory, options.state);
    return 'failed';
  }
}

async function streamResponseToDisk(response: Response, destinationPath: string): Promise<number> {
  if (response.body === null) {
    throw new Error('upstream_request_failed: GovInfo bulk file response had no readable body');
  }

  let byteCount = 0;
  const countBytes = new Transform({
    transform(chunk, _encoding, callback) {
      byteCount += Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(String(chunk));
      callback(null, chunk);
    },
  });

  await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), countBytes, createWriteStream(destinationPath, { mode: 0o640 }));
  return byteCount;
}

async function wasArtifactCompletedByAnotherWriter(options: {
  fileKey: string;
  dataDirectory: string;
  targetPath: string;
  fileKind: GovInfoBulkFileState['file_kind'];
  extractionRoot: string | null;
}): Promise<boolean> {
  const refreshedManifest = await readManifest(options.dataDirectory);
  const refreshedState = ensureGovInfoBulkState(refreshedManifest);
  const refreshedEntry = refreshedState.files[options.fileKey];
  if (refreshedEntry && await isResumeComplete(refreshedEntry, options.dataDirectory)) {
    return true;
  }

  const hasTargetPath = await pathExists(options.targetPath);
  if (!hasTargetPath) {
    return false;
  }

  if (options.fileKind !== 'zip') {
    return true;
  }

  if (options.extractionRoot === null) {
    return true;
  }

  return pathExists(options.extractionRoot);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function fetchListing(url: string, fetchImpl: typeof fetch): Promise<GovInfoBulkListingEntry[]> {
  const response = await fetchText(url, fetchImpl, 'govinfo-bulk');
  return parseGovInfoBulkListing(response.body, url).filter((entry) => isAllowedGovInfoBulkUrl(new URL(entry.url)));
}

async function fetchFile(url: string, fetchImpl: typeof fetch): Promise<Response> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' });
    logNetworkEvent({ level: response.ok ? 'info' : 'error', event: 'network.request', source: 'govinfo-bulk', method: 'GET', url, attempt: 1, cache_status: 'miss', duration_ms: Date.now() - startedAt, status_code: response.status });
    if (!response.ok || response.body === null) {
      throw new Error(`upstream_request_failed: GovInfo bulk file request failed with HTTP ${response.status}`);
    }
    const finalUrl = new URL(response.url || url);
    if (!isAllowedGovInfoBulkUrl(finalUrl)) {
      throw new Error(`upstream_request_failed: GovInfo bulk file redirected outside allowed scope to ${finalUrl.toString()}`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url: string, fetchImpl: typeof fetch, source: string): Promise<{ body: string }> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: 'follow', headers: { 'Accept': 'application/xml' } });
    const body = await response.text();
    logNetworkEvent({ level: response.ok ? 'info' : 'error', event: 'network.request', source, method: 'GET', url, attempt: 1, cache_status: 'miss', duration_ms: Date.now() - startedAt, status_code: response.status });
    if (!response.ok) {
      throw new Error(`upstream_request_failed: GovInfo bulk listing request failed with HTTP ${response.status}`);
    }
    const finalUrl = new URL(response.url || url);
    if (!isAllowedGovInfoBulkUrl(finalUrl)) {
      throw new Error(`upstream_request_failed: GovInfo bulk listing redirected outside allowed scope to ${finalUrl.toString()}`);
    }
    return { body };
  } finally {
    clearTimeout(timeout);
  }
}

function ensureGovInfoBulkState(manifest: FetchManifest): GovInfoBulkManifestState {
  const candidate = (manifest.sources as FetchManifest['sources'] & { 'govinfo-bulk'?: GovInfoBulkManifestState })['govinfo-bulk'];
  if (candidate) {
    return candidate;
  }
  const created = createEmptyGovInfoBulkState();
  (manifest.sources as FetchManifest['sources'] & { 'govinfo-bulk': GovInfoBulkManifestState })['govinfo-bulk'] = created;
  return created;
}

function createEmptyGovInfoBulkState(): GovInfoBulkManifestState {
  return {
    last_success_at: null,
    last_failure: null,
    checkpoints: {},
    collections: {},
    files: {},
  };
}

function getOrCreateCollectionState(state: GovInfoBulkManifestState, collection: GovInfoBulkCollection): GovInfoBulkCollectionState {
  const existing = state.collections[collection];
  if (existing) {
    return existing;
  }
  const created: GovInfoBulkCollectionState = {
    collection,
    discovered_at: new Date().toISOString(),
    completed_at: null,
    status: 'pending',
    discovered_congresses: [],
    congress_runs: {},
  };
  state.collections[collection] = created;
  return created;
}

function getOrCreateCongressState(collectionState: GovInfoBulkCollectionState, congress: number): GovInfoBulkCongressState {
  const key = String(congress);
  const existing = collectionState.congress_runs[key];
  if (existing) {
    return existing;
  }
  const created: GovInfoBulkCongressState = {
    congress,
    discovered_at: new Date().toISOString(),
    completed_at: null,
    status: 'pending',
    directories_visited: 0,
    files_discovered: 0,
    files_downloaded: 0,
    files_skipped: 0,
    files_failed: 0,
    file_keys: [],
  };
  collectionState.congress_runs[key] = created;
  return created;
}

async function persistGovInfoBulkState(manifest: FetchManifest, dataDirectory: string, state: GovInfoBulkManifestState): Promise<void> {
  (manifest.sources as FetchManifest['sources'] & { 'govinfo-bulk': GovInfoBulkManifestState })['govinfo-bulk'] = state;
  await writeManifest(manifest, dataDirectory);
}

function deriveCongressStatus(state: GovInfoBulkCongressState): GovInfoBulkCongressState['status'] {
  if (state.files_failed > 0 && state.files_downloaded === 0 && state.files_skipped === 0) {
    return 'failed';
  }
  if (state.files_failed > 0) {
    return 'partial';
  }
  if (state.files_discovered > 0) {
    return 'complete';
  }
  return 'pending';
}

function deriveCollectionStatus(state: GovInfoBulkCollectionState): GovInfoBulkCollectionState['status'] {
  const congressStates = Object.values(state.congress_runs);
  if (congressStates.length === 0) {
    return 'pending';
  }
  if (congressStates.every((entry) => entry.status === 'complete')) {
    return 'complete';
  }
  if (congressStates.some((entry) => entry.status === 'failed' || entry.status === 'partial')) {
    return 'partial';
  }
  return 'pending';
}

function buildCheckpointKey(collections: GovInfoBulkCollection[], congress: number | null): string {
  return `${collections.join(',')}:${congress ?? 'all'}`;
}

function clearScope(state: GovInfoBulkManifestState, collections: GovInfoBulkCollection[], congress: number | null): void {
  for (const [fileKey, entry] of Object.entries(state.files)) {
    if (!collections.includes(entry.collection)) {
      continue;
    }
    if (congress !== null && entry.congress !== congress) {
      continue;
    }
    delete state.files[fileKey];
  }
}

function buildManifestFileKey(collection: GovInfoBulkCollection, congress: number, relativeCachePath: string): string {
  return `${collection}:${congress}:${relativeCachePath}`;
}

function deriveRelativeCachePath(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname.replace(/^\/bulkdata\//, '').replace(/^\/+/, '');
}

function detectFileKind(url: string): GovInfoBulkFileState['file_kind'] {
  const lower = url.toLowerCase();
  if (ZIP_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return 'zip';
  }
  if (XML_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return 'xml';
  }
  return 'unknown';
}

async function isResumeComplete(entry: GovInfoBulkFileState, dataDirectory: string): Promise<boolean> {
  if ((entry.download_status !== 'downloaded' && entry.download_status !== 'extracted') || entry.completed_at === null) {
    return false;
  }

  const targetPath = resolve(dataDirectory, 'cache', 'govinfo-bulk', entry.relative_cache_path);
  try {
    const targetStat = await stat(targetPath);
    if (entry.upstream_byte_size !== null && targetStat.size !== entry.upstream_byte_size) {
      return false;
    }
  } catch {
    return false;
  }

  if (entry.file_kind === 'zip' && entry.extraction_root !== null) {
    try {
      await access(resolve(dataDirectory, entry.extraction_root), fsConstants.F_OK);
    } catch {
      return false;
    }
  }

  return entry.validation_status !== 'invalid_payload';
}

async function collectXmlFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.xml')) {
        files.push(nextPath);
      }
    }
  }
  return files.sort();
}

function validateXmlPayload(xml: string): void {
  const trimmed = xml.trimStart();
  if (trimmed.startsWith('<!DOCTYPE html') || trimmed.startsWith('<html') || trimmed.startsWith('<HTML')) {
    throw new Error('invalid_payload: HTML payload cannot be marked as XML');
  }
  XML_VALIDATOR.parse(xml);
}

async function extractZipSafely(zipPath: string, extractionRoot: string): Promise<void> {
  await mkdir(extractionRoot, { recursive: true });
  const zip = await openZip(zipPath);
  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      zip.readEntry();
      zip.on('entry', (entry: YauzlEntry) => {
        const normalized = entry.fileName.replace(/\\/g, '/');
        if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
          rejectPromise(new Error(`invalid_payload: ZIP entry escapes extraction root (${entry.fileName})`));
          return;
        }
        const destination = resolve(extractionRoot, normalized);
        if (!destination.startsWith(extractionRoot)) {
          rejectPromise(new Error(`invalid_payload: ZIP entry resolves outside extraction root (${entry.fileName})`));
          return;
        }
        if (/\/$/.test(entry.fileName)) {
          mkdir(destination, { recursive: true }).then(() => zip.readEntry(), rejectPromise);
          return;
        }
        mkdir(dirname(destination), { recursive: true })
          .then(() => openZipReadStream(zip, entry))
          .then(async (stream) => {
            await pipeline(stream, createWriteStream(destination, { mode: 0o640 }));
            zip.readEntry();
          })
          .catch(rejectPromise);
      });
      zip.once('end', () => resolvePromise());
      zip.once('error', rejectPromise);
    });
  } finally {
    zip.close();
  }
}

function openZip(path: string): Promise<YauzlZipFile> {
  return new Promise((resolvePromise, rejectPromise) => {
    yauzl.open(path, { lazyEntries: true }, (error, zip) => {
      if (error || zip === undefined) {
        rejectPromise(error ?? new Error('Failed to open ZIP archive'));
        return;
      }
      resolvePromise(zip);
    });
  });
}

function openZipReadStream(zip: YauzlZipFile, entry: YauzlEntry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolvePromise, rejectPromise) => {
    zip.openReadStream(entry, (error: Error | null, stream?: NodeJS.ReadableStream) => {
      if (error || stream === undefined) {
        rejectPromise(error ?? new Error(`Failed to read ZIP entry ${entry.fileName}`));
        return;
      }
      resolvePromise(stream);
    });
  });
}

async function processQueue<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) {
        continue;
      }
      await worker(item);
    }
  });
  await Promise.all(workers);
}

function mergeFileKey(existing: string[], fileKey: string): string[] {
  return existing.includes(fileKey) ? existing : [...existing, fileKey];
}

function normalizeGovInfoBulkError(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    if (error.message.startsWith('invalid_')) {
      const [code, ...rest] = error.message.split(':');
      return { code, message: rest.join(':').trim() || error.message };
    }
    if (error.message.startsWith('upstream_request_failed:')) {
      return { code: 'upstream_request_failed', message: error.message };
    }
    return { code: 'upstream_request_failed', message: error.message };
  }
  return { code: 'upstream_request_failed', message: 'GovInfo bulk fetch failed' };
}

export function normalizeGovInfoBulkManifestState(value: unknown): GovInfoBulkManifestState {
  if (!isRecord(value)) {
    return createEmptyGovInfoBulkState();
  }

  const collections: Partial<Record<GovInfoBulkCollection, GovInfoBulkCollectionState>> = {};
  if (isRecord(value.collections)) {
    for (const [key, entry] of Object.entries(value.collections)) {
      if (!isGovInfoBulkCollection(key) || !isRecord(entry)) {
        continue;
      }
      collections[key] = {
        collection: key,
        discovered_at: typeof entry.discovered_at === 'string' ? entry.discovered_at : new Date(0).toISOString(),
        completed_at: typeof entry.completed_at === 'string' || entry.completed_at === null ? entry.completed_at : null,
        status: entry.status === 'pending' || entry.status === 'partial' || entry.status === 'complete' || entry.status === 'failed' ? entry.status : 'pending',
        discovered_congresses: Array.isArray(entry.discovered_congresses)
          ? entry.discovered_congresses.filter((candidate): candidate is number => typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate > 0)
          : [],
        congress_runs: normalizeCongressRuns(entry.congress_runs),
      };
    }
  }

  const files: Record<string, GovInfoBulkFileState> = {};
  if (isRecord(value.files)) {
    for (const [key, entry] of Object.entries(value.files)) {
      if (!isRecord(entry) || !isGovInfoBulkCollection(String(entry.collection ?? ''))) {
        continue;
      }
      const normalizedCollection = typeof entry.collection === 'string' ? entry.collection : null;
      if (normalizedCollection === null || !isGovInfoBulkCollection(normalizedCollection)) {
        continue;
      }
      files[key] = {
        source_url: typeof entry.source_url === 'string' ? entry.source_url : '',
        relative_cache_path: typeof entry.relative_cache_path === 'string' ? entry.relative_cache_path : '',
        congress: typeof entry.congress === 'number' ? entry.congress : 0,
        collection: normalizedCollection,
        listing_path: Array.isArray(entry.listing_path) ? entry.listing_path.filter((item): item is string => typeof item === 'string') : [],
        upstream_byte_size: typeof entry.upstream_byte_size === 'number' ? entry.upstream_byte_size : null,
        fetched_at: typeof entry.fetched_at === 'string' || entry.fetched_at === null ? entry.fetched_at : null,
        completed_at: typeof entry.completed_at === 'string' || entry.completed_at === null ? entry.completed_at : null,
        download_status: entry.download_status === 'pending' || entry.download_status === 'downloaded' || entry.download_status === 'extracted' || entry.download_status === 'failed' ? entry.download_status : 'pending',
        validation_status: entry.validation_status === 'not_checked' || entry.validation_status === 'xml_valid' || entry.validation_status === 'zip_valid' || entry.validation_status === 'invalid_payload' ? entry.validation_status : 'not_checked',
        file_kind: entry.file_kind === 'zip' || entry.file_kind === 'xml' || entry.file_kind === 'unknown' ? entry.file_kind : 'unknown',
        extraction_root: typeof entry.extraction_root === 'string' || entry.extraction_root === null ? entry.extraction_root : null,
        error: isFailureSummary(entry.error) ? entry.error : null,
      };
    }
  }

  return {
    last_success_at: typeof value.last_success_at === 'string' || value.last_success_at === null ? value.last_success_at : null,
    last_failure: isFailureSummary(value.last_failure) ? value.last_failure : null,
    checkpoints: {},
    collections,
    files,
  };
}

function normalizeCongressRuns(value: unknown): Record<string, GovInfoBulkCongressState> {
  if (!isRecord(value)) {
    return {};
  }
  const normalized: Record<string, GovInfoBulkCongressState> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      continue;
    }
    normalized[key] = {
      congress: typeof entry.congress === 'number' ? entry.congress : Number.parseInt(key, 10),
      discovered_at: typeof entry.discovered_at === 'string' ? entry.discovered_at : new Date(0).toISOString(),
      completed_at: typeof entry.completed_at === 'string' || entry.completed_at === null ? entry.completed_at : null,
      status: entry.status === 'pending' || entry.status === 'partial' || entry.status === 'complete' || entry.status === 'failed' ? entry.status : 'pending',
      directories_visited: typeof entry.directories_visited === 'number' ? entry.directories_visited : 0,
      files_discovered: typeof entry.files_discovered === 'number' ? entry.files_discovered : 0,
      files_downloaded: typeof entry.files_downloaded === 'number' ? entry.files_downloaded : 0,
      files_skipped: typeof entry.files_skipped === 'number' ? entry.files_skipped : 0,
      files_failed: typeof entry.files_failed === 'number' ? entry.files_failed : 0,
      file_keys: Array.isArray(entry.file_keys) ? entry.file_keys.filter((item): item is string => typeof item === 'string') : [],
    };
  }
  return normalized;
}

function isFailureSummary(value: unknown): value is FailureSummary {
  return Boolean(value && typeof value === 'object' && 'code' in value && 'message' in value && typeof value.code === 'string' && typeof value.message === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
