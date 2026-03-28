import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { resolve } from 'node:path';
import { resolveCurrentCongressScope, type CurrentCongressResolution } from '../utils/fetch-config.js';
import { getCachePaths } from '../utils/cache.js';
import { createRateLimitState, isRateLimitExhausted, markRateLimitUse } from '../utils/rate-limit.js';
import { readManifest, writeManifest, type CongressRunState, type FetchManifest } from '../utils/manifest.js';

export interface FetchInvocation {
  force: boolean;
  congress: number | null;
  mode?: 'single' | 'all';
}

export interface FetchSourceResult {
  source: 'congress';
  ok: boolean;
  requested_scope: { congress: number | string | null };
  bulk_scope: { congress: CurrentCongressResolution } | null;
  rate_limit_exhausted: boolean;
  next_request_at: string | null;
  counts?: {
    bill_pages: number;
    bill_details: number;
    bill_actions: number;
    bill_cosponsors: number;
    committee_pages: number;
    member_pages: number;
    member_details: number;
  };
  error?: { code: string; message: string };
}

interface CongressBillListPayload {
  bills?: Array<{
    number?: string | number;
    type?: string;
  }>;
  pagination?: {
    next?: string | null;
  };
}

interface CongressMemberListPayload {
  members?: Array<{
    bioguideId?: string;
  }>;
  pagination?: {
    next?: string | null;
  };
}

const SHARED_LIMIT = 5_000;
const SHARED_WINDOW_MS = 60 * 60 * 1000;
const CONGRESS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const sharedLimiter = createRateLimitState(SHARED_LIMIT, SHARED_WINDOW_MS);

export async function fetchCongressSource(invocation: FetchInvocation): Promise<FetchSourceResult> {
  const mode = invocation.mode ?? 'single';
  const bulkScope = mode === 'all' ? { congress: await resolveCurrentCongressScope() } : null;
  const requestedScope = mode === 'all' && invocation.congress === null
    ? `93..${bulkScope?.congress.current ?? 93}`
    : invocation.congress;

  if (!process.env.API_DATA_GOV_KEY) {
    return {
      source: 'congress',
      ok: false,
      requested_scope: { congress: requestedScope },
      bulk_scope: bulkScope,
      rate_limit_exhausted: false,
      next_request_at: null,
      error: {
        code: 'missing_api_data_gov_key',
        message: 'API_DATA_GOV_KEY is required for Congress.gov fetches',
      },
    };
  }

  try {
    const { sourceDirectory } = getCachePaths('congress');
    await mkdir(sourceDirectory, { recursive: true });

    const manifest = await readManifest();
    if (bulkScope !== null) {
      manifest.sources.congress.bulk_scope = { congress: bulkScope.congress };
    }

    const memberSnapshot = await ensureMemberSnapshot({
      force: invocation.force,
      manifest,
      sourceDirectory,
    });

    if (!memberSnapshot.ok) {
      await recordFailure(manifest, memberSnapshot.error.code, memberSnapshot.error.message);
      return {
        source: 'congress',
        ok: false,
        requested_scope: { congress: requestedScope },
        bulk_scope: bulkScope,
        rate_limit_exhausted: memberSnapshot.rate_limit_exhausted,
        next_request_at: memberSnapshot.next_request_at,
        error: memberSnapshot.error,
      };
    }

    const congresses = resolveRequestedCongresses(invocation, bulkScope);
    const counts = {
      bill_pages: 0,
      bill_details: 0,
      bill_actions: 0,
      bill_cosponsors: 0,
      committee_pages: 0,
      member_pages: memberSnapshot.counts.member_pages,
      member_details: memberSnapshot.counts.member_details,
    };

    for (const congress of congresses) {
      if (shouldSkipCompletedCongress(invocation, manifest, congress)) {
        continue;
      }

      if (mode === 'all' && invocation.congress === null) {
        manifest.sources.congress.bulk_history_checkpoint = {
          scope: 'all',
          current: bulkScope?.congress.current ?? congress,
          start: 93,
          next_congress: congress,
          updated_at: new Date().toISOString(),
        };
        await writeManifest(manifest);
      }

      const congressCounts = await fetchSingleCongress({ congress, sourceDirectory });
      counts.bill_pages += congressCounts.bill_pages;
      counts.bill_details += congressCounts.bill_details;
      counts.bill_actions += congressCounts.bill_actions;
      counts.bill_cosponsors += congressCounts.bill_cosponsors;
      counts.committee_pages += congressCounts.committee_pages;

      manifest.sources.congress.congress_runs[String(congress)] = {
        congress,
        completed_at: new Date().toISOString(),
        bill_page_count: congressCounts.bill_pages,
        bill_detail_count: congressCounts.bill_details,
        bill_action_count: congressCounts.bill_actions,
        bill_cosponsor_count: congressCounts.bill_cosponsors,
        committee_page_count: congressCounts.committee_pages,
        failed_bills: [],
      } satisfies CongressRunState;

      if (mode === 'all' && invocation.congress === null) {
        manifest.sources.congress.bulk_history_checkpoint = {
          scope: 'all',
          current: bulkScope?.congress.current ?? congress,
          start: 93,
          next_congress: congress === (bulkScope?.congress.current ?? congress) ? null : congress + 1,
          updated_at: new Date().toISOString(),
        };
      }

      manifest.sources.congress.last_success_at = new Date().toISOString();
      manifest.sources.congress.last_failure = null;
      await writeManifest(manifest);
    }

    return {
      source: 'congress',
      ok: true,
      requested_scope: { congress: requestedScope },
      bulk_scope: bulkScope,
      rate_limit_exhausted: false,
      next_request_at: null,
      counts,
    };
  } catch (error) {
    const normalized = normalizeError(error);
    const failureManifest = await readManifest();
    await recordFailure(failureManifest, normalized.code, normalized.message);
    return {
      source: 'congress',
      ok: false,
      requested_scope: { congress: requestedScope },
      bulk_scope: bulkScope,
      rate_limit_exhausted: normalized.code === 'rate_limit_exhausted',
      next_request_at: normalized.next_request_at,
      error: {
        code: normalized.code,
        message: normalized.message,
      },
    };
  }
}

