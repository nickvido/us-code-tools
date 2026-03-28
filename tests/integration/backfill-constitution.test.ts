import { describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';

function runBackfill(target: string) {
  const distEntry = resolve(process.cwd(), 'dist', 'index.js');
  return spawnSync(process.execPath, [distEntry, 'backfill', '--phase', 'constitution', '--target', target], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'QA Bot',
      GIT_AUTHOR_EMAIL: 'qa@example.com',
      GIT_COMMITTER_NAME: 'QA Bot',
      GIT_COMMITTER_EMAIL: 'qa@example.com',
    },
  });
}

function parseJsonResult(stdout: string, stderr: string): Record<string, unknown> | null {
  const payload = [...stdout.split('\n'), ...stderr.split('\n')].find((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith('{') && trimmed.endsWith('}');
  });
  if (!payload) return null;
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function gitLogFormat(repo: string): string[] {
  const revisions = execSync(`git -C ${JSON.stringify(repo)} rev-list --reverse HEAD`, {
    encoding: 'utf8',
    cwd: process.cwd(),
  }).toString().trim().split('\n').filter(Boolean);

  return revisions.map((revision) => {
    const commit = execSync(`git -C ${JSON.stringify(repo)} cat-file -p ${revision}`, {
      encoding: 'utf8',
      cwd: process.cwd(),
    }).toString();
    const lines = commit.split('\n');
    const authorLine = lines.find((line) => line.startsWith('author '));
    const message = commit.split('\n\n').slice(1).join('\n\n').trim().split('\n')[0];
    const match = /^author .+ <.+> (-?\d+) ([+-]\d{4})$/.exec(authorLine ?? '');
    if (!match) {
      throw new Error(`Could not parse author line for ${revision}`);
    }

    const isoDate = new Date(Number(match[1]) * 1000).toISOString().slice(0, 19).replace('T', ' ');
    return `${isoDate} ${match[2]} ${message}`;
  });
}

function assertConstitutionTree(repo: string) {
  const expected = [
    ...['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'].map((numeral) => `article-${numeral}.md`),
    ...Array.from({ length: 27 }, (_, idx) => `amendment-${String(idx + 1).padStart(2, '0')}.md`),
  ].sort();

  const files = readdirSync(resolve(repo, 'constitution')).sort();
  expect(files).toEqual(expected);
}

function assertChronologicalDates(logLines: string[]) {
  const getDate = (line: string) => line.slice(0, 10);
  for (let i = 1; i < logLines.length; i += 1) {
    expect(getDate(logLines[i]) >= getDate(logLines[i - 1])).toBe(true);
  }
  expect(logLines[0]).toMatch(/^1788-06-21 00:00:00 \+0000 /);
  expect(logLines[logLines.length - 1]).toMatch(/^1992-05-07 00:00:00 \+0000 /);
}

function writeUnrelatedCommit(repo: string) {
  execSync(`git -C ${JSON.stringify(repo)} init`, { cwd: process.cwd(), stdio: 'ignore' });
  writeFileSync(join(repo, 'unrelated.txt'), 'unrelated', 'utf8');
  execSync(`git -C ${JSON.stringify(repo)} add unrelated.txt`, { cwd: process.cwd(), stdio: 'ignore' });
  execSync(`git -C ${JSON.stringify(repo)} commit -m "unrelated history" -q`, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Unrelated',
      GIT_AUTHOR_EMAIL: 'unrelated@example.com',
      GIT_COMMITTER_NAME: 'Unrelated',
      GIT_COMMITTER_EMAIL: 'unrelated@example.com',
    },
  });
}

