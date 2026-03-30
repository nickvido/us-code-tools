import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

function cliPath(): string {
  return resolve(process.cwd(), 'dist', 'index.js');
}

function run(...args: string[]) {
  return spawnSync(process.execPath, [cliPath(), 'backfill', ...args], {
    encoding: 'utf8',
    timeout: 10_000,
  });
}

describe('backfill CLI — olrc phase argument validation', () => {
  it('rejects --phase olrc without --vintages', () => {
    const result = run('--phase', 'olrc', '--target', '/tmp/test');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--vintages');
  });

  it('accepts --phase olrc with --vintages and --target', () => {
    // Will fail at runtime (no cache) but should parse args successfully
    const result = run('--phase', 'olrc', '--target', '/tmp/nonexistent-test', '--vintages', '119-73');
    // Either exits 1 with a runtime error (missing cache) or succeeds
    expect(result.stderr).not.toContain('Missing required');
  });

  it('rejects unknown phases', () => {
    const result = run('--phase', 'bogus', '--target', '/tmp/test');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unsupported');
  });

  it('still accepts --phase constitution without --vintages', () => {
    const result = run('--phase', 'constitution', '--target', '/tmp/nonexistent');
    // Should parse fine, fail at runtime
    expect(result.stderr).not.toContain('--vintages');
  });
});
