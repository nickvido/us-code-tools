import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveCurrentCongressScope, type CurrentCongressResolution } from '../utils/fetch-config.js';
import { getCachePaths, readFreshRawResponseCache, writeRawResponseCache } from '../utils/cache.js';
import { createRateLimitState, isRateLimitExhausted, markRateLimitUse } from '../utils/rate-limit.js';
import { readManifest, writeManifest, type CongressRunState, type FetchManifest } from '../utils/manifest.js';
import { logNetworkEvent } from '../utils/logger.js';
import { evaluateCongressMemberSnapshotFreshness } from './congress-member-snapshot.js';

export interface FetchInvocation { force: boolean; congress: number | null; mode?: 'single' | 'all'; }
export interface FetchSourceResult {
  source: 'congress'; ok: boolean; requested_scope: { congress: number | string | null };
  bulk_scope: { congress: CurrentCongressResolution } | null; rate_limit_exhausted: boolean; next_request_at: string | null;
  counts?: { bill_pages: number; bill_details: number; bill_actions: number; bill_cosponsors: number; committee_pages: number; member_pages: number; member_details: number };
  error?: { code: string; message: string };
}
interface CongressBillListPayload { bills?: Array<{ number?: string | number; type?: string; congress?: number }>; pagination?: { next?: string | null } }
interface CongressMemberListPayload { members?: Array<{ bioguideId?: string }>; pagination?: { next?: string | null } }
const SHARED_LIMIT = 5_000; const SHARED_WINDOW_MS = 60 * 60 * 1000; const CONGRESS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; const DOWNLOAD_TIMEOUT_MS = 500; const sharedLimiter = createRateLimitState(SHARED_LIMIT, SHARED_WINDOW_MS);

export async function fetchCongressSource(invocation: FetchInvocation): Promise<FetchSourceResult> {
  const mode = invocation.mode ?? 'single';
  const bulkScope = mode === 'all' ? { congress: await resolveCurrentCongressScope() } : null;
  const requestedScope = mode === 'all' && invocation.congress === null ? `93..${bulkScope?.congress.current ?? 93}` : invocation.congress;
  if (!process.env.API_DATA_GOV_KEY) return { source:'congress', ok:false, requested_scope:{ congress: requestedScope }, bulk_scope: bulkScope, rate_limit_exhausted:false, next_request_at:null, error:{ code:'missing_api_data_gov_key', message:'API_DATA_GOV_KEY is required for Congress.gov fetches' } };
  try {
    const { sourceDirectory } = getCachePaths('congress'); await mkdir(sourceDirectory, { recursive: true });
    const manifest = await readManifest(); if (bulkScope) manifest.sources.congress.bulk_scope = { congress: bulkScope.congress };
    const requestedCongresses = resolveRequestedCongresses(invocation, bulkScope, manifest);
    if (invocation.mode === 'all' && invocation.congress === null) {
      manifest.sources.congress.bulk_history_checkpoint = {
        scope: 'all',
        current: bulkScope?.congress.current ?? requestedCongresses.at(-1) ?? 93,
        start: 93,
        next_congress: requestedCongresses[0] ?? null,
        updated_at: new Date().toISOString(),
      };
    }
    const memberSnapshot = await ensureMemberSnapshot({ force: invocation.force, manifest, sourceDirectory });
    if (!memberSnapshot.ok) { await recordFailure(manifest, memberSnapshot.error.code, memberSnapshot.error.message); return { source:'congress', ok:false, requested_scope:{ congress: requestedScope }, bulk_scope: bulkScope, rate_limit_exhausted: memberSnapshot.rate_limit_exhausted, next_request_at: memberSnapshot.next_request_at, error: memberSnapshot.error }; }
    const counts = { bill_pages:0, bill_details:0, bill_actions:0, bill_cosponsors:0, committee_pages:0, member_pages:memberSnapshot.counts.member_pages, member_details:memberSnapshot.counts.member_details };
    for (const congress of requestedCongresses) {
      const congressCounts = await fetchSingleCongress({ congress, sourceDirectory, force: invocation.force || (invocation.mode === 'all' && invocation.congress !== null) });
      counts.bill_pages += congressCounts.bill_pages; counts.bill_details += congressCounts.bill_details; counts.bill_actions += congressCounts.bill_actions; counts.bill_cosponsors += congressCounts.bill_cosponsors; counts.committee_pages += congressCounts.committee_pages;
      manifest.sources.congress.congress_runs[String(congress)] = { congress, completed_at: new Date().toISOString(), bill_page_count: congressCounts.bill_pages, bill_detail_count: congressCounts.bill_details, bill_action_count: congressCounts.bill_actions, bill_cosponsor_count: congressCounts.bill_cosponsors, committee_page_count: congressCounts.committee_pages, failed_bills: [] } satisfies CongressRunState;
      manifest.sources.congress.last_success_at = new Date().toISOString(); manifest.sources.congress.last_failure = null;
      if (invocation.mode === 'all' && invocation.congress === null) {
        const nextCongress = requestedCongresses.find((candidate) => candidate > congress) ?? null;
        manifest.sources.congress.bulk_history_checkpoint = {
          scope: 'all',
          current: bulkScope?.congress.current ?? requestedCongresses.at(-1) ?? congress,
          start: 93,
          next_congress: nextCongress,
          updated_at: new Date().toISOString(),
        };
      }
      await writeManifest(manifest);
    }
    if (invocation.mode === 'all' && invocation.congress === null) {
      manifest.sources.congress.bulk_history_checkpoint = null;
      await writeManifest(manifest);
    }
    return { source:'congress', ok:true, requested_scope:{ congress: requestedScope }, bulk_scope: bulkScope, rate_limit_exhausted:false, next_request_at:null, counts };
  } catch (error) {
    const normalized = normalizeError(error); const failureManifest = await readManifest(); await recordFailure(failureManifest, normalized.code, normalized.message);
    return { source:'congress', ok:false, requested_scope:{ congress: requestedScope }, bulk_scope: bulkScope, rate_limit_exhausted: normalized.code === 'rate_limit_exhausted', next_request_at: normalized.next_request_at, error:{ code: normalized.code, message: normalized.message } };
  }
}

