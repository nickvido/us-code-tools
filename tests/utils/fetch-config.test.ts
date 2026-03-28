import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type CandidateModule = Record<string, unknown>;

function pickCallable(module: CandidateModule, candidates: string[]) {
  for (const name of candidates) {
    const value = module[name as keyof CandidateModule];
    if (typeof value === 'function') {
      return value as (...args: unknown[]) => Promise<unknown> | unknown;
    }
  }

  throw new Error(`No callable export found for: ${candidates.join(', ')}`);
}

async function importFresh(modulePath: string): Promise<CandidateModule> {
  vi.resetModules();
  return (await import(pathToFileURL(modulePath).href)) as CandidateModule;
}

afterEach(() => {
  delete process.env.API_DATA_GOV_KEY;
  delete process.env.CURRENT_CONGRESS_OVERRIDE;
  vi.restoreAllMocks();
});

describe('fetch-config current congress resolution', () => {
  it('uses the live Congress.gov lookup and labels the scope as live when the request succeeds', async () => {
    process.env.API_DATA_GOV_KEY = 'test-key';

    const originalFetch = globalThis.fetch;
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({
        congress: { number: 120 },
        congresses: [{ number: 120 }],
        number: 120,
      }),
    });
    globalThis.fetch = mockFetch as typeof fetch;

    try {
      const mod = await importFresh(resolve(process.cwd(), 'src', 'utils', 'fetch-config.ts'));
      const getCurrentCongress = pickCallable(mod, ['getCurrentCongress']);
      const resolveCurrentCongressScope = pickCallable(mod, ['resolveCurrentCongressScope']);

      const current = await getCurrentCongress();
      const scope = await resolveCurrentCongressScope();

      expect(current).toBe(120);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(String(mockFetch.mock.calls[0]?.[0] ?? '')).toContain('/congress/current');
      expect(String(mockFetch.mock.calls[0]?.[0] ?? '')).toContain('api_key=test-key');
      expect(scope).toMatchObject({
        current: 120,
        resolution: 'live',
        operator_review_required: false,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back only after live lookup failure and marks the result as degraded', async () => {
    process.env.API_DATA_GOV_KEY = 'test-key';

    const originalFetch = globalThis.fetch;
    const mockFetch = vi.fn().mockRejectedValue(new Error('upstream unavailable'));
    globalThis.fetch = mockFetch as typeof fetch;

    try {
      const mod = await importFresh(resolve(process.cwd(), 'src', 'utils', 'fetch-config.ts'));
      const resolveCurrentCongressScope = pickCallable(mod, ['resolveCurrentCongressScope']);

      const scope = await resolveCurrentCongressScope();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(scope).toMatchObject({
        resolution: 'fallback',
        operator_review_required: true,
      });
      expect((scope as { current?: unknown }).current).toEqual(expect.any(Number));
      expect((scope as { fallback_value?: unknown }).fallback_value).toEqual(expect.any(Number));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
