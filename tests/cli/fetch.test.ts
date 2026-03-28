import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';

const projectRoot = resolve(process.cwd());
const distEntry = resolve(projectRoot, 'dist', 'index.js');

function buildDist(): void {
  if (existsSync(distEntry)) {
    return;
  }

  execSync('npm run build', {
    cwd: projectRoot,
    stdio: 'pipe',
    env: process.env,
    timeout: 120_000,
  });
}

function runFetch(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const tempRoot = join(tmpdir(), `us-code-tools-fetch-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempRoot, { recursive: true });

  const result = spawnSync(process.execPath, [distEntry, 'fetch', ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      ...extraEnv,
      HOME: tempRoot,
      XDG_CACHE_HOME: join(tempRoot, '.cache'),
      US_CODE_TOOLS_DATA_DIR: join(tempRoot, 'data'),
    },
  });

  return {
    ...result,
    tempRoot,
    cleanup() {
      rmSync(tempRoot, { recursive: true, force: true });
    },
  };
}

describe('fetch CLI contract', () => {
  beforeAll(() => {
    buildDist();
  });

  it('rejects bare fetch with invalid_arguments and exit code 2', () => {
    const result = runFetch([]);

    try {
      expect(result.status).toBe(2);
      const payload = JSON.parse(result.stderr.trim()) as { error?: { code?: string } };
      expect(payload.error?.code).toBe('invalid_arguments');
      expect(result.stdout.trim()).toBe('');
    } finally {
      result.cleanup();
    }
  });

  it('rejects --status combined with --force without mutating cache state', () => {
    const result = runFetch(['--status', '--force']);

    try {
      expect(result.status).toBe(2);
      const payload = JSON.parse(result.stderr.trim()) as { error?: { code?: string } };
      expect(payload.error?.code).toBe('invalid_arguments');
      expect(existsSync(join(result.tempRoot, 'data', 'manifest.json'))).toBe(false);
    } finally {
      result.cleanup();
    }
  });

  it('prints one manifest-backed status object covering all five sources', () => {
    const result = runFetch(['--status']);

    try {
      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout.trim()) as {
        sources?: Record<string, { last_success_at?: string | null; last_failure?: unknown }>;
      };
      expect(Object.keys(payload.sources ?? {})).toEqual([
        'olrc',
        'congress',
        'govinfo',
        'voteview',
        'legislators',
      ]);
      expect(payload.sources?.olrc).toHaveProperty('last_success_at');
      expect(payload.sources?.congress).toHaveProperty('last_failure');
      expect(existsSync(join(result.tempRoot, 'data', 'manifest.json'))).toBe(false);
    } finally {
      result.cleanup();
    }
  });

  it('fails open in deterministic source order for fetch --all --congress=118', () => {
    const result = runFetch(['--all', '--congress=118']);

    try {
      expect(result.status).toBe(1);
      expect(result.stdout.trim()).not.toBe('');
      expect(result.stdout).toContain('"source":"olrc"');
      expect(result.stdout).toContain('"source":"congress"');
      expect(result.stdout).toContain('"source":"govinfo"');
      expect(result.stdout).toContain('"source":"voteview"');
      expect(result.stdout).toContain('"source":"legislators"');
      expect(result.stdout.indexOf('"source":"olrc"')).toBeLessThan(result.stdout.indexOf('"source":"congress"'));
      expect(result.stdout.indexOf('"source":"congress"')).toBeLessThan(result.stdout.indexOf('"source":"govinfo"'));
      expect(result.stdout.indexOf('"source":"govinfo"')).toBeLessThan(result.stdout.indexOf('"source":"voteview"'));
      expect(result.stdout.indexOf('"source":"voteview"')).toBeLessThan(result.stdout.indexOf('"source":"legislators"'));
    } finally {
      result.cleanup();
    }
  });

  it('narrows --all --congress=119 to congress-scoped bulk metadata resolved from override', () => {
    const result = runFetch(['--all', '--congress=119'], {
      CURRENT_CONGRESS_OVERRIDE: '119',
      API_DATA_GOV_KEY: 'test-key',
      LIVE_FETCH_TESTS: '0',
    });

    try {
      expect(result.stdout.trim()).not.toBe('');
      expect(result.stdout).toContain('"source":"congress"');
      expect(result.stdout).toContain('"bulk_scope"');
      expect(result.stdout).toContain('"start":93');
      expect(result.stdout).toContain('"current":119');
      expect(result.stdout).toContain('"resolution":"override"');
    } finally {
      result.cleanup();
    }
  });
});