async function ensureMemberSnapshot(args:{ force:boolean; manifest:FetchManifest; sourceDirectory:string }): Promise<{ ok:true; counts:{ member_pages:number; member_details:number } } | { ok:false; rate_limit_exhausted:boolean; next_request_at:string|null; error:{ code:string; message:string } }> {
  const snapshotFreshness = await evaluateCongressMemberSnapshotFreshness(args.manifest.sources.congress.member_snapshot, args.sourceDirectory);
  if (!args.force && snapshotFreshness.isReusable) return { ok:true, counts:{ member_pages:0, member_details:0 } };
  const apiKey = process.env.API_DATA_GOV_KEY ?? ''; const snapshotId = `snapshot-${Date.now()}`; const snapshotDirectory = resolve(args.sourceDirectory, 'members', 'snapshots', snapshotId); const pagesDirectory = resolve(snapshotDirectory, 'pages'); const detailsDirectory = resolve(snapshotDirectory, 'details');
  await mkdir(pagesDirectory, { recursive: true }); await mkdir(detailsDirectory, { recursive: true });
  const pageArtifacts: string[] = []; const memberIds: string[] = []; let pageUrl: string | null = `https://api.congress.gov/v3/member?api_key=${encodeURIComponent(apiKey)}`; let pageIndex = 0;
  while (pageUrl !== null) {
    pageIndex += 1; const membersPage: { payload: CongressMemberListPayload } = await fetchCongressJson<CongressMemberListPayload>(pageUrl, { force: args.force }); const artifactRelative = resolve('members', 'snapshots', snapshotId, 'pages', `page-${pageIndex}.json`); const artifactAbsolute = resolve(pagesDirectory, `page-${pageIndex}.json`);
    await writeFile(artifactAbsolute, JSON.stringify(membersPage.payload), { encoding:'utf8', mode:0o640 }); pageArtifacts.push(artifactRelative);
    for (const member of membersPage.payload.members ?? []) { if (typeof member.bioguideId === 'string' && member.bioguideId.length > 0) memberIds.push(member.bioguideId); }
    pageUrl = typeof membersPage.payload.pagination?.next === 'string' && membersPage.payload.pagination.next.length > 0 ? appendApiKey(membersPage.payload.pagination.next, apiKey) : null;
  }
  const uniqueMemberIds = [...new Set(memberIds)]; const detailArtifacts = [...pageArtifacts]; let memberDetailCount = 0;
  for (const bioguideId of uniqueMemberIds) { const detail = await fetchCongressText(appendApiKey(`https://api.congress.gov/v3/member/${bioguideId}`, apiKey), { force: args.force }); await writeFile(resolve(detailsDirectory, `${bioguideId}.json`), detail.body, { encoding:'utf8', mode:0o640 }); detailArtifacts.push(resolve('members', 'snapshots', snapshotId, 'details', `${bioguideId}.json`)); memberDetailCount += 1; }
  args.manifest.sources.congress.member_snapshot = { snapshot_id: snapshotId, status:'complete', snapshot_completed_at:new Date().toISOString(), cache_ttl_ms:CONGRESS_CACHE_TTL_MS, member_page_count:pageIndex, member_detail_count:memberDetailCount, failed_member_details:[], artifacts: detailArtifacts };
  await writeManifest(args.manifest);
  return { ok:true, counts:{ member_pages:pageIndex, member_details:memberDetailCount } };
}

