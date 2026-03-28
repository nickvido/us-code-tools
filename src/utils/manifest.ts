import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type SourceName = 'olrc' | 'congress' | 'govinfo' | 'voteview' | 'legislators';

export interface FailureSummary {
  code: string;
  message: string;
}

export interface SourceStatusSummary {
  last_success_at: string | null;
  last_failure: FailureSummary | null;
}

export interface CongressMemberSnapshotState {
  snapshot_id: string | null;
  status: 'missing' | 'complete' | 'incomplete' | 'stale';
  snapshot_completed_at: string | null;
  cache_ttl_ms: number | null;
  member_page_count: number;
  member_detail_count: number;
  failed_member_details: string[];
  artifacts: string[];
}

export interface CongressRunState {
  congress: number;
  completed_at: string | null;
  bill_page_count: number;
  bill_detail_count: number;
  bill_action_count: number;
  bill_cosponsor_count: number;
  committee_page_count: number;
  failed_bills: string[];
}

export interface CongressBulkHistoryCheckpoint {
  scope: 'all';
  current: number | null;
  start: 93;
  next_congress: number | null;
  updated_at: string | null;
}

export interface CongressManifestState extends SourceStatusSummary {
  bulk_scope: {
    congress: {
      start: number;
      current: number;
      resolution: 'live' | 'override' | 'fallback';
      fallback_value: number | null;
      operator_review_required: boolean;
    };
  } | null;
  member_snapshot: CongressMemberSnapshotState;
  congress_runs: Record<string, CongressRunState>;
  bulk_history_checkpoint: CongressBulkHistoryCheckpoint | null;
}

export interface GovInfoQueryScopeState {
  query_scope: 'unfiltered' | `congress=${number}`;
  termination: 'complete' | 'rate_limit_exhausted';
  listed_package_count: number;
  retained_package_count: number;
  summary_count: number;
  granule_count: number;
  malformed_package_ids: string[];
  completed_at: string | null;
}

export interface GovInfoCheckpointState {
  query_scope: 'unfiltered' | `congress=${number}`;
  next_page_url: string | null;
  retained_not_finalized: string[];
  finalized_package_ids: string[];
  updated_at: string;
}

export interface GovInfoManifestState extends SourceStatusSummary {
  query_scopes: Record<string, GovInfoQueryScopeState>;
  checkpoints: Record<string, GovInfoCheckpointState>;
}

export interface LegislatorsCrossReferenceState {
  status:
    | 'completed'
    | 'skipped_missing_congress_cache'
    | 'skipped_stale_congress_snapshot'
    | 'skipped_incomplete_congress_snapshot';
  based_on_snapshot_id: string | null;
  crosswalk_artifact_id: string | null;
  matched_bioguide_ids: number;
  unmatched_legislator_bioguide_ids: number;
  unmatched_congress_bioguide_ids: number;
  updated_at: string | null;
}

export interface DownloadedFileManifestEntry {
  path: string;
  byte_count: number;
  checksum_sha256: string;
  fetched_at: string;
}

export interface LegislatorsManifestState extends SourceStatusSummary {
  files: Record<string, DownloadedFileManifestEntry>;
  cross_reference: LegislatorsCrossReferenceState;
}

export interface FetchManifest {
  version: 1;
  updated_at: string;
  sources: {
    olrc: SourceStatusSummary & { selected_vintage?: string | null; titles?: Record<string, unknown> };
    congress: CongressManifestState;
    govinfo: GovInfoManifestState;
    voteview: SourceStatusSummary & { files?: Record<string, unknown>; indexes?: unknown[] };
    legislators: LegislatorsManifestState;
  };
  runs: unknown[];
}

