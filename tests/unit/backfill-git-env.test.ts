import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { safeImport, ensureModuleLoaded } from '../utils/module-helpers.js';

function pickEnvBuilder(mod: Record<string, unknown>): (input: unknown) => Record<string, string> {
  const candidates = [
    'buildGitCommitEnv',
    'createCommitEnv',
    'buildCommitEnv',
    'makeGitCommitEnv',
    'commitEnv',
    'buildCommitEnvironment',
  ];

  for (const name of candidates) {
    if (typeof mod[name] === 'function') {
      return mod[name] as (input: unknown) => Record<string, string>;
    }
  }

  if (typeof mod.default === 'function') {
    return mod.default as (input: unknown) => Record<string, string>;
  }

  if (mod.default && typeof mod.default === 'object') {
    const nested = mod.default as Record<string, unknown>;
    for (const name of candidates) {
      if (typeof nested[name] === 'function') {
        return nested[name] as (input: unknown) => Record<string, string>;
      }
    }
  }

  throw new Error('Could not find git commit env builder');
}

describe('backfill git commit environment', () => {
  it('builds deterministic UTC commit timestamps for a ratified date', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'backfill', 'git-adapter.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);

    const buildCommitEnv = pickEnvBuilder(mod);
    const env = buildCommitEnv({
      ratified: '1992-05-07',
      authorName: '1st Congress',
      authorEmail: 'congress-1@congress.gov',
    });

    expect(env.GIT_AUTHOR_DATE).toBe('1992-05-07T00:00:00+0000');
    expect(env.GIT_COMMITTER_DATE).toBe('1992-05-07T00:00:00+0000');
    expect(env.GIT_AUTHOR_NAME).toBe('1st Congress');
    expect(env.GIT_AUTHOR_EMAIL).toBe('congress-1@congress.gov');
  });

  it('throws on malformed dates to avoid timestamp drift', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'backfill', 'git-adapter.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);

    const buildCommitEnv = pickEnvBuilder(mod);

    expect(() => buildCommitEnv({ ratified: 'bad-date', authorName: 'x', authorEmail: 'x@example.com' })).toThrow();
  });
});
