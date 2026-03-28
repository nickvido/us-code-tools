import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());

describe('data acquisition module layout', () => {
  it('adds the shared fetch command entry points promised by the spec', () => {
    expect(existsSync(resolve(root, 'src', 'commands', 'fetch.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'src', 'utils', 'manifest.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'src', 'utils', 'cache.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'src', 'utils', 'logger.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'src', 'utils', 'retry.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'src', 'utils', 'rate-limit.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'src', 'utils', 'fetch-config.ts'))).toBe(true);
  });

  it('adds typed source clients for the four missing upstreams and keeps OLRC alongside them', () => {
    expect(existsSync(resolve(root, 'src', 'sources', 'olrc.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'src', 'sources', 'congress.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'src', 'sources', 'govinfo.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'src', 'sources', 'voteview.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'src', 'sources', 'unitedstates.ts'))).toBe(true);
  });
});
