import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FetchInvocation } from './congress.js';
import { getCachePaths, readFreshRawResponseCache, writeRawResponseCache } from '../utils/cache.js';
import { getSharedApiDataGovLimiter, isRateLimitExhausted, markRateLimitUse, parseRetryAfter } from '../utils/rate-limit.js';
import { readManifest, writeManifest, type FetchManifest } from '../utils/manifest.js';
import { logNetworkEvent } from '../utils/logger.js';

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

const GOVINFO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 500;

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
    let retainedPackages = 0;
    let summaries = 0;
    let granules = 0;
    const malformedPackageIds = new Set<string>();

    if (invocation.force) {
      delete manifest.sources.govinfo.checkpoints[query_scope];
    }

    do {
      const pageUrl = nextPageUrl ?? buildInitialListingUrl();
      let listingResponse: { payload: GovInfoCollectionPage };
      try {
        listingResponse = await fetchGovInfoJson<GovInfoCollectionPage>(pageUrl, { force: invocation.force });
      } catch (error) {
        if (isRateLimitError(error)) {
          throw createRateLimitErrorWithProgress(error.nextRequestAt, { listed_packages: listedPackages, retained_packages: retainedPackages, summaries, granules, malformed_package_ids: [...malformedPackageIds] });
        }
        throw error;
      }
      const listedPackageIds = (listingResponse.payload.packages ?? [])
        .map((item) => item.packageId)
        .filter((value): value is string => typeof value === 'string' && value.length > 0);
      const retainedPackageIds = listedPackageIds.filter((value) => {
        const match = matchesCongressFilter(value, invocation.congress);
        if (match === 'malformed') {
          malformedPackageIds.add(value);
          return false;
        }
        return match;
      });

      listedPackages += listedPackageIds.length;
      retainedPackages += retainedPackageIds.length;
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

        let summary: { body: string };
        try {
          summary = await fetchGovInfoText(buildPackageUrl(packageId, 'summary'), { force: invocation.force });
        } catch (error) {
          if (isRateLimitError(error)) {
            throw createRateLimitErrorWithProgress(error.nextRequestAt, { listed_packages: listedPackages, retained_packages: retainedPackages, summaries, granules, malformed_package_ids: [...malformedPackageIds] });
          }
          throw error;
        }
        let granulePayload: { body: string };
        try {
          granulePayload = await fetchGovInfoText(buildPackageUrl(packageId, 'granules'), { force: invocation.force });
        } catch (error) {
          if (isRateLimitError(error)) {
            throw createRateLimitErrorWithProgress(error.nextRequestAt, { listed_packages: listedPackages, retained_packages: retainedPackages, summaries, granules, malformed_package_ids: [...malformedPackageIds] });
          }
          throw error;
        }
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
      retained_package_count: retainedPackages,
      summary_count: summaries,
      granule_count: granules,
      malformed_package_ids: [...malformedPackageIds],
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
        listed_package_count: normalized.listed_packages,
        retained_package_count: normalized.retained_packages,
        summary_count: normalized.summaries,
        granule_count: normalized.granules,
        malformed_package_ids: normalized.malformed_package_ids,
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

async function fetchGovInfoJson<T>(url: string, options: { force: boolean }): Promise<{ payload: T }> {
  const response = await fetchGovInfoResponse(url, options);
  return {
    payload: JSON.parse(response.body) as T,
  };
}

async function fetchGovInfoText(url: string, options: { force: boolean }): Promise<{ body: string }> {
  const response = await fetchGovInfoResponse(url, options);
  return {
    body: response.body,
  };
}

async function fetchGovInfoResponse(url: string, options: { force: boolean }): Promise<{ body: string }> {
  const startedAt = Date.now();
  if (!options.force) {
    const cached = await readFreshRawResponseCache('govinfo', url, GOVINFO_CACHE_TTL_MS);
    if (cached !== null) {
      logNetworkEvent({ level: 'info', event: 'network.request', source: 'govinfo', method: 'GET', url, attempt: 1, cache_status: 'hit', duration_ms: Date.now() - startedAt, status_code: cached.metadata.status_code });
      return { body: cached.body };
    }
  }

  const exhaustion = isRateLimitExhausted(getSharedApiDataGovLimiter());
  if (exhaustion.exhausted) {
    throw createRateLimitError(exhaustion.nextRequestAt);
  }

  markRateLimitUse(getSharedApiDataGovLimiter());
  const response = await fetchWithTimeout(url, options.force ? 'bypass' : 'miss', startedAt);
  if (response.status === 401 || response.status === 403) {
    throw new Error('upstream_auth_rejected: GovInfo rejected API_DATA_GOV_KEY');
  }
  if (response.status === 429) {
    const retryAt = parseRetryAfter(response.retryAfter);
    throw Object.assign(new Error('rate_limit_exhausted: GovInfo returned 429'), { code: 'rate_limit_exhausted' as const, nextRequestAt: retryAt });
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`upstream_request_failed: GovInfo request failed with HTTP ${response.status}`);
  }

  await writeRawResponseCache('govinfo', url, response.body, { statusCode: response.status, contentType: response.contentType });
  return { body: response.body };
}

