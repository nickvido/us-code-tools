const CURRENT_CONGRESS_FLOOR = 119;
let currentCongressCache: number | null = null;

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

  const override = process.env.CURRENT_CONGRESS_OVERRIDE;
  if (override) {
    const parsed = Number.parseInt(override, 10);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      currentCongressCache = parsed;
      return parsed;
    }
  }

  currentCongressCache = CURRENT_CONGRESS_FLOOR;
  return currentCongressCache;
}

export async function resolveCurrentCongressScope(): Promise<CurrentCongressResolution> {
  const override = process.env.CURRENT_CONGRESS_OVERRIDE;
  const current = await getCurrentCongress();
  return {
    start: 93,
    current,
    resolution: override ? 'override' : 'fallback',
    fallback_value: override ? null : CURRENT_CONGRESS_FLOOR,
    operator_review_required: !override,
  };
}