async function ensureMemberSnapshot(args: {
  force: boolean;
  manifest: FetchManifest;
  sourceDirectory: string;
}): Promise<
  | {
      ok: true;
      counts: { member_pages: number; member_details: number };
    }
  | {
      ok: false;
      rate_limit_exhausted: boolean;
      next_request_at: string | null;
      error: { code: string; message: string };
    }
> {
  const snapshot = args.manifest.sources.congress.member_snapshot;
  const snapshotFreshness = await evaluateMemberSnapshotFreshness(snapshot, args.sourceDirectory);

  if (!args.force && snapshotFreshness.isReusable) {
    return {
      ok: true,
      counts: {
        member_pages: 0,
        member_details: 0,
      },
    };
  }

  if (!args.force) {
    args.manifest.sources.congress.member_snapshot = {
      ...snapshot,
      status: snapshotFreshness.rebuildStatus,
    };
    await writeManifest(args.manifest);
  }

  const apiKey = process.env.API_DATA_GOV_KEY ?? '';
  const snapshotId = `snapshot-${Date.now()}`;
  const snapshotDirectory = resolve(args.sourceDirectory, 'members', 'snapshots', snapshotId);
  const pagesDirectory = resolve(snapshotDirectory, 'pages');
  const detailsDirectory = resolve(snapshotDirectory, 'details');
  await mkdir(pagesDirectory, { recursive: true });
  await mkdir(detailsDirectory, { recursive: true });

  const members = await fetchCongressJson<CongressMemberListPayload>(
    `https://api.congress.gov/v3/member?api_key=${encodeURIComponent(apiKey)}`,
  );
  const memberPageArtifact = resolve(pagesDirectory, 'page-1.json');
  await writeFile(memberPageArtifact, JSON.stringify(members.payload), { encoding: 'utf8', mode: 0o640 });

  const bioguideIds = (members.payload.members ?? [])
    .map((member) => member.bioguideId)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  const artifacts = [resolve('members', 'snapshots', snapshotId, 'pages', 'page-1.json')];
  let memberDetailCount = 0;
  for (const bioguideId of bioguideIds) {
    const detail = await fetchCongressText(`https://api.congress.gov/v3/member/${bioguideId}?api_key=${encodeURIComponent(apiKey)}`);
    const detailArtifact = resolve(detailsDirectory, `${bioguideId}.json`);
    await writeFile(detailArtifact, detail.body, { encoding: 'utf8', mode: 0o640 });
    artifacts.push(resolve('members', 'snapshots', snapshotId, 'details', `${bioguideId}.json`));
    memberDetailCount += 1;
  }

  args.manifest.sources.congress.member_snapshot = {
    snapshot_id: snapshotId,
    status: 'complete',
    snapshot_completed_at: new Date().toISOString(),
    cache_ttl_ms: CONGRESS_CACHE_TTL_MS,
    member_page_count: 1,
    member_detail_count: memberDetailCount,
    failed_member_details: [],
    artifacts,
  };
  await writeManifest(args.manifest);

  return {
    ok: true,
    counts: {
      member_pages: 1,
      member_details: memberDetailCount,
    },
  };
}

