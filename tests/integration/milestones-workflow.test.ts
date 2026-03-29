import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';

type MetadataOptions = {
  duplicateAnnualTag?: boolean;
};

type RunCliOptions = {
  env?: NodeJS.ProcessEnv;
};

describe('milestones workflow integration', () => {
  const root = resolve(process.cwd());
  const distEntry = resolve(root, 'dist', 'index.js');

  beforeAll(() => {
    execSync('npm run build', { cwd: root, stdio: 'ignore' });
  });

  function runCli(args: string[], cwd = root, options: RunCliOptions = {}) {
    return spawnSync(process.execPath, [distEntry, ...args], {
      cwd,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, ...options.env },
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

  function createReleaseTargetRepo() {
    const sandbox = mkdtempSync(join(tmpdir(), 'us-code-tools-milestones-release-'));
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

    writeFileSync(resolve(targetRepo, 'snapshot-2017.md'), '2017\n');
    execSync('git add snapshot-2017.md && GIT_AUTHOR_DATE="2017-01-20T00:00:00Z" GIT_COMMITTER_DATE="2017-01-20T00:00:00Z" git commit -m "snapshot 2017"', {
      cwd: targetRepo,
      stdio: 'ignore',
      shell: '/bin/bash',
    });
    const sha2017 = execSync('git rev-parse HEAD', { cwd: targetRepo, encoding: 'utf8' }).trim();

    return { sandbox, targetRepo, sha2013, sha2015, sha2017 };
  }

  function writeReleaseMetadataFile(sandbox: string, sha2013: string, sha2015: string, sha2017: string) {
    const metadataPath = resolve(sandbox, 'legal-milestones-release.json');
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
            {
              annual_tag: 'annual/2017',
              snapshot_date: '2017-01-20',
              release_point: 'PL 114-255',
              commit_selector: sha2017,
              congress: 114,
              president_term: 'trump-1',
              is_congress_boundary: true,
              release_notes: {
                scope: 'congress',
                notable_laws: ['Water Infrastructure Improvements for the Nation Act'],
                summary_counts: {
                  titles_changed: 9,
                  chapters_changed: 10,
                  sections_added: 11,
                  sections_amended: 12,
                  sections_repealed: 2,
                },
                narrative: 'Congress summary for the 114th Congress boundary snapshot.',
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

  function createFakeGhBin(sandbox: string) {
    const binDir = resolve(sandbox, 'fake-bin');
    mkdirSync(binDir, { recursive: true });
    const logPath = resolve(sandbox, 'gh-log.jsonl');
    const statePath = resolve(sandbox, 'gh-state.json');
    const ghPath = resolve(binDir, 'gh');

    writeFileSync(
      ghPath,
      `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs');
const logPath = process.env.FAKE_GH_LOG;
const statePath = process.env.FAKE_GH_STATE;
const args = process.argv.slice(2);
const entry = { args };
appendFileSync(logPath, JSON.stringify(entry) + '\\n');
const readState = () => existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { releases: {} };
const writeState = (state) => writeFileSync(statePath, JSON.stringify(state, null, 2));
if (args[0] === 'auth' && args[1] === 'status') process.exit(0);
if (args[0] === 'release' && args[1] === 'view') {
  const tag = args[2];
  const state = readState();
  const release = state.releases[tag];
  if (!release) process.exit(1);
  process.stdout.write(JSON.stringify({ tagName: tag, name: release.title, url: 'https://example.test/' + tag }));
  process.exit(0);
}
if (args[0] === 'release' && (args[1] === 'create' || args[1] === 'edit')) {
  const mode = args[1];
  const tag = args[2];
  const title = args[args.indexOf('--title') + 1];
  const notesFile = args[args.indexOf('--notes-file') + 1];
  const body = readFileSync(notesFile, 'utf8');
  const state = readState();
  state.releases[tag] = { mode, title, body };
  writeState(state);
  process.exit(0);
}
process.exit(1);
`,
      { mode: 0o755 },
    );

    return { binDir, logPath, statePath };
  }

  function createGitOnlyBin(sandbox: string) {
    const binDir = resolve(sandbox, 'git-only-bin');
    mkdirSync(binDir, { recursive: true });
    symlinkSync(execSync('command -v git', { encoding: 'utf8', shell: '/bin/bash' }).trim(), resolve(binDir, 'git'));
    return binDir;
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
      ]);

      expect(execSync('git rev-list -n 1 annual/2013', { cwd: targetRepo, encoding: 'utf8' }).trim()).toBe(sha2013);
      expect(execSync('git rev-list -n 1 pl/113-1', { cwd: targetRepo, encoding: 'utf8' }).trim()).toBe(sha2013);
      expect(execSync('git rev-list -n 1 annual/2015', { cwd: targetRepo, encoding: 'utf8' }).trim()).toBe(sha2015);
      expect(execSync('git rev-list -n 1 pl/113-295', { cwd: targetRepo, encoding: 'utf8' }).trim()).toBe(sha2015);
      expect(execSync('git rev-list -n 1 congress/113', { cwd: targetRepo, encoding: 'utf8' }).trim()).toBe(sha2015);
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
      expect(parsed.president_tags).toEqual([]);
      expect(parsed.skipped_president_tags).toEqual([
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

  it('fails apply with detached_head when the target repository HEAD is not attached to a branch', () => {
    const { sandbox, targetRepo, sha2013, sha2015 } = createTargetRepo();
    const metadataPath = writeMetadataFile(sandbox, sha2013, sha2015);

    execSync(`git checkout --detach ${sha2015}`, { cwd: targetRepo, stdio: 'ignore', shell: '/bin/bash' });

    try {
      const result = runCli(['milestones', 'apply', '--target', targetRepo, '--metadata', metadataPath]);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/detached_head|HEAD must be attached to a branch/i);
      expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/repo_dirty/);
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

  it('publishes congress releases with the required sections and updates existing releases in place by tag', () => {
    const { sandbox, targetRepo, sha2013, sha2015, sha2017 } = createReleaseTargetRepo();
    const metadataPath = writeReleaseMetadataFile(sandbox, sha2013, sha2015, sha2017);
    const fakeGh = createFakeGhBin(sandbox);

    try {
      const apply = runCli(['milestones', 'apply', '--target', targetRepo, '--metadata', metadataPath]);
      expect(apply.status).toBe(0);

      const env = {
        PATH: `${fakeGh.binDir}:${process.env.PATH ?? ''}`,
        FAKE_GH_LOG: fakeGh.logPath,
        FAKE_GH_STATE: fakeGh.statePath,
      };

      const firstRelease = runCli(['milestones', 'release', '--target', targetRepo, '--metadata', metadataPath], root, { env });
      expect(firstRelease.status).toBe(0);

      const firstState = JSON.parse(readFileSync(fakeGh.statePath, 'utf8')) as {
        releases: Record<string, { mode: string; title: string; body: string }>;
      };
      expect(Object.keys(firstState.releases).sort()).toEqual(['congress/113', 'congress/114']);
      expect(firstState.releases['congress/113']).toMatchObject({
        mode: 'create',
        title: '113th Congress (2013–2014)',
      });
      expect(firstState.releases['congress/114']).toMatchObject({
        mode: 'create',
        title: '114th Congress (2015–2016)',
      });
      expect(firstState.releases['congress/113'].body).toContain('## Diff Stat\n\nBaseline release: no prior congress tag in scope.');
      expect(firstState.releases['congress/113'].body).toContain('## Summary');
      expect(firstState.releases['congress/113'].body).toContain('Titles changed: 5');
      expect(firstState.releases['congress/113'].body).toContain('## Notable Laws');
      expect(firstState.releases['congress/113'].body).toContain('Carl Levin and Howard P. “Buck” McKeon National Defense Authorization Act for Fiscal Year 2015');
      expect(firstState.releases['congress/113'].body).toContain('## Narrative');
      expect(firstState.releases['congress/113'].body).toContain('Congress summary for the 113th Congress boundary snapshot.');
      expect(firstState.releases['congress/114'].body).toMatch(/## Diff Stat[\s\S]*snapshot-2017\.md/);
      expect(firstState.releases['congress/114'].body).toMatch(/## Diff Stat[\s\S]*## Summary[\s\S]*## Notable Laws[\s\S]*## Narrative/);
      expect(firstState.releases['congress/114'].body).toContain('Titles changed: 9');
      expect(firstState.releases['congress/114'].body).toContain('Water Infrastructure Improvements for the Nation Act');
      expect(firstState.releases['congress/114'].body).toContain('Congress summary for the 114th Congress boundary snapshot.');

      const secondRelease = runCli(['milestones', 'release', '--target', targetRepo, '--metadata', metadataPath], root, { env });
      expect(secondRelease.status).toBe(0);

      const secondState = JSON.parse(readFileSync(fakeGh.statePath, 'utf8')) as {
        releases: Record<string, { mode: string; title: string; body: string }>;
      };
      expect(Object.keys(secondState.releases).sort()).toEqual(['congress/113', 'congress/114']);
      expect(secondState.releases['congress/113'].mode).toBe('edit');
      expect(secondState.releases['congress/114'].mode).toBe('edit');

      const ghLog = readFileSync(fakeGh.logPath, 'utf8');
      expect(ghLog).toMatch(/"args":\["release","view","congress\/113"/);
      expect(ghLog).toMatch(/"args":\["release","create","congress\/113"/);
      expect(ghLog).toMatch(/"args":\["release","edit","congress\/113"/);
      expect(ghLog).toMatch(/"args":\["release","view","congress\/114"/);
      expect(ghLog).toMatch(/"args":\["release","create","congress\/114"/);
      expect(ghLog).toMatch(/"args":\["release","edit","congress\/114"/);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('fails release freshness validation when a pl tag SHA drifts even if annual and congress tags still match', () => {
    const { sandbox, targetRepo, sha2013, sha2015, sha2017 } = createReleaseTargetRepo();
    const metadataPath = writeReleaseMetadataFile(sandbox, sha2013, sha2015, sha2017);
    const fakeGh = createFakeGhBin(sandbox);

    try {
      const apply = runCli(['milestones', 'apply', '--target', targetRepo, '--metadata', metadataPath]);
      expect(apply.status).toBe(0);

      execSync('git tag -d pl/114-255', { cwd: targetRepo, stdio: 'ignore' });
      execSync(`git tag -a pl/114-255 ${sha2015} -m "drifted pl tag"`, { cwd: targetRepo, stdio: 'ignore', shell: '/bin/bash' });

      const result = runCli(
        ['milestones', 'release', '--target', targetRepo, '--metadata', metadataPath],
        root,
        {
          env: {
            PATH: `${fakeGh.binDir}:${process.env.PATH ?? ''}`,
            FAKE_GH_LOG: fakeGh.logPath,
            FAKE_GH_STATE: fakeGh.statePath,
          },
        },
      );
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/manifest_stale|pl\/114-255|fresh/i);
      expect(existsSync(fakeGh.statePath)).toBe(false);
      expect(existsSync(fakeGh.logPath)).toBe(false);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('fails closed with git_cli_unavailable before apply mutates tags or writes the manifest', () => {
    const { sandbox, targetRepo, sha2013, sha2015 } = createTargetRepo();
    const metadataPath = writeMetadataFile(sandbox, sha2013, sha2015);

    try {
      const result = runCli(
        ['milestones', 'apply', '--target', targetRepo, '--metadata', metadataPath],
        root,
        { env: { PATH: resolve(sandbox, 'missing-git-bin') } },
      );

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/git_cli_unavailable|git.*unavailable/i);
      expect(execSync('git tag --list', { cwd: targetRepo, encoding: 'utf8' }).trim()).toBe('');
      expect(existsSync(resolve(targetRepo, '.us-code-tools', 'milestones.json'))).toBe(false);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('fails closed with github_cli_unavailable before release writes when gh cannot be resolved', () => {
    const { sandbox, targetRepo, sha2013, sha2015, sha2017 } = createReleaseTargetRepo();
    const metadataPath = writeReleaseMetadataFile(sandbox, sha2013, sha2015, sha2017);
    const gitOnlyBin = createGitOnlyBin(sandbox);

    try {
      const apply = runCli(['milestones', 'apply', '--target', targetRepo, '--metadata', metadataPath]);
      expect(apply.status).toBe(0);

      const result = runCli(
        ['milestones', 'release', '--target', targetRepo, '--metadata', metadataPath],
        root,
        { env: { PATH: gitOnlyBin } },
      );

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/github_cli_unavailable|gh.*unavailable/i);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('surfaces the repo-local lock payload and leaves the lock untouched on conflict', () => {
    const { sandbox, targetRepo, sha2013, sha2015 } = createTargetRepo();
    const metadataPath = writeMetadataFile(sandbox, sha2013, sha2015);
    const lockDir = resolve(targetRepo, '.us-code-tools');
    const lockPath = resolve(lockDir, 'milestones.lock');
    const existingLock = {
      pid: 4242,
      hostname: hostname(),
      command: 'milestones apply --target fixture --metadata fixture.json',
      timestamp: '2026-03-29T20:00:00.000Z',
    };

    mkdirSync(lockDir, { recursive: true });
    writeFileSync(lockPath, `${JSON.stringify(existingLock, null, 2)}\n`);

    try {
      const result = runCli(['milestones', 'apply', '--target', targetRepo, '--metadata', metadataPath]);

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/lock_conflict/i);
      expect(`${result.stdout}\n${result.stderr}`).toContain(String(existingLock.pid));
      expect(`${result.stdout}\n${result.stderr}`).toContain(existingLock.hostname);
      expect(`${result.stdout}\n${result.stderr}`).toContain(existingLock.command);
      expect(`${result.stdout}\n${result.stderr}`).toContain(existingLock.timestamp);
      expect(readFileSync(lockPath, 'utf8')).toBe(`${JSON.stringify(existingLock, null, 2)}\n`);
      expect(execSync('git tag --list', { cwd: targetRepo, encoding: 'utf8' }).trim()).toBe('');
      expect(existsSync(resolve(targetRepo, '.us-code-tools', 'milestones.json'))).toBe(false);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