function createRateLimitErrorWithProgress(nextRequestAt: number | null, progress: { listed_packages: number; retained_packages: number; summaries: number; granules: number; malformed_package_ids: string[] }): Error & { code: 'rate_limit_exhausted'; nextRequestAt: number | null; progress: { listed_packages: number; retained_packages: number; summaries: number; granules: number; malformed_package_ids: string[] } } {
  const error = createRateLimitError(nextRequestAt) as Error & { code: 'rate_limit_exhausted'; nextRequestAt: number | null; progress: { listed_packages: number; retained_packages: number; summaries: number; granules: number; malformed_package_ids: string[] } };
  error.progress = progress;
  return error;
}

async function fetchWithTimeout(url: string, cacheStatus: 'miss' | 'bypass', startedAt: number): Promise<{ body: string; status: number; contentType: string | null; retryAfter: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.text();
    logNetworkEvent({ level: 'info', event: 'network.request', source: 'govinfo', method: 'GET', url, attempt: 1, cache_status: cacheStatus, duration_ms: Date.now() - startedAt, status_code: response.status });
    return { body, status: response.status, contentType: response.headers.get('content-type'), retryAfter: response.headers.get('retry-after') };
  } catch (error) {
    logNetworkEvent({ level: 'error', event: 'network.request', source: 'govinfo', method: 'GET', url, attempt: 1, cache_status: cacheStatus, duration_ms: Date.now() - startedAt });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function matchesCongressFilter(packageId: string, congress: number | null): boolean | 'malformed' {
  if (congress === null) {
    return true;
  }

  const match = /^PLAW-(\d+)/.exec(packageId);
  if (match?.[1] === undefined) {
    return packageId.startsWith('PLAW-') ? 'malformed' : false;
  }
  return match[1] === String(congress);
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

function isRateLimitError(error: unknown): error is Error & { code: 'rate_limit_exhausted'; nextRequestAt: number | null } {
  return error instanceof Error && 'code' in error && error.code === 'rate_limit_exhausted';
}

function normalizeError(error: unknown): { code: string; message: string; next_request_at: string | null; listed_packages: number; retained_packages: number; summaries: number; granules: number; malformed_package_ids: string[] } {
  if (isRateLimitError(error)) {
    const nextRequestAt = typeof error.nextRequestAt === 'number'
      ? new Date(error.nextRequestAt).toISOString()
      : null;
    const progress = 'progress' in error && typeof error.progress === 'object' && error.progress !== null
      ? error.progress as { listed_packages?: number; retained_packages?: number; summaries?: number; granules?: number; malformed_package_ids?: string[] }
      : {};
    return {
      code: 'rate_limit_exhausted',
      message: error.message,
      next_request_at: nextRequestAt,
      listed_packages: progress.listed_packages ?? 0,
      retained_packages: progress.retained_packages ?? 0,
      summaries: progress.summaries ?? 0,
      granules: progress.granules ?? 0,
      malformed_package_ids: Array.isArray(progress.malformed_package_ids) ? progress.malformed_package_ids : [],
    };
  }

  if (error instanceof Error && error.message.startsWith('upstream_auth_rejected:')) {
    return { code: 'upstream_auth_rejected', message: error.message, next_request_at: null, listed_packages: 0, retained_packages: 0, summaries: 0, granules: 0, malformed_package_ids: [] };
  }

  return {
    code: 'upstream_request_failed',
    message: error instanceof Error ? error.message : 'GovInfo fetch failed',
    next_request_at: null,
    listed_packages: 0,
    retained_packages: 0,
    summaries: 0,
    granules: 0,
    malformed_package_ids: [],
  };
}