export function createEmptyManifest(): FetchManifest {
  return {
    version: 1,
    updated_at: new Date(0).toISOString(),
    sources: {
      olrc: { selected_vintage: null, last_success_at: null, last_failure: null, titles: {} },
      congress: {
        last_success_at: null,
        last_failure: null,
        bulk_scope: null,
        member_snapshot: {
          snapshot_id: null,
          status: 'missing',
          snapshot_completed_at: null,
          cache_ttl_ms: null,
          member_page_count: 0,
          member_detail_count: 0,
          failed_member_details: [],
          artifacts: [],
        },
        congress_runs: {},
        bulk_history_checkpoint: null,
      },
      govinfo: {
        last_success_at: null,
        last_failure: null,
        query_scopes: {},
        checkpoints: {},
      },
      voteview: { last_success_at: null, last_failure: null, files: {}, indexes: [] },
      legislators: {
        last_success_at: null,
        last_failure: null,
        files: {},
        cross_reference: {
          status: 'skipped_missing_congress_cache',
          based_on_snapshot_id: null,
          crosswalk_artifact_id: null,
          matched_bioguide_ids: 0,
          unmatched_legislator_bioguide_ids: 0,
          unmatched_congress_bioguide_ids: 0,
          updated_at: null,
        },
      },
    },
    runs: [],
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

    throw error instanceof Error ? error : new Error('Manifest read failed with a non-Error value');
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
      olrc: normalizeOlrcState(parsed.sources.olrc),
      congress: normalizeCongressState(parsed.sources.congress),
      govinfo: normalizeGovInfoState(parsed.sources.govinfo),
      voteview: normalizeVoteviewState(parsed.sources.voteview),
      legislators: normalizeLegislatorsState(parsed.sources.legislators),
    },
    runs: Array.isArray(parsed.runs) ? parsed.runs : [],
  };
}

function normalizeOlrcState(value: unknown): FetchManifest['sources']['olrc'] {
  const base = normalizeSourceStatus(value);
  const candidate = isObject(value) ? value : null;

  return {
    ...base,
    selected_vintage: typeof candidate?.selected_vintage === 'string' || candidate?.selected_vintage === null
      ? (candidate.selected_vintage as string | null)
      : null,
    titles: isObject(candidate?.titles) ? candidate.titles : {},
  };
}

function normalizeCongressState(value: unknown): CongressManifestState {
  const base = normalizeSourceStatus(value);
  const candidate = isObject(value) ? value : null;

  return {
    ...base,
    bulk_scope: normalizeBulkScope(candidate?.bulk_scope),
    member_snapshot: normalizeMemberSnapshot(candidate?.member_snapshot),
    congress_runs: normalizeCongressRuns(candidate?.congress_runs),
    bulk_history_checkpoint: normalizeBulkHistoryCheckpoint(candidate?.bulk_history_checkpoint),
  };
}

function normalizeGovInfoState(value: unknown): GovInfoManifestState {
  const base = normalizeSourceStatus(value);
  const candidate = isObject(value) ? value : null;

  return {
    ...base,
    query_scopes: normalizeGovInfoQueryScopes(candidate?.query_scopes),
    checkpoints: normalizeGovInfoCheckpoints(candidate?.checkpoints),
  };
}

function normalizeVoteviewState(value: unknown): FetchManifest['sources']['voteview'] {
  const base = normalizeSourceStatus(value);
  const candidate = isObject(value) ? value : null;

  return {
    ...base,
    files: isObject(candidate?.files) ? candidate.files : {},
    indexes: Array.isArray(candidate?.indexes) ? candidate.indexes : [],
  };
}

function normalizeLegislatorsState(value: unknown): LegislatorsManifestState {
  const base = normalizeSourceStatus(value);
  const candidate = isObject(value) ? value : null;

  return {
    ...base,
    files: normalizeDownloadedFiles(candidate?.files),
    cross_reference: normalizeCrossReference(candidate?.cross_reference),
  };
}

function normalizeSourceStatus(value: unknown): SourceStatusSummary {
  if (!isObject(value)) {
    return { last_success_at: null, last_failure: null };
  }

  return {
    last_success_at: typeof value.last_success_at === 'string' || value.last_success_at === null
      ? (value.last_success_at as string | null)
      : null,
    last_failure: isFailure(value.last_failure) ? value.last_failure : null,
  };
}

