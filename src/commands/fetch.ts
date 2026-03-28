import { readManifest, type SourceName } from '../utils/manifest.js';
import { fetchOlrcSource, type OlrcFetchResult } from '../sources/olrc.js';
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
}

interface ValidationError {
  code: 'invalid_arguments';
  message: string;
}

type FetchResult = OlrcFetchResult | CongressResult | GovInfoResult | VoteViewResult | UnitedStatesResult;

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
    if (force || all || source !== null || congress !== null) {
      return invalid('--status cannot be combined with other fetch selectors or --force');
    }
    return { ok: true, value: { status, force, all, source, congress } };
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
    value: { status, force, all, source, congress },
  };
}

async function runAllSources(args: FetchArgs): Promise<FetchResult[]> {
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
      return fetchOlrcSource({ force: args.force });
    case 'congress':
      return fetchCongressSource({ force: args.force, congress: args.congress, mode: 'single' });
    case 'govinfo':
      return fetchGovInfoSource({ force: args.force, congress: args.congress, mode: 'single' });
    case 'voteview':
      return fetchVoteViewSource();
    case 'legislators':
      return fetchUnitedStatesSource();
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
