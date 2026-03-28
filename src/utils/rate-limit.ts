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