function normalizeBulkScope(value: unknown): CongressManifestState['bulk_scope'] {
  if (!isObject(value) || !isObject(value.congress)) {
    return null;
  }

  const congress = value.congress;
  return {
    congress: {
      start: toPositiveInteger(congress.start) ?? 93,
      current: toPositiveInteger(congress.current) ?? 93,
      resolution:
        congress.resolution === 'live' || congress.resolution === 'override' || congress.resolution === 'fallback'
          ? congress.resolution
          : 'fallback',
      fallback_value: toNullablePositiveInteger(congress.fallback_value),
      operator_review_required: typeof congress.operator_review_required === 'boolean'
        ? congress.operator_review_required
        : false,
    },
  };
}

function normalizeMemberSnapshot(value: unknown): CongressMemberSnapshotState {
  if (!isObject(value)) {
    return createEmptyManifest().sources.congress.member_snapshot;
  }

  return {
    snapshot_id: typeof value.snapshot_id === 'string' || value.snapshot_id === null ? (value.snapshot_id as string | null) : null,
    status:
      value.status === 'complete' || value.status === 'incomplete' || value.status === 'stale' || value.status === 'missing'
        ? value.status
        : 'missing',
    snapshot_completed_at:
      typeof value.snapshot_completed_at === 'string' || value.snapshot_completed_at === null
        ? (value.snapshot_completed_at as string | null)
        : null,
    cache_ttl_ms: typeof value.cache_ttl_ms === 'number' ? value.cache_ttl_ms : null,
    member_page_count: toNonNegativeInteger(value.member_page_count),
    member_detail_count: toNonNegativeInteger(value.member_detail_count),
    failed_member_details: toStringArray(value.failed_member_details),
    artifacts: toStringArray(value.artifacts),
  };
}

function normalizeCongressRuns(value: unknown): Record<string, CongressRunState> {
  if (!isObject(value)) {
    return {};
  }

  const normalized: Record<string, CongressRunState> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isObject(entry)) {
      continue;
    }

    normalized[key] = {
      congress: toPositiveInteger(entry.congress) ?? (Number.parseInt(key, 10) || 93),
      completed_at: typeof entry.completed_at === 'string' || entry.completed_at === null ? (entry.completed_at as string | null) : null,
      bill_page_count: toNonNegativeInteger(entry.bill_page_count),
      bill_detail_count: toNonNegativeInteger(entry.bill_detail_count),
      bill_action_count: toNonNegativeInteger(entry.bill_action_count),
      bill_cosponsor_count: toNonNegativeInteger(entry.bill_cosponsor_count),
      committee_page_count: toNonNegativeInteger(entry.committee_page_count),
      failed_bills: toStringArray(entry.failed_bills),
    };
  }

  return normalized;
}

function normalizeBulkHistoryCheckpoint(value: unknown): CongressBulkHistoryCheckpoint | null {
  if (!isObject(value)) {
    return null;
  }

  return {
    scope: 'all',
    current: toNullablePositiveInteger(value.current),
    start: 93,
    next_congress: toNullablePositiveInteger(value.next_congress),
    updated_at: typeof value.updated_at === 'string' || value.updated_at === null ? (value.updated_at as string | null) : null,
  };
}

function normalizeGovInfoQueryScopes(value: unknown): Record<string, GovInfoQueryScopeState> {
  if (!isObject(value)) {
    return {};
  }

  const normalized: Record<string, GovInfoQueryScopeState> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isObject(entry)) {
      continue;
    }

    normalized[key] = {
      query_scope: isGovInfoScope(entry.query_scope) ? entry.query_scope : coerceGovInfoScope(key),
      termination: entry.termination === 'rate_limit_exhausted' ? 'rate_limit_exhausted' : 'complete',
      listed_package_count: toNonNegativeInteger(entry.listed_package_count),
      retained_package_count: toNonNegativeInteger(entry.retained_package_count),
      summary_count: toNonNegativeInteger(entry.summary_count),
      granule_count: toNonNegativeInteger(entry.granule_count),
      malformed_package_ids: toStringArray(entry.malformed_package_ids),
      completed_at: typeof entry.completed_at === 'string' || entry.completed_at === null ? (entry.completed_at as string | null) : null,
    };
  }

  return normalized;
}

