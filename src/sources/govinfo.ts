import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FetchInvocation } from './congress.js';
import { getCachePaths } from '../utils/cache.js';
import { readManifest, writeManifest } from '../utils/manifest.js';

export interface GovInfoResult {
  source: 'govinfo';
  ok: boolean;
  requested_scope: { query_scope: 'unfiltered' | `congress=${number}` };
  rate_limit_exhausted: boolean;
  next_request_at: string | null;
  counts?: {
    listed_packages: number;
    summaries: number;
    granules: number;
  };
  error?: { code: string; message: string };
}

interface GovInfoCollectionPage {
  packages?: Array<{ packageId?: string }>;
  nextPage?: string | null;
}

export async function fetchGovInfoSource(invocation: FetchInvocation): Promise<GovInfoResult> {
  const query_scope = invocation.congress === null ? 'unfiltered' : `congress=${invocation.congress}` as const;

  if (!process.env.API_DATA_GOV_KEY) {
    return {
      source: 'govinfo',
      ok: false,
      requested_scope: { query_scope },
      rate_limit_exhausted: false,
      next_request_at: null,
      error: {
        code: 'missing_api_data_gov_key',
        message: 'API_DATA_GOV_KEY is required for GovInfo fetches',
      },
    };
  }

  try {
    const { sourceDirectory } = getCachePaths('govinfo');
    await mkdir(sourceDirectory, { recursive: true });

    const apiKey = process.env.API_DATA_GOV_KEY;
    const listingUrl = new URL('https://api.govinfo.gov/collections/PLAW');
    listingUrl.searchParams.set('api_key', apiKey);

    const listingResponse = await fetch(listingUrl);
    if (!listingResponse.ok) {
      const errorCode = listingResponse.status === 401 || listingResponse.status === 403
        ? 'upstream_auth_rejected'
        : 'upstream_request_failed';
      throw new Error(`${errorCode}: GovInfo listing failed with HTTP ${listingResponse.status}`);
    }

    const listingPayload = await listingResponse.json() as GovInfoCollectionPage;
    const packageIds = (listingPayload.packages ?? [])
      .map((item) => item.packageId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .filter((value) => matchesCongressFilter(value, invocation.congress));

    let summaryCount = 0;
    let granuleCount = 0;
    for (const packageId of packageIds) {
      const summaryUrl = `https://api.govinfo.gov/packages/${packageId}/summary?api_key=${encodeURIComponent(apiKey)}`;
      const granulesUrl = `https://api.govinfo.gov/packages/${packageId}/granules?api_key=${encodeURIComponent(apiKey)}`;

      const [summaryResponse, granulesResponse] = await Promise.all([fetch(summaryUrl), fetch(granulesUrl)]);
      if (!summaryResponse.ok || !granulesResponse.ok) {
        throw new Error(`GovInfo package finalization failed for ${packageId}`);
      }

      const summaryText = await summaryResponse.text();
      const granulesText = await granulesResponse.text();
      await writeFile(resolve(sourceDirectory, `${packageId}-summary.json`), summaryText, { encoding: 'utf8', mode: 0o640 });
      await writeFile(resolve(sourceDirectory, `${packageId}-granules.json`), granulesText, { encoding: 'utf8', mode: 0o640 });
      summaryCount += 1;
      granuleCount += 1;
    }

    const manifest = await readManifest();
    manifest.sources.govinfo = {
      last_success_at: new Date().toISOString(),
      last_failure: null,
    };
    await writeManifest(manifest);

    return {
      source: 'govinfo',
      ok: true,
      requested_scope: { query_scope },
      rate_limit_exhausted: false,
      next_request_at: null,
      counts: {
        listed_packages: packageIds.length,
        summaries: summaryCount,
        granules: granuleCount,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GovInfo fetch failed';
    const code = message.startsWith('upstream_auth_rejected:') ? 'upstream_auth_rejected' : 'upstream_request_failed';
    await recordFailure(code, message);
    return {
      source: 'govinfo',
      ok: false,
      requested_scope: { query_scope },
      rate_limit_exhausted: false,
      next_request_at: null,
      error: {
        code,
        message,
      },
    };
  }
}

function matchesCongressFilter(packageId: string, congress: number | null): boolean {
  if (congress === null) {
    return true;
  }

  const match = /^PLAW-(\d+)/.exec(packageId);
  return match?.[1] === String(congress);
}

async function recordFailure(code: string, message: string): Promise<void> {
  const manifest = await readManifest();
  manifest.sources.govinfo = {
    last_success_at: manifest.sources.govinfo.last_success_at,
    last_failure: { code, message },
  };
  await writeManifest(manifest);
}