async function evaluateMemberSnapshotFreshness(
  snapshot: FetchManifest['sources']['congress']['member_snapshot'],
  sourceDirectory: string,
): Promise<{ isReusable: boolean; rebuildStatus: 'missing' | 'incomplete' | 'stale' }> {
  if (snapshot.status !== 'complete') {
    return {
      isReusable: false,
      rebuildStatus: snapshot.status === 'incomplete' ? 'incomplete' : snapshot.status === 'missing' ? 'missing' : 'stale',
    };
  }

  if (snapshot.snapshot_completed_at === null || snapshot.cache_ttl_ms === null) {
    return { isReusable: false, rebuildStatus: 'stale' };
  }

  const completedAt = Date.parse(snapshot.snapshot_completed_at);
  if (!Number.isFinite(completedAt) || (completedAt + snapshot.cache_ttl_ms) <= Date.now()) {
    return { isReusable: false, rebuildStatus: 'stale' };
  }

  if (snapshot.artifacts.length === 0) {
    return { isReusable: false, rebuildStatus: 'stale' };
  }

  for (const artifact of snapshot.artifacts) {
    try {
      await access(resolve(sourceDirectory, artifact), fsConstants.F_OK);
    } catch {
      return { isReusable: false, rebuildStatus: 'stale' };
    }
  }

  return { isReusable: true, rebuildStatus: 'stale' };
}

function resolveRequestedCongresses(
  invocation: FetchInvocation,
  bulkScope: { congress: CurrentCongressResolution } | null,
): number[] {
  if (invocation.congress !== null) {
    return [invocation.congress];
  }

  if (invocation.mode === 'all') {
    const current = bulkScope?.congress.current ?? 93;
    const congresses: number[] = [];
    for (let congress = 93; congress <= current; congress += 1) {
      congresses.push(congress);
    }
    return congresses;
  }

  return [93];
}

function shouldSkipCompletedCongress(invocation: FetchInvocation, manifest: FetchManifest, congress: number): boolean {
  if (invocation.force || invocation.mode !== 'all' || invocation.congress !== null) {
    return false;
  }

  const checkpoint = manifest.sources.congress.bulk_history_checkpoint;
  if (checkpoint?.next_congress !== null && checkpoint?.next_congress !== undefined) {
    return congress < checkpoint.next_congress;
  }

  const existingRun = manifest.sources.congress.congress_runs[String(congress)];
  return existingRun !== undefined && existingRun.completed_at !== null;
}

