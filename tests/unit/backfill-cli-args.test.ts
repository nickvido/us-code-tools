import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

function cliPath() {
  return resolve(process.cwd(), 'dist', 'index.js');
}

function runBackfill(args: string[], cwd = process.cwd()) {
  return spawnSync(process.execPath, [cliPath(), 'backfill', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

describe('backfill CLI argument validation', () => {
  const distEntry = cliPath();

  it('rejects invocation missing --phase and prints backfill usage', () => {
    const result = runBackfill(['--target', resolve(process.cwd(), 'build-test-no-phase')]);

    expect(result.status).not.toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toContain('Usage: backfill');
    expect(output).toContain('--phase');
  });

  it('rejects invocation missing --target and prints usage', () => {
    const result = runBackfill(['--phase', 'constitution']);

    expect(result.status).not.toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toContain('Usage: backfill');
    expect(output).toContain('--target');
  });

  it('rejects unsupported --phase values', () => {
    const result = runBackfill(['--phase', 'baseline', '--target', resolve(process.cwd(), 'build-test-bad-phase')]);

    expect(result.status).not.toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toContain('Unsupported --phase');
  });

  it('rejects a file path target', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'us-code-tools-test-'));
    const tempFile = resolve(root, 'not-a-directory.txt');
    writeFileSync(tempFile, 'sentinel');

    const result = runBackfill(['--phase', 'constitution', '--target', tempFile]);

    expect(result.status).not.toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toContain('--target');
    expect(output).toContain('directory');
    rmSync(root, { recursive: true, force: true });
  });
  
  it('keeps transform command requirements unchanged', () => {
    const result = spawnSync(process.execPath, [distEntry, 'transform', '--title', '1'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30_000,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('transform --title <number> --output <dir>');
  });
});
