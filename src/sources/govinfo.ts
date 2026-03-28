import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FetchInvocation } from './congress.js';
import { getCachePaths } from '../utils/cache.js';
import { createRateLimitState, isRateLimitExhausted, markRateLimitUse } from '../utils/rate-limit.js';
import { readManifest, writeManifest, type FetchManifest } from '../utils/manifest.js';

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
  count?: number;
}

const SHARED_LIMIT = 5_000;
const SHARED_WINDOW_MS = 60 * 60 * 1000;
const sharedLimiter = createRateLimitState(SHARED_LIMIT, SHARED_WINDOW_MS);

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

    const manifest = await readManifest();
    const finalizedPackageIds = new Set<string>(manifest.sources.govinfo.checkpoints[query_scope]?.finalized_package_ids ?? []);
    let nextPageUrl = invocation.force ? null : manifest.sources.govinfo.checkpoints[query_scope]?.next_page_url ?? null;
    let listedPackages = 0;
    let summaries = 0;
    let granules = 0;

    if (invocation.force) {
      delete manifest.sources.govinfo.checkpoints[query_scope];
    }

    do {
      const pageUrl = nextPageUrl ?? buildInitialListingUrl();
      const listingResponse = await fetchGovInfoJson<GovInfoCollectionPage>(pageUrl);
      const retainedPackageIds = (listingResponse.payload.packages ?? [])
        .map((item) => item.packageId)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .filter((value) => matchesCongressFilter(value, invocation.congress));

      listedPackages += retainedPackageIds.length;
      nextPageUrl = listingResponse.payload.nextPage ?? null;

      manifest.sources.govinfo.checkpoints[query_scope] = {
        query_scope,
        next_page_url: nextPageUrl,
        retained_not_finalized: retainedPackageIds.filter((packageId) => !finalizedPackageIds.has(packageId)),
        finalized_package_ids: [...finalizedPackageIds],
        updated_at: new Date().toISOString(),
      };
      await writeManifest(manifest);

      for (const packageId of retainedPackageIds) {
        if (finalizedPackageIds.has(packageId)) {
          continue;
        }

        const summary = await fetchGovInfoText(buildPackageUrl(packageId, 'summary'));
        const granulePayload = await fetchGovInfoText(buildPackageUrl(packageId, 'granules'));
        await writeFile(resolve(sourceDirectory, `${packageId}-summary.json`), summary.body, { encoding: 'utf8', mode: 0o640 });
        await writeFile(resolve(sourceDirectory, `${packageId}-granules.json`), granulePayload.body, { encoding: 'utf8', mode: 0o640 });

        summaries += 1;
        granules += 1;
        finalizedPackageIds.add(packageId);

        manifest.sources.govinfo.checkpoints[query_scope] = {
          query_scope,
          next_page_url: nextPageUrl,
          retained_not_finalized: retainedPackageIds.filter((candidate) => !finalizedPackageIds.has(candidate)),
          finalized_package_ids: [...finalizedPackageIds],
          updated_at: new Date().toISOString(),
        };
        await writeManifest(manifest);
      }
    } while (nextPageUrl !== null);

    delete manifest.sources.govinfo.checkpoints[query_scope];
    manifest.sources.govinfo.query_scopes[query_scope] = {
      query_scope,
      termination: 'complete',
      listed_package_count: listedPackages,
      retained_package_count: listedPackages,
      summary_count: summaries,
      granule_count: granules,
      malformed_package_ids: [],
      completed_at: new Date().toISOString(),
    };
    manifest.sources.govinfo.last_success_at = new Date().toISOString();
    manifest.sources.govinfo.last_failure = null;
    await writeManifest(manifest);

    return {
      source: 'govinfo',
      ok: true,
      requested_scope: { query_scope },
      rate_limit_exhausted: false,
      next_request_at: null,
      counts: {
        listed_packages: listedPackages,
        summaries,
        granules,
      },
    };
  } catch (error) {
    const normalized = normalizeError(error);
    const manifest = await readManifest();
    manifest.sources.govinfo.last_failure = { code: normalized.code, message: normalized.message };
    if (normalized.code === 'rate_limit_exhausted') {
      manifest.sources.govinfo.query_scopes[query_scope] = {
        query_scope,
        termination: 'rate_limit_exhausted',
        listed_package_count: 0,
        retained_package_count: 0,
        summary_count: 0,
        granule_count: 0,
        malformed_package_ids: [],
        completed_at: null,
      };
    }
    await writeManifest(manifest);

    return {
      source: 'govinfo',
      ok: false,
      requested_scope: { query_scope },
      rate_limit_exhausted: normalized.code === 'rate_limit_exhausted',
      next_request_at: normalized.next_request_at,
      error: {
        code: normalized.code,
        message: normalized.message,
      },
    };
  }
}

function buildInitialListingUrl(): string {
  const url = new URL('https://api.govinfo.gov/collections/PLAW');
  url.searchParams.set('api_key', process.env.API_DATA_GOV_KEY ?? '');
  return url.toString();
}

function buildPackageUrl(packageId: string, kind: 'summary' | 'granules'): string {
  return `https://api.govinfo.gov/packages/${packageId}/${kind}?api_key=${encodeURIComponent(process.env.API_DATA_GOV_KEY ?? '')}`;
}

async function fetchGovInfoJson<T>(url: string): Promise<{ payload: T }> {
  const response = await fetchGovInfoResponse(url);
  return {
    payload: await response.json() as T,
  };
}

async function fetchGovInfoText(url: string): Promise<{ body: string }> {
  const response = await fetchGovInfoResponse(url);
  return {
    body: await response.text(),
  };
}

async function fetchGovInfoResponse(url: string): Promise<Response> {
  const exhaustion = isRateLimitExhausted(sharedLimiter);
  if (exhaustion.exhausted) {
    throw createRateLimitError(exhaustion.nextRequestAt);
  }

  markRateLimitUse(sharedLimiter);
  const response = await fetch(url);
  if (response.status === 401 || response.status === 403) {
    throw new Error('upstream_auth_rejected: GovInfo rejected API_DATA_GOV_KEY');
  }
  if (!response.ok) {
    throw new Error(`upstream_request_failed: GovInfo request failed with HTTP ${response.status}`);
  }
  return response;
}

function matchesCongressFilter(packageId: string, congress: number | null): boolean {
  if (congress === null) {
    return true;
  }

  const match = /^PLAW-(\d+)/.exec(packageId);
  return match?.[1] === String(congress);
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
    message: error instanceof Error ? error.message : 'GovInfo fetch failed',
    next_request_at: null,
  };
}
