import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveCurrentCongressScope, type CurrentCongressResolution } from '../utils/fetch-config.js';
import { getCachePaths } from '../utils/cache.js';
import { readManifest, writeManifest } from '../utils/manifest.js';

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

export async function fetchCongressSource(invocation: FetchInvocation): Promise<FetchSourceResult> {
  const mode = invocation.mode ?? 'single';
  const bulkScope = mode === 'all'
    ? { congress: await resolveCurrentCongressScope() }
    : null;

  if (!process.env.API_DATA_GOV_KEY) {
    return {
      source: 'congress',
      ok: false,
      requested_scope: { congress: invocation.congress },
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
    const congress = invocation.congress ?? bulkScope?.congress.current ?? 93;
    const { sourceDirectory } = getCachePaths('congress');
    await mkdir(sourceDirectory, { recursive: true });

    const apiKey = process.env.API_DATA_GOV_KEY;
    const billListUrl = `https://api.congress.gov/v3/bill/${congress}?api_key=${encodeURIComponent(apiKey)}`;
    const memberListUrl = `https://api.congress.gov/v3/member?api_key=${encodeURIComponent(apiKey)}`;
    const committeeListUrl = `https://api.congress.gov/v3/committee/${congress}?api_key=${encodeURIComponent(apiKey)}`;

    const [billListResponse, memberListResponse, committeeListResponse] = await Promise.all([
      fetch(billListUrl),
      fetch(memberListUrl),
      fetch(committeeListUrl),
    ]);

    const authRejected = [billListResponse, memberListResponse, committeeListResponse]
      .some((response) => response.status === 401 || response.status === 403);
    if (authRejected) {
      throw new Error('upstream_auth_rejected: Congress.gov rejected API_DATA_GOV_KEY');
    }

    if (!billListResponse.ok || !memberListResponse.ok || !committeeListResponse.ok) {
      throw new Error('Congress.gov listing request failed');
    }

    const billListPayload = await billListResponse.json() as CongressBillListPayload;
    const memberListPayload = await memberListResponse.json() as CongressMemberListPayload;
    const committeeListText = await committeeListResponse.text();

    const bills = (billListPayload.bills ?? []).map((bill) => ({
      type: typeof bill.type === 'string' && bill.type.length > 0 ? bill.type : 'hr',
      number: String(bill.number ?? '1'),
    }));
    const bioguideIds = (memberListPayload.members ?? [])
      .map((member) => member.bioguideId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);

    let billDetails = 0;
    let billActions = 0;
    let billCosponsors = 0;
    for (const bill of bills) {
      const detailUrl = `https://api.congress.gov/v3/bill/${congress}/${bill.type}/${bill.number}?api_key=${encodeURIComponent(apiKey)}`;
      const actionsUrl = `https://api.congress.gov/v3/bill/${congress}/${bill.type}/${bill.number}/actions?api_key=${encodeURIComponent(apiKey)}`;
      const cosponsorsUrl = `https://api.congress.gov/v3/bill/${congress}/${bill.type}/${bill.number}/cosponsors?api_key=${encodeURIComponent(apiKey)}`;
      const [detailResponse, actionsResponse, cosponsorsResponse] = await Promise.all([
        fetch(detailUrl),
        fetch(actionsUrl),
        fetch(cosponsorsUrl),
      ]);

      if (!detailResponse.ok || !actionsResponse.ok || !cosponsorsResponse.ok) {
        throw new Error(`Congress.gov bill finalization failed for ${bill.type}-${bill.number}`);
      }

      await writeFile(resolve(sourceDirectory, `${congress}-${bill.type}-${bill.number}-detail.json`), await detailResponse.text(), { encoding: 'utf8', mode: 0o640 });
      await writeFile(resolve(sourceDirectory, `${congress}-${bill.type}-${bill.number}-actions.json`), await actionsResponse.text(), { encoding: 'utf8', mode: 0o640 });
      await writeFile(resolve(sourceDirectory, `${congress}-${bill.type}-${bill.number}-cosponsors.json`), await cosponsorsResponse.text(), { encoding: 'utf8', mode: 0o640 });
      billDetails += 1;
      billActions += 1;
      billCosponsors += 1;
    }

    let memberDetails = 0;
    for (const bioguideId of bioguideIds) {
      const detailUrl = `https://api.congress.gov/v3/member/${bioguideId}?api_key=${encodeURIComponent(apiKey)}`;
      const detailResponse = await fetch(detailUrl);
      if (!detailResponse.ok) {
        throw new Error(`Congress.gov member detail failed for ${bioguideId}`);
      }
      await writeFile(resolve(sourceDirectory, `member-${bioguideId}.json`), await detailResponse.text(), { encoding: 'utf8', mode: 0o640 });
      memberDetails += 1;
    }

    await writeFile(resolve(sourceDirectory, `bill-list-${congress}.json`), JSON.stringify(billListPayload), { encoding: 'utf8', mode: 0o640 });
    await writeFile(resolve(sourceDirectory, `member-list.json`), JSON.stringify(memberListPayload), { encoding: 'utf8', mode: 0o640 });
    await writeFile(resolve(sourceDirectory, `committee-list-${congress}.json`), committeeListText, { encoding: 'utf8', mode: 0o640 });

    const manifest = await readManifest();
    manifest.sources.congress = {
      last_success_at: new Date().toISOString(),
      last_failure: null,
    };
    await writeManifest(manifest);

    return {
      source: 'congress',
      ok: true,
      requested_scope: { congress: mode === 'all' && invocation.congress === null ? `93..${bulkScope?.congress.current ?? congress}` : congress },
      bulk_scope: bulkScope,
      rate_limit_exhausted: false,
      next_request_at: null,
      counts: {
        bill_pages: 1,
        bill_details: billDetails,
        bill_actions: billActions,
        bill_cosponsors: billCosponsors,
        committee_pages: 1,
        member_pages: 1,
        member_details: memberDetails,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Congress fetch failed';
    const code = message.startsWith('upstream_auth_rejected:') ? 'upstream_auth_rejected' : 'upstream_request_failed';
    await recordFailure(code, message);
    return {
      source: 'congress',
      ok: false,
      requested_scope: { congress: invocation.congress },
      bulk_scope: bulkScope,
      rate_limit_exhausted: false,
      next_request_at: null,
      error: {
        code,
        message,
      },
    };
  }
}

async function recordFailure(code: string, message: string): Promise<void> {
  const manifest = await readManifest();
  manifest.sources.congress = {
    last_success_at: manifest.sources.congress.last_success_at,
    last_failure: { code, message },
  };
  await writeManifest(manifest);
}
