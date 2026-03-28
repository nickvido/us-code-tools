/**
 * Shared Congress.gov + GovInfo rate limiter singleton.
 * Both sources share one 5,000 req/hour rolling-window budget.
 */
let _sharedApiDataGovLimiter: RateLimitState | null = null;

export function getSharedApiDataGovLimiter(): RateLimitState {
  if (_sharedApiDataGovLimiter === null) {
    _sharedApiDataGovLimiter = createRateLimitState(5_000, 60 * 60 * 1000);
  }
  return _sharedApiDataGovLimiter;
}

/** Reset the shared limiter (for testing only). */
export function resetSharedApiDataGovLimiter(): void {
  _sharedApiDataGovLimiter = null;
}

export interface RateLimitState {
  limit: number;
  windowMs: number;
  timestamps: number[];
}

export interface RateLimitExhaustion {
  exhausted: boolean;
  nextRequestAt: number | null;
  used: number;
  remaining: number;
}

export function createRateLimitState(limit: number, windowMs: number): RateLimitState {
  return {
    limit,
    windowMs,
    timestamps: [],
  };
}

export function markRateLimitUse(state: RateLimitState, increment = 1): RateLimitState {
  const now = Date.now();
  pruneExpired(state, now);

  for (let index = 0; index < increment; index += 1) {
    state.timestamps.push(now);
  }

  return state;
}

export function isRateLimitExhausted(state: RateLimitState): RateLimitExhaustion {
  const now = Date.now();
  pruneExpired(state, now);

  if (state.timestamps.length < state.limit) {
    return {
      exhausted: false,
      nextRequestAt: null,
      used: state.timestamps.length,
      remaining: state.limit - state.timestamps.length,
    };
  }

  const earliestTimestamp = state.timestamps[0] ?? now;
  return {
    exhausted: true,
    nextRequestAt: earliestTimestamp + state.windowMs,
    used: state.timestamps.length,
    remaining: 0,
  };
}

/**
 * Parse an HTTP Retry-After header value into an absolute timestamp (ms since epoch).
 * Supports both delta-seconds and HTTP-date formats.
 * Returns null if the header is missing or unparseable.
 */
export function parseRetryAfter(headerValue: string | null): number | null {
  if (headerValue === null || headerValue.trim() === '') return null;

  // Try delta-seconds first (e.g., "120")
  const seconds = Number(headerValue.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Date.now() + seconds * 1000;
  }

  // Try HTTP-date (e.g., "Sat, 28 Mar 2026 20:00:00 GMT")
  const dateMs = Date.parse(headerValue.trim());
  if (Number.isFinite(dateMs)) {
    return dateMs;
  }

  return null;
}

function pruneExpired(state: RateLimitState, now: number): void {
  const threshold = now - state.windowMs;
  while (state.timestamps.length > 0) {
    const oldest = state.timestamps[0];
    if (oldest === undefined || oldest > threshold) {
      break;
    }
    state.timestamps.shift();
  }
}
