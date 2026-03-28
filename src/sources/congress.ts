import { resolveCurrentCongressScope, type CurrentCongressResolution } from '../utils/fetch-config.js';

export interface FetchInvocation {
  force: boolean;
  congress: number | null;
  mode: 'single' | 'all';
}

export interface FetchSourceResult {
  source: 'congress';
  ok: boolean;
  requested_scope: { congress: number | string | null };
  bulk_scope: { congress: CurrentCongressResolution } | null;
  rate_limit_exhausted: boolean;
  next_request_at: string | null;
  error?: { code: string; message: string };
}

export async function fetchCongressSource(invocation: FetchInvocation): Promise<FetchSourceResult> {
  const bulkScope = invocation.mode === 'all'
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

  return {
    source: 'congress',
    ok: false,
    requested_scope: { congress: invocation.congress },
    bulk_scope: bulkScope,
    rate_limit_exhausted: false,
    next_request_at: null,
    error: {
      code: 'not_implemented',
      message: 'Congress acquisition is not implemented yet',
    },
  };
}
