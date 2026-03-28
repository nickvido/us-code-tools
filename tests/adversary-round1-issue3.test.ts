import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';

function runBackfill(target: string) {
  const distEntry = resolve(process.cwd(), 'dist', 'index.js');
  return spawnSync(process.execPath, [
    distEntry,
    'backfill',
    '--phase',
    'constitution',
    '--target',
    target,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 180_000,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'QA Bot',
      GIT_AUTHOR_EMAIL: 'qa@example.com',
      GIT_COMMITTER_NAME: 'QA Bot',
      GIT_COMMITTER_EMAIL: 'qa@example.com',
    },
  });
}

function parseSummary(stdout: string, stderr: string): Record<string, unknown> | null {
  const all = `${stdout}\n${stderr}`;
  const payload = all
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('{') && line.endsWith('}'));

  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('adversary: configured remote push must be explicit', () => {
  it('uses explicit current-branch push when remote exists but upstream is absent', () => {
    const target = mkdtempSync(join(tmpdir(), 'us-code-tools-backfill-target-'));
    const remote = mkdtempSync(join(tmpdir(), 'us-code-tools-backfill-remote-'));

    try {
      execSync(`git -C ${JSON.stringify(target)} init`, {
        cwd: process.cwd(),
        stdio: 'ignore',
      });
      execSync(`git -C ${JSON.stringify(remote)} init --bare`, {
        cwd: process.cwd(),
        stdio: 'ignore',
      });

      execSync(`git -C ${JSON.stringify(target)} remote add origin ${JSON.stringify(remote)}`, {
        cwd: process.cwd(),
        stdio: 'ignore',
      });

      const upstreamCheck = spawnSync('git', ['-C', target, 'rev-parse', '--abbrev-ref', '@{u}'], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });
      expect(upstreamCheck.status).not.toBe(0);
      expect((upstreamCheck.stderr as string | undefined) ?? '').toMatch(/no upstream|fatal:/i);

      const result = runBackfill(target);
      const output = `${result.stdout}${result.stderr}`;
      const summary = parseSummary(result.stdout, result.stderr);

      expect(result.status).toBe(0);
      expect(summary).not.toBeNull();
      expect(summary?.phase).toBe('constitution');
      expect(summary?.pushResult ?? summary?.push_result).toBe('pushed');

      expect(output).not.toContain('has no upstream branch');
      expect(output).not.toMatch(/no upstream/i);

      const localBranch = execSync(`git -C ${JSON.stringify(target)} symbolic-ref --short HEAD`, {
        cwd: process.cwd(),
        encoding: 'utf8',
      }).toString().trim();

      const remoteHeadRef = execSync(
        `git -C ${JSON.stringify(remote)} rev-parse --verify "refs/heads/${localBranch}"`,
        {
          cwd: process.cwd(),
          encoding: 'utf8',
        },
      ).toString().trim();

      const localHead = execSync(`git -C ${JSON.stringify(target)} rev-parse HEAD`, {
        cwd: process.cwd(),
        encoding: 'utf8',
      }).toString().trim();
      expect(remoteHeadRef).toBe(localHead);

      const remoteHasCommits = Number(
        execSync(`git -C ${JSON.stringify(remote)} rev-list --count --all`, {
          cwd: process.cwd(),
          encoding: 'utf8',
        }).toString().trim(),
      );
      expect(remoteHasCommits).toBe(28);

      const remoteRefs = execSync(
        `git -C ${JSON.stringify(remote)} for-each-ref --format='%(refname:short)' refs/heads`,
        {
          cwd: process.cwd(),
          encoding: 'utf8',
        },
      ).toString().trim().split('\n').filter(Boolean);
      expect(remoteRefs.length).toBeGreaterThan(0);
    } finally {
      if (existsSync(target)) {
        rmSync(target, { recursive: true, force: true });
      }
      if (existsSync(remote)) {
        rmSync(remote, { recursive: true, force: true });
      }
    }
  }, 180000);
});
