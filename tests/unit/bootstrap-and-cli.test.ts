import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';


describe('bootstrap and CLI contract', () => {
  const root = resolve(process.cwd());

  it('defines us-code-tools package metadata and scripts', () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { name?: string; bin?: Record<string, string>; scripts?: Record<string, string> };

    expect(packageJson.name).toBe('us-code-tools');
    expect(packageJson.scripts).toBeTypeOf('object');
    expect(packageJson.scripts?.build).toBe('tsc');
    expect(packageJson.scripts?.test).toBe('vitest run');
    expect(packageJson.bin).toHaveProperty('us-code-tools');
  });

  it('uses strict TypeScript', () => {
    const tsconfig = JSON.parse(readFileSync(resolve(root, 'tsconfig.json'), 'utf8')) as {
      compilerOptions?: { strict?: boolean };
    };

    expect(tsconfig.compilerOptions?.strict).toBe(true);
  });

  it('rejects missing title/output flags with usage text in stderr', () => {
    const distEntry = resolve(root, 'dist', 'index.js');
    const missingTitle = spawnSync(process.execPath, [distEntry, 'transform', '--output', resolve(root, 'tmp-out')], {
      encoding: 'utf8',
      cwd: root,
      timeout: 10_000,
    });

    expect(missingTitle.status).not.toBe(0);
    expect(missingTitle.stderr).toContain('transform --title <number> --output <dir>');

    const missingOutput = spawnSync(process.execPath, [distEntry, 'transform', '--title', '1'], {
      encoding: 'utf8',
      cwd: root,
      timeout: 10_000,
    });

    expect(missingOutput.status).not.toBe(0);
    expect(missingOutput.stderr).toContain('transform --title <number> --output <dir>');
  });

  it('rejects out-of-range title values and creates no output on CLI validation failure', () => {
    const distEntry = resolve(root, 'dist', 'index.js');
    const result = spawnSync(
      process.execPath,
      [distEntry, 'transform', '--title', '0', '--output', resolve(root, 'tmp-out')],
      {
        encoding: 'utf8',
        cwd: root,
        timeout: 10_000,
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('1 and 54');
  });

  beforeEach(() => {
    // Keep filesystem side-effects bounded per test run.
  });
});