async function fetchSingleCongress(args: { congress: number; sourceDirectory: string }): Promise<{
  bill_pages: number;
  bill_details: number;
  bill_actions: number;
  bill_cosponsors: number;
  committee_pages: number;
}> {
  const apiKey = process.env.API_DATA_GOV_KEY ?? '';
  const billList = await fetchCongressJson<CongressBillListPayload>(
    `https://api.congress.gov/v3/bill/${args.congress}?api_key=${encodeURIComponent(apiKey)}`,
  );
  const committeeList = await fetchCongressText(
    `https://api.congress.gov/v3/committee/${args.congress}?api_key=${encodeURIComponent(apiKey)}`,
  );

  await writeFile(resolve(args.sourceDirectory, `bill-list-${args.congress}.json`), JSON.stringify(billList.payload), { encoding: 'utf8', mode: 0o640 });
  await writeFile(resolve(args.sourceDirectory, `committee-list-${args.congress}.json`), committeeList.body, { encoding: 'utf8', mode: 0o640 });

  const bills = (billList.payload.bills ?? []).map((bill) => ({
    type: typeof bill.type === 'string' && bill.type.length > 0 ? bill.type : 'hr',
    number: String(bill.number ?? '1'),
  }));

  let billDetails = 0;
  let billActions = 0;
  let billCosponsors = 0;

  for (const bill of bills) {
    const detail = await fetchCongressText(
      `https://api.congress.gov/v3/bill/${args.congress}/${bill.type}/${bill.number}?api_key=${encodeURIComponent(apiKey)}`,
    );
    const actions = await fetchCongressText(
      `https://api.congress.gov/v3/bill/${args.congress}/${bill.type}/${bill.number}/actions?api_key=${encodeURIComponent(apiKey)}`,
    );
    const cosponsors = await fetchCongressText(
      `https://api.congress.gov/v3/bill/${args.congress}/${bill.type}/${bill.number}/cosponsors?api_key=${encodeURIComponent(apiKey)}`,
    );

    await writeFile(resolve(args.sourceDirectory, `${args.congress}-${bill.type}-${bill.number}-detail.json`), detail.body, { encoding: 'utf8', mode: 0o640 });
    await writeFile(resolve(args.sourceDirectory, `${args.congress}-${bill.type}-${bill.number}-actions.json`), actions.body, { encoding: 'utf8', mode: 0o640 });
    await writeFile(resolve(args.sourceDirectory, `${args.congress}-${bill.type}-${bill.number}-cosponsors.json`), cosponsors.body, { encoding: 'utf8', mode: 0o640 });

    billDetails += 1;
    billActions += 1;
    billCosponsors += 1;
  }

  return {
    bill_pages: 1,
    bill_details: billDetails,
    bill_actions: billActions,
    bill_cosponsors: billCosponsors,
    committee_pages: 1,
  };
}

async function fetchCongressJson<T>(url: string): Promise<{ payload: T }> {
  const response = await fetchCongressResponse(url);
  return {
    payload: await response.json() as T,
  };
}

async function fetchCongressText(url: string): Promise<{ body: string }> {
  const response = await fetchCongressResponse(url);
  return {
    body: await response.text(),
  };
}

async function fetchCongressResponse(url: string): Promise<Response> {
  const exhaustion = isRateLimitExhausted(sharedLimiter);
  if (exhaustion.exhausted) {
    throw createRateLimitError(exhaustion.nextRequestAt);
  }

  markRateLimitUse(sharedLimiter);
  const response = await fetch(url);
  if (response.status === 401 || response.status === 403) {
    throw new Error('upstream_auth_rejected: Congress.gov rejected API_DATA_GOV_KEY');
  }
  if (!response.ok) {
    throw new Error(`upstream_request_failed: Congress.gov request failed with HTTP ${response.status}`);
  }
  return response;
}

function createRateLimitError(nextRequestAt: number | null): Error & { code: 'rate_limit_exhausted'; nextRequestAt: number | null } {
  const error = new Error('Shared Congress/GovInfo budget exhausted before completion') as Error & {
    code: 'rate_limit_exhausted';
    nextRequestAt: number | null;
  };
  error.code = 'rate_limit_exhausted';
  error.nextRequestAt = nextRequestAt;
  return error;
}

function normalizeError(error: unknown): { code: string; message: string; next_request_at: string | null } {
  if (error instanceof Error && 'code' in error && error.code === 'rate_limit_exhausted') {
    const nextRequestAt = 'nextRequestAt' in error && typeof error.nextRequestAt === 'number'
      ? new Date(error.nextRequestAt).toISOString()
      : null;
    return {
      code: 'rate_limit_exhausted',
      message: error.message,
      next_request_at: nextRequestAt,
    };
  }

  if (error instanceof Error && error.message.startsWith('upstream_auth_rejected:')) {
    return { code: 'upstream_auth_rejected', message: error.message, next_request_at: null };
  }

  return {
    code: 'upstream_request_failed',
    message: error instanceof Error ? error.message : 'Congress fetch failed',
    next_request_at: null,
  };
}

async function recordFailure(manifest: FetchManifest, code: string, message: string): Promise<void> {
  manifest.sources.congress.last_failure = { code, message };
  await writeManifest(manifest);
}