function normalizeGovInfoCheckpoints(value: unknown): Record<string, GovInfoCheckpointState> {
  if (!isObject(value)) {
    return {};
  }

  const normalized: Record<string, GovInfoCheckpointState> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isObject(entry)) {
      continue;
    }

    normalized[key] = {
      query_scope: isGovInfoScope(entry.query_scope) ? entry.query_scope : coerceGovInfoScope(key),
      next_page_url: typeof entry.next_page_url === 'string' || entry.next_page_url === null ? (entry.next_page_url as string | null) : null,
      retained_not_finalized: toStringArray(entry.retained_not_finalized),
      finalized_package_ids: toStringArray(entry.finalized_package_ids),
      updated_at: typeof entry.updated_at === 'string' ? entry.updated_at : new Date(0).toISOString(),
    };
  }

  return normalized;
}

function normalizeDownloadedFiles(value: unknown): Record<string, DownloadedFileManifestEntry> {
  if (!isObject(value)) {
    return {};
  }

  const normalized: Record<string, DownloadedFileManifestEntry> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isObject(entry)) {
      continue;
    }

    const path = typeof entry.path === 'string' ? entry.path : null;
    const checksum = typeof entry.checksum_sha256 === 'string' ? entry.checksum_sha256 : null;
    const fetchedAt = typeof entry.fetched_at === 'string' ? entry.fetched_at : null;
    if (path === null || checksum === null || fetchedAt === null) {
      continue;
    }

    normalized[key] = {
      path,
      byte_count: toNonNegativeInteger(entry.byte_count),
      checksum_sha256: checksum,
      fetched_at: fetchedAt,
    };
  }

  return normalized;
}

function normalizeCrossReference(value: unknown): LegislatorsCrossReferenceState {
  if (!isObject(value)) {
    return createEmptyManifest().sources.legislators.cross_reference;
  }

  return {
    status:
      value.status === 'completed'
      || value.status === 'skipped_missing_congress_cache'
      || value.status === 'skipped_stale_congress_snapshot'
      || value.status === 'skipped_incomplete_congress_snapshot'
        ? value.status
        : 'skipped_missing_congress_cache',
    based_on_snapshot_id:
      typeof value.based_on_snapshot_id === 'string' || value.based_on_snapshot_id === null
        ? (value.based_on_snapshot_id as string | null)
        : null,
    crosswalk_artifact_id:
      typeof value.crosswalk_artifact_id === 'string' || value.crosswalk_artifact_id === null
        ? (value.crosswalk_artifact_id as string | null)
        : null,
    matched_bioguide_ids: toNonNegativeInteger(value.matched_bioguide_ids),
    unmatched_legislator_bioguide_ids: toNonNegativeInteger(value.unmatched_legislator_bioguide_ids),
    unmatched_congress_bioguide_ids: toNonNegativeInteger(value.unmatched_congress_bioguide_ids),
    updated_at: typeof value.updated_at === 'string' || value.updated_at === null ? (value.updated_at as string | null) : null,
  };
}

function isFailure(value: unknown): value is FailureSummary {
  return Boolean(
    value
      && typeof value === 'object'
      && 'code' in value
      && 'message' in value
      && typeof value.code === 'string'
      && typeof value.message === 'string',
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function toPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function toNullablePositiveInteger(value: unknown): number | null {
  return value === null ? null : toPositiveInteger(value);
}

function toNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function isGovInfoScope(value: unknown): value is 'unfiltered' | `congress=${number}` {
  return value === 'unfiltered' || (typeof value === 'string' && /^congress=\d+$/.test(value));
}

function coerceGovInfoScope(value: string): 'unfiltered' | `congress=${number}` {
  return isGovInfoScope(value) ? value : 'unfiltered';
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
