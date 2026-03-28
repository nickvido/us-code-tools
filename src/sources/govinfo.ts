import type { FetchInvocation } from './congress.js';

export interface GovInfoResult {
  source: 'govinfo';
  ok: boolean;
  requested_scope: { query_scope: 'unfiltered' | `congress=${number}` };
  rate_limit_exhausted: boolean;
  next_request_at: string | null;
  error?: { code: string; message: string };
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

  return {
    source: 'govinfo',
    ok: false,
    requested_scope: { query_scope },
    rate_limit_exhausted: false,
    next_request_at: null,
    error: {
      code: 'not_implemented',
      message: 'GovInfo acquisition is not implemented yet',
    },
  };
}
