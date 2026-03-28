import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { getCachePaths } from '../utils/cache.js';
import {
  readManifest,
  writeManifest,
  type DownloadedFileManifestEntry,
  type FetchManifest,
  type LegislatorsCrossReferenceState,
} from '../utils/manifest.js';
import { evaluateCongressMemberSnapshotFreshness } from './congress-member-snapshot.js';

const LEGISLATOR_FILES = ['legislators-current.yaml', 'legislators-historical.yaml', 'committees-current.yaml'] as const;
const UNITED_STATES_BASE_URL = 'https://raw.githubusercontent.com/unitedstates/congress-legislators/main';

export interface UnitedStatesResult {
  source: 'legislators';
  ok: boolean;
  requested_scope: { files: string[] };
  counts?: { files_downloaded: number };
  error?: { code: string; message: string };
}

export interface ParsedLegislatorIdentity {
  bioguide: string | null;
}

export interface ParsedLegislatorName {
  official_full: string | null;
}

export interface ParsedLegislatorRecord {
  id: ParsedLegislatorIdentity;
  name: ParsedLegislatorName;
}

export interface ParsedCommitteeRecord {
  thomas_id: string | null;
  name: string | null;
}

interface CongressMemberListPayload {
  members?: Array<{
    bioguideId?: string;
  }>;
}

export async function fetchUnitedStatesSource(_invocation?: { force?: boolean }): Promise<UnitedStatesResult> {
  try {
    const { dataDirectory, sourceDirectory } = getCachePaths('legislators');
    await mkdir(sourceDirectory, { recursive: true });

    const manifest = await readManifest();
    let filesDownloaded = 0;
    for (const fileName of LEGISLATOR_FILES) {
      const response = await fetch(`${UNITED_STATES_BASE_URL}/${fileName}`);
      if (!response.ok) {
        throw new Error(`UnitedStates download failed for ${fileName} (HTTP ${response.status})`);
      }

      const body = await response.text();
      const artifactPath = resolve(sourceDirectory, fileName);
      await writeFile(artifactPath, body, { encoding: 'utf8', mode: 0o640 });
      await writeFile(`${artifactPath}.sha256`, `${sha256(body)}\n`, { encoding: 'utf8', mode: 0o640 });
      manifest.sources.legislators.files[fileName] = buildDownloadedFileManifestEntry(dataDirectory, artifactPath, body);
      filesDownloaded += 1;
    }

    const crossReference = await buildCrossReferenceState(manifest, sourceDirectory);
    manifest.sources.legislators.last_success_at = new Date().toISOString();
    manifest.sources.legislators.last_failure = null;
    manifest.sources.legislators.cross_reference = crossReference;
    await writeManifest(manifest);

    return {
      source: 'legislators',
      ok: true,
      requested_scope: { files: [...LEGISLATOR_FILES] },
      counts: { files_downloaded: filesDownloaded },
    };
  } catch (error) {
    await recordFailure('upstream_request_failed', error instanceof Error ? error.message : 'Legislators fetch failed');
    return {
      source: 'legislators',
      ok: false,
      requested_scope: { files: [...LEGISLATOR_FILES] },
      error: {
        code: 'upstream_request_failed',
        message: error instanceof Error ? error.message : 'Legislators fetch failed',
      },
    };
  }
}

export async function parseCurrentLegislatorsYaml(yaml: string): Promise<ParsedLegislatorRecord[]> {
  return parseLegislatorYamlRecords(yaml);
}

export async function parseHistoricalLegislatorsYaml(yaml: string): Promise<ParsedLegislatorRecord[]> {
  return parseLegislatorYamlRecords(yaml);
}

export async function parseCurrentCommitteesYaml(yaml: string): Promise<ParsedCommitteeRecord[]> {
  return parseCommitteeYamlRecords(yaml);
}