function resolveRequestedCongresses(invocation: FetchInvocation, bulkScope:{ congress: CurrentCongressResolution } | null, manifest: FetchManifest): number[] {
  if (invocation.congress !== null) {
    return [invocation.congress];
  }

  if (invocation.mode === 'all') {
    const checkpoint = !invocation.force ? manifest.sources.congress.bulk_history_checkpoint : null;
    const startCongress = checkpoint?.next_congress ?? 93;
    const result:number[] = [];
    for (let congress = startCongress; congress <= (bulkScope?.congress.current ?? 93); congress += 1) {
      if (!invocation.force && checkpoint === null && manifest.sources.congress.congress_runs[String(congress)]?.completed_at) {
        continue;
      }
      result.push(congress);
    }
    return result;
  }

  return [93];
}

async function fetchSingleCongress(args:{ congress:number; sourceDirectory:string; force:boolean }): Promise<{ bill_pages:number; bill_details:number; bill_actions:number; bill_cosponsors:number; committee_pages:number }> {
  const apiKey = process.env.API_DATA_GOV_KEY ?? ''; const billsDirectory = resolve(args.sourceDirectory, 'bills', String(args.congress), 'pages'); const committeesDirectory = resolve(args.sourceDirectory, 'committees', String(args.congress), 'pages'); await mkdir(billsDirectory, { recursive: true }); await mkdir(committeesDirectory, { recursive: true });
  const bills: Array<{ type:string; number:string }> = []; let billPageCount = 0; let billPageUrl: string | null = `https://api.congress.gov/v3/bill/${args.congress}?api_key=${encodeURIComponent(apiKey)}`;
  while (billPageUrl !== null) { billPageCount += 1; const page: { payload: CongressBillListPayload } = await fetchCongressJson<CongressBillListPayload>(billPageUrl, { force: args.force }); await writeFile(resolve(billsDirectory, `page-${billPageCount}.json`), JSON.stringify(page.payload), { encoding:'utf8', mode:0o640 }); for (const bill of page.payload.bills ?? []) bills.push({ type: typeof bill.type === 'string' && bill.type.length > 0 ? bill.type : 'hr', number: String(bill.number ?? '1') }); billPageUrl = typeof page.payload.pagination?.next === 'string' && page.payload.pagination.next.length > 0 ? appendApiKey(page.payload.pagination.next, apiKey) : null; }
  let committeePageCount = 0; let committeePageUrl: string | null = `https://api.congress.gov/v3/committee/${args.congress}?api_key=${encodeURIComponent(apiKey)}`;
  while (committeePageUrl !== null) { committeePageCount += 1; const page = await fetchCongressText(committeePageUrl, { force: args.force }); await writeFile(resolve(committeesDirectory, `page-${committeePageCount}.json`), page.body, { encoding:'utf8', mode:0o640 }); const parsed = JSON.parse(page.body) as { pagination?: { next?: string | null } }; committeePageUrl = typeof parsed.pagination?.next === 'string' && parsed.pagination.next.length > 0 ? appendApiKey(parsed.pagination.next, apiKey) : null; }
  let billDetails = 0; let billActions = 0; let billCosponsors = 0;
  for (const bill of bills) {
    const baseDirectory = resolve(args.sourceDirectory, 'bills', String(args.congress), bill.type, bill.number); await mkdir(baseDirectory, { recursive: true });
    const detailUrl = `https://api.congress.gov/v3/bill/${args.congress}/${bill.type}/${bill.number}`;
    const detail = await fetchCongressTextWithFallback(appendApiKey(detailUrl, apiKey), detailUrl, { force: args.force });
    const actions = await fetchCongressText(appendApiKey(`https://api.congress.gov/v3/bill/${args.congress}/${bill.type}/${bill.number}/actions`, apiKey), { force: args.force });
    const cosponsors = await fetchCongressText(appendApiKey(`https://api.congress.gov/v3/bill/${args.congress}/${bill.type}/${bill.number}/cosponsors`, apiKey), { force: args.force });
    await writeFile(resolve(baseDirectory, 'detail.json'), detail.body, { encoding:'utf8', mode:0o640 }); await writeFile(resolve(baseDirectory, 'actions.json'), actions.body, { encoding:'utf8', mode:0o640 }); await writeFile(resolve(baseDirectory, 'cosponsors.json'), cosponsors.body, { encoding:'utf8', mode:0o640 });
    billDetails += 1; billActions += 1; billCosponsors += 1;
  }
  return { bill_pages: billPageCount, bill_details: billDetails, bill_actions: billActions, bill_cosponsors: billCosponsors, committee_pages: committeePageCount };
}

