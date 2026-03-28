const CURRENT_CONGRESS_FLOOR = 119;
const CURRENT_CONGRESS_URL = 'https://api.congress.gov/v3/congress/current';

let currentCongressCache: number | null = null;
let currentCongressResolutionCache: CurrentCongressResolution | null = null;

export interface CurrentCongressResolution {
  start: number;
  current: number;
  resolution: 'live' | 'override' | 'fallback';
  fallback_value: number | null;
  operator_review_required: boolean;
}

export async function getCurrentCongress(): Promise<number> {
  if (currentCongressCache !== null) {
    return currentCongressCache;
  }

  const override = parsePositiveSafeInteger(process.env.CURRENT_CONGRESS_OVERRIDE);
  if (override !== null) {
    currentCongressCache = override;
    currentCongressResolutionCache = buildResolution(override, 'override');
    return override;
  }

  const apiKey = process.env.API_DATA_GOV_KEY;
  if (!apiKey) {
    currentCongressCache = CURRENT_CONGRESS_FLOOR;
    currentCongressResolutionCache = buildResolution(CURRENT_CONGRESS_FLOOR, 'fallback');
    return currentCongressCache;
  }

  try {
    const response = await fetch(`${CURRENT_CONGRESS_URL}?api_key=${encodeURIComponent(apiKey)}`);
    if (!response.ok) {
      throw new Error(`Congress.gov current congress lookup failed with HTTP ${response.status}`);
    }

    const payload = await response.json() as CurrentCongressApiPayload;
    const current = extractCurrentCongress(payload);
    if (current === null) {
      throw new Error('Congress.gov current congress payload did not contain a valid congress number');
    }

    currentCongressCache = current;
    currentCongressResolutionCache = buildResolution(current, 'live');
    return current;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ts: new Date().toISOString(),
      level: 'warn',
      event: 'current_congress_fallback',
      message: error instanceof Error ? error.message : 'Unknown current congress lookup failure',
      fallback_value: CURRENT_CONGRESS_FLOOR,
    })}\n`);

    currentCongressCache = CURRENT_CONGRESS_FLOOR;
    currentCongressResolutionCache = buildResolution(CURRENT_CONGRESS_FLOOR, 'fallback');
    return currentCongressCache;
  }
}

export async function resolveCurrentCongressScope(): Promise<CurrentCongressResolution> {
  if (currentCongressResolutionCache !== null) {
    return currentCongressResolutionCache;
  }

  await getCurrentCongress();
  return currentCongressResolutionCache ?? buildResolution(CURRENT_CONGRESS_FLOOR, 'fallback');
}

interface CurrentCongressApiPayload {
  congress?: {
    number?: number;
  };
  congresses?: Array<{
    number?: number;
  }>;
  number?: number;
}

function extractCurrentCongress(payload: CurrentCongressApiPayload): number | null {
  const direct = parsePositiveSafeInteger(payload.number);
  if (direct !== null) {
    return direct;
  }

  const nested = parsePositiveSafeInteger(payload.congress?.number);
  if (nested !== null) {
    return nested;
  }

  const firstCongress = payload.congresses?.[0];
  return parsePositiveSafeInteger(firstCongress?.number);
}

function buildResolution(current: number, resolution: CurrentCongressResolution['resolution']): CurrentCongressResolution {
  return {
    start: 93,
    current,
    resolution,
    fallback_value: resolution === 'fallback' ? CURRENT_CONGRESS_FLOOR : null,
    operator_review_required: resolution === 'fallback',
  };
}

function parsePositiveSafeInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}
