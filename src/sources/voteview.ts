import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getCachePaths } from '../utils/cache.js';
import { readManifest, writeManifest, type DownloadedFileManifestEntry } from '../utils/manifest.js';

const VOTEVIEW_FILES = ['HSall_members.csv', 'HSall_votes.csv', 'HSall_rollcalls.csv'] as const;
const VOTEVIEW_BASE_URL = 'https://voteview.com/static/data/out';
const inMemoryIndexes = new Map<string, VoteViewIndex>();

export interface VoteViewResult { source: 'voteview'; ok: boolean; requested_scope: { files: string[] }; counts?: { files_downloaded: number }; error?: { code: string; message: string } }
export interface VoteViewIndex { membersByCongress: Map<number, string[]>; rollcallsByMember: Map<string, string[]>; votesByCongress: Map<number, string[]> }

export async function fetchVoteViewSource(invocation?: { force?: boolean }): Promise<VoteViewResult> {
  const force = invocation?.force ?? false;
  try {
    const { dataDirectory, sourceDirectory } = getCachePaths('voteview');
    await mkdir(sourceDirectory, { recursive: true });
    const manifest = await readManifest();
    let filesDownloaded = 0;
    const filesState: Record<string, DownloadedFileManifestEntry> = manifest.sources.voteview.files && typeof manifest.sources.voteview.files === 'object' ? manifest.sources.voteview.files as Record<string, DownloadedFileManifestEntry> : {};
    for (const fileName of VOTEVIEW_FILES) {
      const artifactPath = resolve(sourceDirectory, fileName);
      const cached = !force && await fileExists(artifactPath);
      if (!cached) {
        const response = await fetch(`${VOTEVIEW_BASE_URL}/${fileName}`);
        if (!response.ok) throw new Error(`VoteView download failed for ${fileName} (HTTP ${response.status})`);
        const body = await response.text();
        await writeFile(artifactPath, body, { encoding: 'utf8', mode: 0o640 });
        await writeFile(`${artifactPath}.sha256`, `${sha256(body)}\n`, { encoding: 'utf8', mode: 0o640 });
        filesState[fileName] = buildManifestEntry(dataDirectory, artifactPath, body);
        filesDownloaded += 1;
      } else if (!filesState[fileName]) {
        const body = await readFile(artifactPath, 'utf8');
        filesState[fileName] = buildManifestEntry(dataDirectory, artifactPath, body);
      }
    }
    manifest.sources.voteview.files = filesState;
    manifest.sources.voteview.last_success_at = new Date().toISOString();
    manifest.sources.voteview.last_failure = null;
    await writeManifest(manifest);
    return { source:'voteview', ok:true, requested_scope:{ files:[...VOTEVIEW_FILES] }, counts:{ files_downloaded: filesDownloaded } };
  } catch (error) {
    await recordFailure('upstream_request_failed', error instanceof Error ? error.message : 'VoteView fetch failed');
    return { source:'voteview', ok:false, requested_scope:{ files:[...VOTEVIEW_FILES] }, error:{ code:'upstream_request_failed', message:error instanceof Error ? error.message : 'VoteView fetch failed' } };
  }
}

export async function lookupByCongress(congress: number): Promise<{ members: string[]; votes: string[] }> {
  const index = await buildVoteViewIndex();
  return { members: index.membersByCongress.get(congress) ?? [], votes: index.votesByCongress.get(congress) ?? [] };
}

export async function buildVoteViewIndex(): Promise<VoteViewIndex> {
  const { sourceDirectory } = getCachePaths('voteview');
  if (inMemoryIndexes.has(sourceDirectory)) return inMemoryIndexes.get(sourceDirectory)!;
  const membersCsv = await readFile(resolve(sourceDirectory, 'HSall_members.csv'), 'utf8');
  const votesCsv = await readFile(resolve(sourceDirectory, 'HSall_votes.csv'), 'utf8');
  const rollcallsCsv = await readFile(resolve(sourceDirectory, 'HSall_rollcalls.csv'), 'utf8');
  const index: VoteViewIndex = { membersByCongress:new Map(), votesByCongress:new Map(), rollcallsByMember:new Map() };
  parseCsvRows(membersCsv).forEach((row) => { const congress = toNumber(row.congress); const bioguideId = row.bioguide_id; if (congress !== null && bioguideId) pushMapValue(index.membersByCongress, congress, bioguideId); });
  parseCsvRows(votesCsv).forEach((row) => { const congress = toNumber(row.congress); const rollnumber = row.rollnumber; if (congress !== null && rollnumber) pushMapValue(index.votesByCongress, congress, rollnumber); });
  parseCsvRows(rollcallsCsv).forEach((row) => { const memberKey = row.bioguide_id || row.icpsr; const rollnumber = row.rollnumber; if (memberKey && rollnumber) pushMapValue(index.rollcallsByMember, memberKey, rollnumber); });
  inMemoryIndexes.set(sourceDirectory, index); return index;
}

function parseCsvRows(csv: string): Array<Record<string, string>> { const lines = csv.trim().split(/\r?\n/); if (lines.length === 0) return []; const headers = lines[0]!.split(','); return lines.slice(1).filter(Boolean).map((line) => { const values = line.split(','); const row: Record<string, string> = {}; headers.forEach((header, index) => { row[header] = values[index] ?? ''; }); return row; }); }
function pushMapValue<K>(map: Map<K, string[]>, key: K, value: string) { const existing = map.get(key) ?? []; existing.push(value); map.set(key, existing); }
function toNumber(value: string | undefined): number | null { if (!value) return null; const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? parsed : null; }
function buildManifestEntry(dataDirectory: string, artifactPath: string, body: string): DownloadedFileManifestEntry { return { path: artifactPath.startsWith(dataDirectory) ? artifactPath.slice(dataDirectory.length + 1) : artifactPath, byte_count: Buffer.byteLength(body, 'utf8'), checksum_sha256: sha256(body), fetched_at: new Date().toISOString() }; }
async function fileExists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }
async function recordFailure(code: string, message: string): Promise<void> { const manifest = await readManifest(); manifest.sources.voteview.last_failure = { code, message }; await writeManifest(manifest); }
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