async function fetchCongressJson<T>(url: string, options: { force: boolean }): Promise<{ payload: T }> { const response = await fetchCongressResponse(url, options); return { payload: JSON.parse(response.body) as T }; }
async function fetchCongressText(url: string, options: { force: boolean }): Promise<{ body: string }> { const response = await fetchCongressResponse(url, options); return { body: response.body }; }
async function fetchCongressTextWithFallback(primaryUrl: string, fallbackUrl: string, options: { force: boolean }): Promise<{ body: string }> { try { return await fetchCongressText(primaryUrl, options); } catch (error) { if (canFallbackToBareUrl(error)) return await fetchCongressText(fallbackUrl, options); throw error; } }
async function fetchCongressResponse(url: string, options: { force: boolean }): Promise<{ body: string }> { const startedAt = Date.now(); if (!options.force) { const cached = await readFreshRawResponseCache('congress', url, CONGRESS_CACHE_TTL_MS); if (cached !== null) { logNetworkEvent({ level:'info', event:'network.request', source:'congress', method:'GET', url, attempt:1, cache_status:'hit', duration_ms:Date.now() - startedAt, status_code:cached.metadata.status_code }); return { body: cached.body }; } }
  const exhaustion = isRateLimitExhausted(sharedLimiter); if (exhaustion.exhausted) throw createRateLimitError(exhaustion.nextRequestAt); markRateLimitUse(sharedLimiter); const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS); try { const response = await fetch(url, { signal: controller.signal }); const body = await response.text(); logNetworkEvent({ level:'info', event:'network.request', source:'congress', method:'GET', url, attempt:1, cache_status: options.force ? 'bypass' : 'miss', duration_ms:Date.now() - startedAt, status_code:response.status }); if (response.status === 401 || response.status === 403) throw new Error('upstream_auth_rejected: Congress.gov rejected API_DATA_GOV_KEY'); if (!response.ok) throw new Error(`upstream_request_failed: Congress.gov request failed with HTTP ${response.status}`); await writeRawResponseCache('congress', url, body, { statusCode: response.status, contentType: response.headers.get('content-type') }); return { body }; } catch (error) { if (!(error instanceof Error && error.message.startsWith('upstream_auth_rejected:')) && !(error instanceof Error && error.message.startsWith('upstream_request_failed:'))) { logNetworkEvent({ level:'error', event:'network.request', source:'congress', method:'GET', url, attempt:1, cache_status: options.force ? 'bypass' : 'miss', duration_ms:Date.now() - startedAt }); } throw error; } finally { clearTimeout(timeout); } }
function appendApiKey(url: string, apiKey: string): string { const parsed = new URL(url); if (!parsed.searchParams.has('api_key')) parsed.searchParams.set('api_key', apiKey); return parsed.toString(); }
function canFallbackToBareUrl(error: unknown): boolean { return error instanceof Error && /Unexpected Congress (URL|bulk-resume URL)/.test(error.message); }
function createRateLimitError(nextRequestAt: number | null): Error & { code:'rate_limit_exhausted'; nextRequestAt:number|null } { const error = new Error('Shared Congress/GovInfo budget exhausted before completion') as Error & { code:'rate_limit_exhausted'; nextRequestAt:number|null }; error.code='rate_limit_exhausted'; error.nextRequestAt=nextRequestAt; return error; }
function normalizeError(error: unknown): { code:string; message:string; next_request_at:string|null } { if (error instanceof Error && 'code' in error && error.code === 'rate_limit_exhausted') { const nextRequestAt = 'nextRequestAt' in error && typeof error.nextRequestAt === 'number' ? new Date(error.nextRequestAt).toISOString() : null; return { code:'rate_limit_exhausted', message:error.message, next_request_at:nextRequestAt }; } if (error instanceof Error && error.message.startsWith('upstream_auth_rejected:')) return { code:'upstream_auth_rejected', message:error.message, next_request_at:null }; return { code:'upstream_request_failed', message:error instanceof Error ? error.message : 'Congress fetch failed', next_request_at:null }; }
async function recordFailure(manifest: FetchManifest, code:string, message:string): Promise<void> { manifest.sources.congress.last_failure = { code, message }; await writeManifest(manifest); }