describe('backfill constitution integration', () => {
  const LONG_TIMEOUT_MS = 20_000;
  it('creates 28 constitution commits and deterministic target files in a fresh repo', () => {
    const target = mkdtempSync(join(tmpdir(), 'us-code-tools-backfill-'));
    try {
      const result = runBackfill(target);

      expect(result.status).toBe(0);
      const summary = parseJsonResult(result.stdout, result.stderr);
      expect(summary?.phase).toBe('constitution');
      expect(summary?.eventsPlanned).toBe(28);
      expect(summary?.eventsApplied ?? summary?.events_applied).toBe(28);
      expect(summary?.pushResult ?? summary?.push_result).toBe('skipped-local-only');

      const revCount = Number(
        execSync(`git -C ${JSON.stringify(target)} rev-list --count HEAD`, {
          cwd: process.cwd(),
          encoding: 'utf8',
        }).toString().trim(),
      );
      expect(revCount).toBe(28);

      assertConstitutionTree(target);

      const logLines = gitLogFormat(target);
      expect(logLines).toHaveLength(28);
      assertChronologicalDates(logLines);
      expect(logLines[9]).toContain('1791-12-15');

      const status = execSync(`git -C ${JSON.stringify(target)} status --porcelain`, {
        cwd: process.cwd(),
        encoding: 'utf8',
      }).toString();
      expect(status).toBe('');
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  }, LONG_TIMEOUT_MS);

  it('is idempotent on second run (no new commits added)', () => {
    const target = mkdtempSync(join(tmpdir(), 'us-code-tools-backfill-'));
    try {
      const first = runBackfill(target);
      expect(first.status).toBe(0);

      const afterFirst = Number(
        execSync(`git -C ${JSON.stringify(target)} rev-list --count HEAD`, {
          cwd: process.cwd(),
          encoding: 'utf8',
        }).toString().trim(),
      );
      expect(afterFirst).toBe(28);

      const second = runBackfill(target);
      expect(second.status).toBe(0);
      const afterSecond = Number(
        execSync(`git -C ${JSON.stringify(target)} rev-list --count HEAD`, {
          cwd: process.cwd(),
          encoding: 'utf8',
        }).toString().trim(),
      );
      expect(afterSecond).toBe(28);
      const summary = parseJsonResult(second.stdout, second.stderr);
      expect(summary?.eventsSkipped ?? summary?.events_skipped).toBe(28);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  }, LONG_TIMEOUT_MS);

  it('supports resume from a contiguous prefix and fills missing suffix', () => {
    const target = mkdtempSync(join(tmpdir(), 'us-code-tools-backfill-prefix-'));
    try {
      expect(runBackfill(target).status).toBe(0);

      execSync(`git -C ${JSON.stringify(target)} reset --hard HEAD~3`, {
        cwd: process.cwd(),
        stdio: 'ignore',
      });
      const afterTrim = Number(
        execSync(`git -C ${JSON.stringify(target)} rev-list --count HEAD`, {
          cwd: process.cwd(),
          encoding: 'utf8',
        }).toString().trim(),
      );
      expect(afterTrim).toBe(25);

      const resumed = runBackfill(target);
      expect(resumed.status).toBe(0);
      const count = Number(
        execSync(`git -C ${JSON.stringify(target)} rev-list --count HEAD`, {
          cwd: process.cwd(),
          encoding: 'utf8',
        }).toString().trim(),
      );
      expect(count).toBe(28);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  }, LONG_TIMEOUT_MS);

  it('rejects an existing populated non-git directory before init', () => {
    const target = mkdtempSync(join(tmpdir(), 'us-code-tools-backfill-populated-'));
    try {
      const sentinel = join(target, 'preexisting.txt');
      writeFileSync(sentinel, 'already-there', 'utf8');

      const result = runBackfill(target);
      expect(result.status).not.toBe(0);
      const output = `${result.stdout}${result.stderr}`;
      expect(output).toContain('populated non-git');

      const hasGit = existsSync(resolve(target, '.git'));
      expect(hasGit).toBe(false);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('rejects dirty target repositories before writing any commits', () => {
    const target = mkdtempSync(join(tmpdir(), 'us-code-tools-backfill-dirty-'));
    try {
      execSync(`git -C ${JSON.stringify(target)} init`, { cwd: process.cwd(), stdio: 'ignore' });
      writeFileSync(join(target, 'scratch.txt'), 'dirty');

      const result = runBackfill(target);
      expect(result.status).not.toBe(0);
      const output = `${result.stdout}${result.stderr}`;
      expect(output).toContain('working tree must be clean');

      const revCount = Number(
        execSync(`git -C ${JSON.stringify(target)} rev-list --count --all`, {
          cwd: process.cwd(),
          encoding: 'utf8',
        }).toString().trim(),
      );
      expect(revCount).toBe(0);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('rejects unrelated pre-existing history and does not append backfill commits', () => {
    const target = mkdtempSync(join(tmpdir(), 'us-code-tools-backfill-history-'));
    try {
      writeUnrelatedCommit(target);

      const before = Number(
        execSync(`git -C ${JSON.stringify(target)} rev-list --count HEAD`, {
          cwd: process.cwd(),
          encoding: 'utf8',
        }).toString().trim(),
      );
      expect(before).toBe(1);

      const result = runBackfill(target);
      expect(result.status).not.toBe(0);
      const output = `${result.stdout}${result.stderr}`;
      expect(output).toContain('non-prefix');

      const after = Number(
        execSync(`git -C ${JSON.stringify(target)} rev-list --count HEAD`, {
          cwd: process.cwd(),
          encoding: 'utf8',
        }).toString().trim(),
      );
      expect(after).toBe(1);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });



  it('accepts empty non-git directory target by initializing git in place', () => {
    const target = mkdtempSync(join(tmpdir(), 'us-code-tools-backfill-emptydir-'));
    const nested = mkdtempSync(join(tmpdir(), 'us-code-tools-empty-nested-'));
    rmSync(target, { recursive: true, force: true });
    const emptyExisting = resolve(nested, 'empty-target');
    execSync(`mkdir -p ${JSON.stringify(emptyExisting)}`);

    const result = runBackfill(emptyExisting);
    expect(result.status).toBe(0);

    const isGit = execSync(`git -C ${JSON.stringify(emptyExisting)} rev-parse --is-inside-work-tree`, {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).toString().trim();
    expect(isGit).toBe('true');

    const revCount = Number(
      execSync(`git -C ${JSON.stringify(emptyExisting)} rev-list --count HEAD`, {
        cwd: process.cwd(),
        encoding: 'utf8',
      }).toString().trim(),
    );
    expect(revCount).toBe(28);

    rmSync(emptyExisting, { recursive: true, force: true });
    rmSync(nested, { recursive: true, force: true });
  }, LONG_TIMEOUT_MS);
});
