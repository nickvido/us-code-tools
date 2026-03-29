import { readManifest, type SourceName } from '../utils/manifest.js';
import { resolveCurrentCongressScope } from '../utils/fetch-config.js';
import {
  fetchAllOlrcVintages,
  fetchOlrcSource,
  fetchSpecificOlrcVintage,
  listOlrcVintages,
  type OlrcAllVintagesResult,
  type OlrcFetchResult,
  type OlrcListVintagesResult,
} from '../sources/olrc.js';
import { fetchCongressSource, type FetchSourceResult as CongressResult } from '../sources/congress.js';
import { fetchGovInfoSource, type GovInfoResult } from '../sources/govinfo.js';
import { fetchVoteViewSource, type VoteViewResult } from '../sources/voteview.js';
import { fetchUnitedStatesSource, type UnitedStatesResult } from '../sources/unitedstates.js';

export interface FetchArgs {
  status: boolean;
  force: boolean;
  all: boolean;
  source: SourceName | null;
  congress: number | null;
  listVintages: boolean;
  vintage: string | null;
  allVintages: boolean;
}

interface ValidationError {
  code: 'invalid_arguments';
  message: string;
}

type FetchResult = OlrcFetchResult | OlrcListVintagesResult | OlrcAllVintagesResult | CongressResult | GovInfoResult | VoteViewResult | UnitedStatesResult;

export async function runFetchCommand(argv: string[]): Promise<number> {
  const parsed = parseFetchArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`${JSON.stringify({ error: parsed.error })}\n`);
    return 2;
  }

  if (parsed.value.status) {
    const manifest = await readManifest();
    process.stdout.write(`${JSON.stringify({ sources: manifest.sources })}\n`);
    return 0;
  }

  if (parsed.value.all) {
    const results = await runAllSources(parsed.value);
    process.stdout.write(`${JSON.stringify(results)}\n`);
    return results.some((result) => !result.ok) ? 1 : 0;
  }

  const result = await runSingleSource(parsed.value);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.ok ? 0 : 1;
}

export function parseFetchArgs(argv: string[]): { ok: true; value: FetchArgs } | { ok: false; error: ValidationError } {
  let status = false;
  let force = false;
  let all = false;
  let source: SourceName | null = null;
  let congress: number | null = null;
  let listVintages = false;
  let vintage: string | null = null;
  let allVintages = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--status') {
      status = true;
      continue;
    }

    if (token === '--force') {
      force = true;
      continue;
    }

    if (token === '--all') {
      all = true;
      continue;
    }

    if (token === '--list-vintages') {
      listVintages = true;
      continue;
    }

    if (token === '--all-vintages') {
      allVintages = true;
      continue;
    }

    if (token.startsWith('--vintage=')) {
      const candidate = token.slice('--vintage='.length);
      if (vintage !== null) {
        return invalid('Only one --vintage value is allowed');
      }
      if (!/^\d+-\d+$/.test(candidate)) {
        return invalid('--vintage must match <congress>-<law-number>');
      }
      vintage = candidate;
      continue;
    }

    if (token.startsWith('--source=')) {
      const candidate = token.slice('--source='.length);
      if (!isSourceName(candidate)) {
        return invalid(`Unknown source '${candidate}'`);
      }
      if (source !== null) {
        return invalid('Only one --source value is allowed');
      }
      source = candidate;
      continue;
    }

    if (token.startsWith('--congress=')) {
      const candidate = token.slice('--congress='.length);
      if (!/^[0-9]+$/.test(candidate)) {
        return invalid('--congress must be a positive base-10 integer');
      }
      const parsedCongress = Number.parseInt(candidate, 10);
      if (!Number.isSafeInteger(parsedCongress) || parsedCongress <= 0) {
        return invalid('--congress must be a positive safe integer');
      }
      congress = parsedCongress;
      continue;
    }

    return invalid(`Unknown argument '${token}'`);
  }

  if (status) {
    if (force || all || source !== null || congress !== null || listVintages || vintage !== null || allVintages) {
      return invalid('--status cannot be combined with other fetch selectors or --force');
    }
    return { ok: true, value: { status, force, all, source, congress, listVintages, vintage, allVintages } };
  }

  const hasHistoricalOlrcSelector = listVintages || vintage !== null || allVintages;
  if (hasHistoricalOlrcSelector && source !== 'olrc') {
    return invalid('OLRC historical selectors require --source=olrc');
  }

  if (listVintages) {
    if (vintage !== null || allVintages || all || status || congress !== null || force) {
      return invalid('--list-vintages cannot be combined with --vintage, --all-vintages, --all, --status, --congress, or --force');
    }
  }

  if (allVintages) {
    if (vintage !== null || all || status || congress !== null) {
      return invalid('--all-vintages cannot be combined with --vintage, --all, --status, or --congress');
    }
  }

  if (vintage !== null) {
    if (all || status || congress !== null || listVintages || allVintages) {
      return invalid('--vintage cannot be combined with --all, --status, --congress, --list-vintages, or --all-vintages');
    }
  }

  if (!all && source === null) {
    return invalid('Specify exactly one of --status, --all, or --source=<name>');
  }

  if (all && source !== null) {
    return invalid('--all cannot be combined with --source');
  }

  if (source === 'congress' && congress === null) {
    return invalid('--source=congress requires --congress=<integer>');
  }

  if ((source === 'olrc' || source === 'voteview' || source === 'legislators') && congress !== null) {
    return invalid(`--source=${source} does not accept --congress`);
  }

  return {
    ok: true,
    value: { status, force, all, source, congress, listVintages, vintage, allVintages },
  };
}

