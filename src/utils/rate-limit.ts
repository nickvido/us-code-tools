export interface RateLimitState {
  limit: number;
  windowMs: number;
  used: number;
  nextRequestAt: string | null;
}

export function createRateLimitState(limit: number, windowMs: number): RateLimitState {
  return {
    limit,
    windowMs,
    used: 0,
    nextRequestAt: null,
  };
}

export function markRateLimitUse(state: RateLimitState, increment = 1): RateLimitState {
  return {
    ...state,
    used: state.used + increment,
  };
}

export function isRateLimitExhausted(state: RateLimitState): boolean {
  return state.used >= state.limit;
}
