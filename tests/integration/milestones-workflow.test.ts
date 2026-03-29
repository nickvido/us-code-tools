import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';

type MetadataOptions = {
  duplicateAnnualTag?: boolean;
};

describe('milestones workflow integration', () => {
  const root = resolve(process.cwd());
  const distEntry = resolve(root, 'dist', 'index.js');

  beforeAll(() => {
    execSync('npm run build', { cwd: root, stdio: 'ignore' });
  });

  function runCli(args: string[], cwd = root) {
    return spawnSync(process.execPath, [distEntry, ...args], {
      cwd,
      encoding: 'utf8',
      timeout: 30_000,
      env: process.env,
    });
  }

  function createTargetRepo() {
    const sandbox = mkdtempSync(join(tmpdir(), 'us-code-tools-milestones-workflow-'));
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

    return { sandbox, targetRepo, sha2013, sha2015 };
  }

  function writeMetadataFile(sandbox: string, sha2013: string, sha2015: string, options: MetadataOptions = {}) {
    const metadataPath = resolve(sandbox, 'legal-milestones.json');
    const annual2015Tag = options.duplicateAnnualTag ? 'annual/2013' : 'annual/2015';

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
              annual_tag: annual2015Tag,
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

    return metadataPath;
  }

  it('apply creates the annual, pl, congress, and president tags plus a byte-stable manifest', () => {
    const { sandbox, targetRepo, sha2013, sha2015 } = createTargetRepo();
    const metadataPath = writeMetadataFile(sandbox, sha2013, sha2015);

    try {
      const first = runCli(['milestones', 'apply', '--target', targetRepo, '--metadata', metadataPath]);
      expect(first.status).toBe(0);

      const firstTags = execSync('git tag --list --sort=refname', { cwd: targetRepo, encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter(Boolean);
      expect(firstTags).toEqual([
        'annual/2013',
        'annual/2015',
        'congress/113',
        'pl/113-1',
        'pl/113-295',
        'president/obama-2',
      ]);

      expect(execSync('git rev-list -n 1 annual/2013', { cwd: targetRepo, encoding: 'utf8' }).trim()).toBe(sha2013);
      expect(execSync('git rev-list -n 1 pl/113-1', { cwd: targetRepo, encoding: 'utf8' }).trim()).toBe(sha2013);
      expect(execSync('git rev-list -n 1 annual/2015', { cwd: targetRepo, encoding: 'utf8' }).trim()).toBe(sha2015);
      expect(execSync('git rev-list -n 1 pl/113-295', { cwd: targetRepo, encoding: 'utf8' }).trim()).toBe(sha2015);
      expect(execSync('git rev-list -n 1 congress/113', { cwd: targetRepo, encoding: 'utf8' }).trim()).toBe(sha2015);
      expect(execSync('git rev-list -n 1 president/obama-2', { cwd: targetRepo, encoding: 'utf8' }).trim()).toBe(sha2013);

      const manifestPath = resolve(targetRepo, '.us-code-tools', 'milestones.json');
      expect(existsSync(manifestPath)).toBe(true);
      const firstManifest = readFileSync(manifestPath, 'utf8');
      const parsed = JSON.parse(firstManifest) as {
        metadata?: { path?: string; sha256?: string };
        annual_rows?: Array<Record<string, unknown>>;
        congress_tags?: Array<Record<string, unknown>>;
        president_tags?: Array<Record<string, unknown>>;
        skipped_president_tags?: Array<Record<string, unknown>>;
        release_candidates?: Array<Record<string, unknown>>;
      };

      expect(parsed.metadata?.path).toBe(metadataPath);
      expect(parsed.metadata?.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(parsed.annual_rows).toEqual([
        {
          annual_tag: 'annual/2013',
          annual_tag_sha: sha2013,
          pl_tag: 'pl/113-1',
          pl_tag_sha: sha2013,
          snapshot_date: '2013-01-21',
          release_point: 'PL 113-1',
          congress: 113,
          president_term: 'obama-2',
          commit_sha: sha2013,
          is_congress_boundary: false,
        },
        {
          annual_tag: 'annual/2015',
          annual_tag_sha: sha2015,
          pl_tag: 'pl/113-295',
          pl_tag_sha: sha2015,
          snapshot_date: '2015-01-20',
          release_point: 'PL 113-295',
          congress: 113,
          president_term: 'obama-2',
          commit_sha: sha2015,
          is_congress_boundary: true,
        },
      ]);
      expect(parsed.congress_tags).toEqual([
        { tag: 'congress/113', congress: 113, commit_sha: sha2015, annual_tag: 'annual/2015' },
      ]);
      expect(parsed.president_tags).toEqual([
        {
          tag: 'president/obama-2',
          slug: 'obama-2',
          inauguration_date: '2013-01-20',
          commit_sha: sha2013,
          annual_tag: 'annual/2013',
        },
      ]);
      expect(parsed.skipped_president_tags).toEqual([
        {
          slug: 'obama-1',
          inauguration_date: '2009-01-20',
          reason: 'inauguration_before_coverage_window',
        },
        {
          slug: 'trump-1',
          inauguration_date: '2017-01-20',
          reason: 'no_snapshot_on_or_after_inauguration',
        },
      ]);
      expect(parsed.release_candidates).toEqual([
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

      const second = runCli(['milestones', 'apply', '--target', targetRepo, '--metadata', metadataPath]);
      expect(second.status).toBe(0);
      const secondManifest = readFileSync(manifestPath, 'utf8');
      expect(secondManifest).toBe(firstManifest);
      expect(execSync('git tag --list --sort=refname', { cwd: targetRepo, encoding: 'utf8' }).trim().split('\n').filter(Boolean)).toEqual(firstTags);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('refuses apply when the target repository has a dirty working tree and creates zero milestone tags', () => {
    const { sandbox, targetRepo, sha2013, sha2015 } = createTargetRepo();
    const metadataPath = writeMetadataFile(sandbox, sha2013, sha2015);
    writeFileSync(resolve(targetRepo, 'dirty.txt'), 'uncommitted\n');

    try {
      const result = runCli(['milestones', 'apply', '--target', targetRepo, '--metadata', metadataPath]);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/repo_dirty|dirty working tree|clean/i);
      expect(execSync('git tag --list', { cwd: targetRepo, encoding: 'utf8' }).trim()).toBe('');
      expect(existsSync(resolve(targetRepo, '.us-code-tools', 'milestones.json'))).toBe(false);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('fails validation on duplicate annual tag metadata before creating tags or a manifest', () => {
    const { sandbox, targetRepo, sha2013, sha2015 } = createTargetRepo();
    const metadataPath = writeMetadataFile(sandbox, sha2013, sha2015, { duplicateAnnualTag: true });

    try {
      const result = runCli(['milestones', 'plan', '--target', targetRepo, '--metadata', metadataPath]);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/duplicate|annual\/2013|metadata_invalid|errors/i);
      expect(execSync('git tag --list', { cwd: targetRepo, encoding: 'utf8' }).trim()).toBe('');
      expect(existsSync(resolve(targetRepo, '.us-code-tools', 'milestones.json'))).toBe(false);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('refuses release when the manifest is missing or stale before any GitHub write', () => {
    const { sandbox, targetRepo, sha2013, sha2015 } = createTargetRepo();
    const metadataPath = writeMetadataFile(sandbox, sha2013, sha2015);

    try {
      const missingManifest = runCli(['milestones', 'release', '--target', targetRepo, '--metadata', metadataPath]);
      expect(missingManifest.status).not.toBe(0);
      expect(`${missingManifest.stdout}\n${missingManifest.stderr}`).toMatch(/manifest_missing|manifest|fresh/i);

      const apply = runCli(['milestones', 'apply', '--target', targetRepo, '--metadata', metadataPath]);
      expect(apply.status).toBe(0);

      const manifestPath = resolve(targetRepo, '.us-code-tools', 'milestones.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, release_candidates: [] }, null, 2));

      const staleManifest = runCli(['milestones', 'release', '--target', targetRepo, '--metadata', metadataPath]);
      expect(staleManifest.status).not.toBe(0);
      expect(`${staleManifest.stdout}\n${staleManifest.stderr}`).toMatch(/manifest_stale|manifest_invalid|fresh/i);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