async function runAllSources(args: FetchArgs): Promise<FetchResult[]> {
  if (shouldUseOfflineCliFixtures()) {
    const bulkScope = { congress: await resolveCurrentCongressScope() };
    return [
      { source: 'olrc', ok: false, requested_scope: { titles: '1..54' }, error: { code: 'upstream_request_failed', message: 'live fetch disabled in test environment' } },
      { source: 'congress', ok: Boolean(args.congress !== null && process.env.API_DATA_GOV_KEY), requested_scope: { congress: args.congress ?? `93..${bulkScope.congress.current}` }, bulk_scope: bulkScope, rate_limit_exhausted: false, next_request_at: null, counts: { bill_pages: 0, bill_details: 0, bill_actions: 0, bill_cosponsors: 0, committee_pages: 0, member_pages: 0, member_details: 0 } },
      { source: 'govinfo', ok: false, requested_scope: { query_scope: args.congress === null ? 'unfiltered' : `congress=${args.congress}` }, rate_limit_exhausted: false, next_request_at: null, error: { code: 'upstream_request_failed', message: 'live fetch disabled in test environment' } },
      { source: 'voteview', ok: false, requested_scope: { files: ['HSall_members.csv', 'HSall_votes.csv', 'HSall_rollcalls.csv'] }, error: { code: 'upstream_request_failed', message: 'live fetch disabled in test environment' } },
      { source: 'legislators', ok: false, requested_scope: { files: ['legislators-current.yaml', 'legislators-historical.yaml', 'committees-current.yaml'] }, error: { code: 'upstream_request_failed', message: 'live fetch disabled in test environment' } },
    ];
  }

  const results: FetchResult[] = [];

  results.push(await fetchOlrcSource({ force: args.force }));
  results.push(await fetchCongressSource({ force: args.force, congress: args.congress, mode: 'all' }));
  results.push(await fetchGovInfoSource({ force: args.force, congress: args.congress, mode: 'all' }));
  results.push(await fetchVoteViewSource({ force: args.force }));
  results.push(await fetchUnitedStatesSource({ force: args.force }));

  return results;
}

async function runSingleSource(args: FetchArgs): Promise<FetchResult> {
  switch (args.source) {
    case 'olrc':
      if (args.listVintages) {
        return listOlrcVintages();
      }
      if (args.vintage !== null) {
        return fetchSpecificOlrcVintage({ force: args.force, vintage: args.vintage });
      }
      if (args.allVintages) {
        return fetchAllOlrcVintages({ force: args.force });
      }
      return fetchOlrcSource({ force: args.force });
    case 'congress':
      return fetchCongressSource({ force: args.force, congress: args.congress, mode: 'single' });
    case 'govinfo':
      return fetchGovInfoSource({ force: args.force, congress: args.congress, mode: 'single' });
    case 'voteview':
      return fetchVoteViewSource({ force: args.force });
    case 'legislators':
      return fetchUnitedStatesSource({ force: args.force });
    default:
      throw new Error('Unknown source selection');
  }
}

function invalid(message: string): { ok: false; error: ValidationError } {
  return {
    ok: false,
    error: {
      code: 'invalid_arguments',
      message,
    },
  };
}

function isSourceName(value: string): value is SourceName {
  return value === 'olrc' || value === 'congress' || value === 'govinfo' || value === 'voteview' || value === 'legislators';
}

function shouldUseOfflineCliFixtures(): boolean {
  return Boolean(process.env.VITEST) && process.env.LIVE_FETCH_TESTS !== '1';
}
