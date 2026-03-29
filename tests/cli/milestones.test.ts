import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';

type CliResult = ReturnType<typeof spawnSync>;

describe('milestones CLI contract', () => {
  const root = resolve(process.cwd());
  const distEntry = resolve(root, 'dist', 'index.js');

  beforeAll(() => {
    execSync('npm run build', { cwd: root, stdio: 'ignore' });
  });

  function runCli(args: string[], cwd = root): CliResult {
    return spawnSync(process.execPath, [distEntry, ...args], {
      cwd,
      encoding: 'utf8',
      timeout: 30_000,
      env: process.env,
    });
  }

  it('publishes the canonical committed metadata file for legal milestones', () => {
    const metadataPath = resolve(root, 'docs', 'metadata', 'legal-milestones.json');

    expect(existsSync(metadataPath)).toBe(true);

    const parsed = JSON.parse(readFileSync(metadataPath, 'utf8')) as {
      annual_snapshots?: unknown[];
      president_terms?: unknown[];
    };

    expect(Array.isArray(parsed.annual_snapshots)).toBe(true);
    expect(Array.isArray(parsed.president_terms)).toBe(true);
    expect(parsed.annual_snapshots?.length ?? 0).toBeGreaterThan(0);
    expect(parsed.president_terms?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects unsupported milestones invocations and missing required flags before mutating anything', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'us-code-tools-milestones-usage-'));
    const targetRepo = resolve(sandbox, 'target');
    mkdirSync(targetRepo, { recursive: true });
    execSync('git init', { cwd: targetRepo, stdio: 'ignore' });
    execSync('git config user.name "QA Bot"', { cwd: targetRepo, stdio: 'ignore' });
    execSync('git config user.email "qa@example.com"', { cwd: targetRepo, stdio: 'ignore' });
    writeFileSync(resolve(targetRepo, 'README.md'), '# fixture\n');
    execSync('git add README.md && git commit -m "init"', { cwd: targetRepo, stdio: 'ignore', shell: '/bin/bash' });

    const metadataPath = resolve(sandbox, 'metadata.json');
    writeFileSync(
      metadataPath,
      JSON.stringify({ annual_snapshots: [], president_terms: [] }, null, 2),
    );

    try {
      const missingTarget = runCli(['milestones', 'plan', '--metadata', metadataPath]);
      expect(missingTarget.status).not.toBe(0);
      expect(`${missingTarget.stdout}\n${missingTarget.stderr}`).toMatch(/milestones|plan|target|metadata|usage/i);
      expect(existsSync(resolve(targetRepo, '.us-code-tools', 'milestones.json'))).toBe(false);

      const missingMetadata = runCli(['milestones', 'apply', '--target', targetRepo]);
      expect(missingMetadata.status).not.toBe(0);
      expect(`${missingMetadata.stdout}\n${missingMetadata.stderr}`).toMatch(/milestones|apply|target|metadata|usage/i);
      expect(execSync('git tag --list', { cwd: targetRepo, encoding: 'utf8' }).trim()).toBe('');

      const unsupported = runCli(['milestones', 'publish', '--target', targetRepo, '--metadata', metadataPath]);
      expect(unsupported.status).not.toBe(0);
      expect(`${unsupported.stdout}\n${unsupported.stderr}`).toMatch(/milestones|plan|apply|release|usage|unknown/i);
      expect(execSync('git tag --list', { cwd: targetRepo, encoding: 'utf8' }).trim()).toBe('');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('skips inaugurations before coverage_start even when they fall in the same calendar year', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'us-code-tools-milestones-president-window-'));
    const targetRepo = resolve(sandbox, 'target');
    mkdirSync(targetRepo, { recursive: true });
    execSync('git init', { cwd: targetRepo, stdio: 'ignore' });
    execSync('git config user.name "QA Bot"', { cwd: targetRepo, stdio: 'ignore' });
    execSync('git config user.email "qa@example.com"', { cwd: targetRepo, stdio: 'ignore' });

    writeFileSync(resolve(targetRepo, 'snapshot-2013.md'), '2013 boundary\n');
    execSync('git add snapshot-2013.md && GIT_AUTHOR_DATE="2013-12-31T00:00:00Z" GIT_COMMITTER_DATE="2013-12-31T00:00:00Z" git commit -m "snapshot 2013 boundary"', {
      cwd: targetRepo,
      stdio: 'ignore',
      shell: '/bin/bash',
    });
    const sha2013 = execSync('git rev-parse HEAD', { cwd: targetRepo, encoding: 'utf8' }).trim();

    const metadataPath = resolve(sandbox, 'legal-milestones.json');
    writeFileSync(
      metadataPath,
      JSON.stringify(
        {
          annual_snapshots: [
            {
              annual_tag: 'annual/2013',
              snapshot_date: '2013-12-31',
              release_point: 'PL 113-300',
              commit_selector: sha2013,
              congress: 113,
              president_term: 'obama-2',
              is_congress_boundary: true,
              release_notes: {
                scope: 'congress',
                notable_laws: ['Boundary snapshot'],
                summary_counts: {
                  titles_changed: 1,
                  chapters_changed: 1,
                  sections_added: 1,
                  sections_amended: 0,
                  sections_repealed: 0,
                },
                narrative: 'Boundary coverage starts at the end of 2013.',
              },
            },
          ],
          president_terms: [
            {
              slug: 'obama-2',
              inauguration_date: '2013-01-20',
              president_name: 'Barack Obama',
            },
          ],
        },
        null,
        2,
      ),
    );

    try {
      const result = runCli(['milestones', 'plan', '--target', targetRepo, '--metadata', metadataPath]);
      expect(result.status).toBe(0);

      const plan = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(plan.president_tags).toEqual([]);
      expect(plan.skipped_president_tags).toEqual([
        {
          slug: 'obama-2',
          inauguration_date: '2013-01-20',
          reason: 'inauguration_before_coverage_window',
        },
      ]);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('prints a deterministic plan JSON payload with the required top-level arrays and no side effects', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'us-code-tools-milestones-plan-'));
    const targetRepo = resolve(sandbox, 'target');
    mkdirSync(targetRepo, { recursive: true });
    execSync('git init', { cwd: targetRepo, stdio: 'ignore' });
    execSync('git config user.name "QA Bot"', { cwd: targetRepo, stdio: 'ignore' });
    execSync('git config user.email "qa@example.com"', { cwd: targetRepo, stdio: 'ignore' });

    writeFileSync(resolve(targetRepo, 'snapshot-2013.md'), '2013\n');
    execSync('git add snapshot-2013.md && GIT_AUTHOR_DATE="2013-01-21T00:00:00Z" GIT_COMMITTER_DATE="2013-01-21T00:00:00Z" git commit -m "snapshot 2013"', {
      cwd: targetRepo,
      stdio: 'ignore',
      shell: '/bin/bash',
    });
    const sha2013 = execSync('git rev-parse HEAD', { cwd: targetRepo, encoding: 'utf8' }).trim();

    writeFileSync(resolve(targetRepo, 'snapshot-2015.md'), '2015\n');
    execSync('git add snapshot-2015.md && GIT_AUTHOR_DATE="2015-01-20T00:00:00Z" GIT_COMMITTER_DATE="2015-01-20T00:00:00Z" git commit -m "snapshot 2015"', {
      cwd: targetRepo,
      stdio: 'ignore',
      shell: '/bin/bash',
    });
    const sha2015 = execSync('git rev-parse HEAD', { cwd: targetRepo, encoding: 'utf8' }).trim();

    const metadataPath = resolve(sandbox, 'legal-milestones.json');
    writeFileSync(
      metadataPath,
      JSON.stringify(
        {
          annual_snapshots: [
            {
              annual_tag: 'annual/2013',
              snapshot_date: '2013-01-21',
              release_point: 'PL 113-1',
              commit_selector: sha2013,
              congress: 113,
              president_term: 'obama-2',
              is_congress_boundary: false,
              release_notes: {
                scope: 'annual',
                notable_laws: ['American Taxpayer Relief Act of 2012'],
                summary_counts: {
                  titles_changed: 1,
                  chapters_changed: 2,
                  sections_added: 3,
                  sections_amended: 4,
                  sections_repealed: 0,
                },
                narrative: 'Annual snapshot current through the opening 2013 release point.',
              },
            },
            {
              annual_tag: 'annual/2015',
              snapshot_date: '2015-01-20',
              release_point: 'PL 113-295',
              commit_selector: sha2015,
              congress: 113,
              president_term: 'obama-2',
              is_congress_boundary: true,
              release_notes: {
                scope: 'congress',
                notable_laws: ['Carl Levin and Howard P. “Buck” McKeon National Defense Authorization Act for Fiscal Year 2015'],
                summary_counts: {
                  titles_changed: 5,
                  chapters_changed: 6,
                  sections_added: 7,
                  sections_amended: 8,
                  sections_repealed: 1,
                },
                narrative: 'Congress summary for the 113th Congress boundary snapshot.',
              },
            },
          ],
          president_terms: [
            {
              slug: 'obama-1',
              inauguration_date: '2009-01-20',
              president_name: 'Barack Obama',
            },
            {
              slug: 'obama-2',
              inauguration_date: '2013-01-20',
              president_name: 'Barack Obama',
            },
            {
              slug: 'trump-1',
              inauguration_date: '2017-01-20',
              president_name: 'Donald Trump',
            },
          ],
        },
        null,
        2,
      ),
    );

    try {
      const first = runCli(['milestones', 'plan', '--target', targetRepo, '--metadata', metadataPath]);
      const second = runCli(['milestones', 'plan', '--target', targetRepo, '--metadata', metadataPath]);

      expect(first.status).toBe(0);
      expect(second.status).toBe(0);
      expect(first.stdout).toBe(second.stdout);
      expect(execSync('git tag --list', { cwd: targetRepo, encoding: 'utf8' }).trim()).toBe('');
      expect(existsSync(resolve(targetRepo, '.us-code-tools', 'milestones.json'))).toBe(false);

      const plan = JSON.parse(first.stdout) as Record<string, unknown>;
      expect(plan).toHaveProperty('annual_tags');
      expect(plan).toHaveProperty('pl_tags');
      expect(plan).toHaveProperty('congress_tags');
      expect(plan).toHaveProperty('president_tags');
      expect(plan).toHaveProperty('skipped_president_tags');
      expect(plan).toHaveProperty('release_candidates');
      expect(plan).toHaveProperty('errors');

      expect(plan.annual_tags).toEqual([
        { tag: 'annual/2013', commit_sha: sha2013, snapshot_date: '2013-01-21' },
        { tag: 'annual/2015', commit_sha: sha2015, snapshot_date: '2015-01-20' },
      ]);
      expect(plan.pl_tags).toEqual([
        { tag: 'pl/113-1', commit_sha: sha2013, release_point: 'PL 113-1' },
        { tag: 'pl/113-295', commit_sha: sha2015, release_point: 'PL 113-295' },
      ]);
      expect(plan.congress_tags).toEqual([
        { tag: 'congress/113', commit_sha: sha2015, annual_tag: 'annual/2015' },
      ]);
      expect(plan.president_tags).toEqual([]);
      expect(plan.skipped_president_tags).toEqual([
        {
          slug: 'obama-1',
          inauguration_date: '2009-01-20',
          reason: 'inauguration_before_coverage_window',
        },
        {
          slug: 'obama-2',
          inauguration_date: '2013-01-20',
          reason: 'inauguration_before_coverage_window',
        },
        {
          slug: 'trump-1',
          inauguration_date: '2017-01-20',
          reason: 'no_snapshot_on_or_after_inauguration',
        },
      ]);
      expect(plan.release_candidates).toEqual([
        {
          tag: 'congress/113',
          tag_sha: sha2015,
          previous_tag: null,
          previous_tag_sha: null,
          title: '113th Congress (2013–2014)',
          start_date: '2013',
          end_date: '2014',
        },
      ]);
      expect(plan.errors).toEqual([]);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
