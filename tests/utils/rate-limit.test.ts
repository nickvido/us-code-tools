import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type CandidateModule = Record<string, unknown>;

function pickCallable(module: CandidateModule, candidates: string[]) {
  for (const name of candidates) {
    const value = module[name as keyof CandidateModule];
    if (typeof value === 'function') {
      return value as (...args: unknown[]) => unknown;
    }
  }

  throw new Error(`No callable export found for: ${candidates.join(', ')}`);
}

async function importFresh(modulePath: string): Promise<CandidateModule> {
  vi.resetModules();
  return (await import(pathToFileURL(modulePath).href)) as CandidateModule;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shared rolling-hour rate limiter', () => {
  it('tracks a rolling window and exposes the next permitted request time when exhausted', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(2_500)
      .mockReturnValueOnce(3_601_100);

    const mod = await importFresh(resolve(process.cwd(), 'src', 'utils', 'rate-limit.ts'));
    const createRateLimitState = pickCallable(mod, ['createRateLimitState']);
    const markRateLimitUse = pickCallable(mod, ['markRateLimitUse']);
    const isRateLimitExhausted = pickCallable(mod, ['isRateLimitExhausted']);

    const state = createRateLimitState(2, 3_600_000);
    markRateLimitUse(state, 1);
    markRateLimitUse(state, 1);

    const exhausted = isRateLimitExhausted(state) as unknown;
    expect(exhausted).toMatchObject({
      exhausted: true,
      nextRequestAt: expect.any(Number),
    });
    expect((exhausted as { nextRequestAt: number }).nextRequestAt).toBeGreaterThan(2_500);

    const recovered = isRateLimitExhausted(state) as unknown;
    expect(recovered).toMatchObject({
      exhausted: false,
    });
  });
});