async function buildCrossReferenceState(
  manifest: FetchManifest,
  sourceDirectory: string,
): Promise<LegislatorsCrossReferenceState> {
  const { sourceDirectory: congressSourceDirectory } = getCachePaths('congress');
  const memberSnapshot = manifest.sources.congress.member_snapshot;

  if (memberSnapshot.status !== 'complete') {
    return deriveSkippedCrossReferenceState(memberSnapshot.status, null);
  }

  const snapshotFreshness = await evaluateCongressMemberSnapshotFreshness(memberSnapshot, congressSourceDirectory);
  if (!snapshotFreshness.isReusable) {
    return deriveSkippedCrossReferenceState(snapshotFreshness.rebuildStatus, null);
  }

  const snapshotId = memberSnapshot.snapshot_id;
  if (snapshotId === null) {
    return deriveSkippedCrossReferenceState('stale', null);
  }

  const currentYaml = await readFile(resolve(sourceDirectory, 'legislators-current.yaml'), 'utf8');
  const historicalYaml = await readFile(resolve(sourceDirectory, 'legislators-historical.yaml'), 'utf8');
  const currentLegislators = await parseCurrentLegislatorsYaml(currentYaml);
  const historicalLegislators = await parseHistoricalLegislatorsYaml(historicalYaml);
  const legislatorBioguideIds = new Set([
    ...extractLegislatorBioguideIds(currentLegislators),
    ...extractLegislatorBioguideIds(historicalLegislators),
  ]);

  const congressBioguideIds = new Set(await loadCongressSnapshotBioguideIds(manifest));
  const matched = [...legislatorBioguideIds].filter((bioguideId) => congressBioguideIds.has(bioguideId));
  const unmatchedLegislators = [...legislatorBioguideIds].filter((bioguideId) => !congressBioguideIds.has(bioguideId));
  const unmatchedCongress = [...congressBioguideIds].filter((bioguideId) => !legislatorBioguideIds.has(bioguideId));

  const crosswalk = {
    based_on_snapshot_id: snapshotId,
    matched_bioguide_ids: matched,
  };

  await writeFile(resolve(sourceDirectory, 'bioguide-crosswalk.json'), JSON.stringify(crosswalk, null, 2), {
    encoding: 'utf8',
    mode: 0o640,
  });

  return {
    status: 'completed',
    based_on_snapshot_id: snapshotId,
    crosswalk_artifact_id: 'bioguide-crosswalk.json',
    matched_bioguide_ids: matched.length,
    unmatched_legislator_bioguide_ids: unmatchedLegislators.length,
    unmatched_congress_bioguide_ids: unmatchedCongress.length,
    updated_at: new Date().toISOString(),
  };
}

async function loadCongressSnapshotBioguideIds(manifest: FetchManifest): Promise<string[]> {
  const { sourceDirectory } = getCachePaths('congress');
  const bioguideIds = new Set<string>();

  for (const artifact of manifest.sources.congress.member_snapshot.artifacts) {
    if (!artifact.includes('/pages/')) {
      continue;
    }

    const body = await readFile(resolve(sourceDirectory, artifact), 'utf8');
    const payload = JSON.parse(body) as CongressMemberListPayload;
    for (const member of payload.members ?? []) {
      if (typeof member.bioguideId === 'string' && member.bioguideId.length > 0) {
        bioguideIds.add(member.bioguideId);
      }
    }
  }

  return [...bioguideIds];
}

function buildDownloadedFileManifestEntry(
  dataDirectory: string,
  artifactPath: string,
  body: string,
): DownloadedFileManifestEntry {
  return {
    path: relative(dataDirectory, artifactPath),
    byte_count: Buffer.byteLength(body, 'utf8'),
    checksum_sha256: sha256(body),
    fetched_at: new Date().toISOString(),
  };
}

function extractLegislatorBioguideIds(records: ParsedLegislatorRecord[]): string[] {
  return records
    .map((record) => record.id.bioguide)
    .filter((bioguide): bioguide is string => typeof bioguide === 'string' && bioguide.length > 0);
}

function parseLegislatorYamlRecords(yaml: string): ParsedLegislatorRecord[] {
  const records = splitTopLevelYamlRecords(yaml);
  return records.map((record) => ({
    id: {
      bioguide: matchScalar(record, /^\s*bioguide:\s*(.+?)\s*$/m),
    },
    name: {
      official_full: matchScalar(record, /^\s*official_full:\s*(.+?)\s*$/m),
    },
  }));
}

function parseCommitteeYamlRecords(yaml: string): ParsedCommitteeRecord[] {
  const records = splitTopLevelYamlRecords(yaml);
  return records.map((record) => ({
    thomas_id: matchScalar(record, /^\s*thomas_id:\s*(.+?)\s*$/m),
    name: matchScalar(record, /^\s*name:\s*(.+?)\s*$/m),
  }));
}

function splitTopLevelYamlRecords(yaml: string): string[] {
  const normalized = yaml.replace(/\r\n/g, '\n').trim();
  if (normalized.length === 0) {
    return [];
  }

  return normalized
    .split(/^-(?=\s|$)/m)
    .map((record) => record.trim())
    .filter((record) => record.length > 0);
}

function matchScalar(block: string, pattern: RegExp): string | null {
  const match = block.match(pattern);
  if (match === null) {
    return null;
  }

  const value = match[1]?.trim();
  if (value === undefined || value.length === 0) {
    return null;
  }

  return value.replace(/^['"]|['"]$/g, '');
}

async function recordFailure(code: string, message: string): Promise<void> {
  const manifest = await readManifest();
  manifest.sources.legislators.last_failure = { code, message };
  await writeManifest(manifest);
}

function deriveSkippedCrossReferenceState(
  status: 'missing' | 'complete' | 'incomplete' | 'stale',
  snapshotId: string | null,
): LegislatorsCrossReferenceState {
  return {
    status:
      status === 'stale'
        ? 'skipped_stale_congress_snapshot'
        : status === 'incomplete'
          ? 'skipped_incomplete_congress_snapshot'
          : 'skipped_missing_congress_cache',
    based_on_snapshot_id: snapshotId,
    crosswalk_artifact_id: null,
    matched_bioguide_ids: 0,
    unmatched_legislator_bioguide_ids: 0,
    unmatched_congress_bioguide_ids: 0,
    updated_at: new Date().toISOString(),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
