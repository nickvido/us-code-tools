import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import matter from 'gray-matter';

function buildFixtureZip(outputDir: string): string {
  const zipPath = resolve(outputDir, 'title-01-fixture.zip');
  const fixtureDir = resolve(outputDir, 'title-01-xml');
  mkdirSync(fixtureDir, { recursive: true });
  mkdirSync(resolve(fixtureDir, 'nested'), { recursive: true });

  writeFileSync(resolve(fixtureDir, 'usc01.xml'), readFileSync(resolve(process.cwd(), 'tests/fixtures/xml/title-01/01-base.xml')));
  writeFileSync(resolve(fixtureDir, 'nested/usc01-extra.xml'), readFileSync(resolve(process.cwd(), 'tests/fixtures/xml/title-01/02-more.xml')));

  const command = `cd ${JSON.stringify(fixtureDir)} && zip -qr ${JSON.stringify(zipPath)} .`;
  execSync(command, { cwd: outputDir, shell: '/bin/bash' });
  return zipPath;
}

function buildCurrentFormatFixtureZip(outputDir: string, title: number): string {
  const fixtureDir = resolve(outputDir, `title-${String(title).padStart(2, '0')}-xml`);
  const zipPath = resolve(outputDir, `title-${String(title).padStart(2, '0')}.zip`);
  mkdirSync(fixtureDir, { recursive: true });

  const xml = readFileSync(resolve(process.cwd(), 'tests/fixtures/xml/title-01/04-current-uscdoc.xml'), 'utf8')
    .replace(/<docNumber>1<\/docNumber>/g, `<docNumber>${title}</docNumber>`)
    .replace(/identifier="\/us\/usc\/t1"/g, `identifier="/us/usc/t${title}"`)
    .replace(/identifier="\/us\/usc\/t1\/ch1"/g, `identifier="/us/usc/t${title}/ch1"`)
    .replace(/identifier="\/us\/usc\/t1\/s(\d+)"/g, `identifier="/us/usc/t${title}/s$1"`)
    .replace(/<num value="1">Title 1—<\/num>/g, `<num value="${title}">Title ${title}—</num>`);

  writeFileSync(resolve(fixtureDir, `usc${String(title).padStart(2, '0')}.xml`), xml);
  const command = `cd ${JSON.stringify(fixtureDir)} && zip -qr ${JSON.stringify(zipPath)} .`;
  execSync(command, { cwd: outputDir, shell: '/bin/bash' });
  return zipPath;
}

function runTransform(outputDir: string, fixtureZip: string) {
  const distEntry = resolve(process.cwd(), 'dist', 'index.js');
  return spawnSync(process.execPath, [distEntry, 'transform', '--title', '1', '--output', outputDir], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      US_CODE_TOOLS_TITLE_01_FIXTURE_ZIP: fixtureZip,
    },
  });
}

describe('CLI integration — Title 1 fixture run', () => {
  beforeAll(() => {
    execSync('npm run build', { cwd: process.cwd(), stdio: 'ignore' });
  });
  const manifest = JSON.parse(
    readFileSync(resolve(process.cwd(), 'tests', 'fixtures', 'title-01', 'manifest.json'), 'utf8'),
  ) as {
    title: number;
    expected_files: string[];
    expected_parse_errors: string[];
    section_assertions: Record<string, { h1?: string; section?: string; heading?: string }>;
  };

  it('writes expected Title 1 files and reports counts from a committed fixture', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'us-code-tools-it-'));
    const fixtureZip = buildFixtureZip(outputDir);

    const result = runTransform(outputDir, fixtureZip);
    expect(result.status).toBe(0);

    const outTree = resolve(outputDir, 'uscode', `title-${String(manifest.title).padStart(2, '0')}`);
    const written = readdirSync(outTree).sort();

    expect(written).toEqual(expect.arrayContaining(manifest.expected_files));

    const report = parseReportFromStdout(result.stdout);
    expect(report?.title).toBe(1);
    expect(report?.sections_found).toBe(3);
    expect(report?.files_written).toBe(4);
    expect(report?.parse_errors).toHaveLength(manifest.expected_parse_errors.length);
    expect((report?.parse_errors ?? []).map((entry: any) => entry.code)).toEqual(expect.arrayContaining(manifest.expected_parse_errors));

    const titleMarkdown = readFileSync(join(outTree, '_title.md'), 'utf8');
    const parsedTitle = parseFrontmatter(titleMarkdown);
    expect(parsedTitle.data.title).toBe(1);
    expect(parsedTitle.data.sections).toBe(3);

    const nestedSection = readFileSync(join(outTree, 'section-2-3.md'), 'utf8');
    const parsedSection = parseFrontmatter(nestedSection);
    expect(parsedSection.data.section).toBe('2/3');
    expect(parsedSection.data.title).toBe(1);
    expect(nestedSection).toContain(manifest.section_assertions['section-2-3.md'].h1 as string);

    rmSync(outputDir, { recursive: true, force: true });
  });

  it('resolves transform input from the selected OLRC vintage cache layout instead of the legacy fixture env path', async () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-it-selected-vintage-'));
    const fixtureZip = buildFixtureZip(sandboxRoot);
    const titleZipPath = seedSelectedVintageOlrcCache(sandboxRoot, fixtureZip, '119-73', 1);

    const distEntry = resolve(process.cwd(), 'dist', 'index.js');
    const result = spawnSync(process.execPath, [distEntry, 'transform', '--title', '1', '--output', './out'], {
      cwd: sandboxRoot,
      encoding: 'utf8',
      timeout: 60_000,
      env: process.env,
    });

    expect(result.status).toBe(0);

    const report = parseReportFromStdout(result.stdout);
    expect(report?.title).toBe(1);
    expect(report?.sections_found).toBeGreaterThan(0);
    expect(report?.files_written).toBeGreaterThanOrEqual(2);

    const outTree = resolve(sandboxRoot, 'out', 'uscode', 'title-01');
    expect(readdirSync(outTree).sort()).toEqual(expect.arrayContaining(['_title.md', 'section-1.md']));

    const titleMarkdown = readFileSync(join(outTree, '_title.md'), 'utf8');
    expect(titleMarkdown).toContain('title: 1');
    expect(titleMarkdown).toContain('sections: 3');

    expect(readFileSync(titleZipPath)).toEqual(readFileSync(fixtureZip));
    rmSync(sandboxRoot, { recursive: true, force: true });
  });

  it('transforms selected-vintage Title 1 current-format fixtures with 53 sections and path-safe output names', async () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-it-selected-vintage-current-'));
    const fixtureZip = buildCurrentFormatFixtureZip(sandboxRoot, 1);
    seedSelectedVintageOlrcCache(sandboxRoot, fixtureZip, '119-73', 1);

    const distEntry = resolve(process.cwd(), 'dist', 'index.js');
    const result = spawnSync(process.execPath, [distEntry, 'transform', '--title', '1', '--output', './out'], {
      cwd: sandboxRoot,
      encoding: 'utf8',
      timeout: 60_000,
      env: process.env,
    });

    try {
      expect(result.status).toBe(0);

      const report = parseReportFromStdout(result.stdout);
      expect(report?.title).toBe(1);
      expect(report?.sections_found).toBe(53);
      expect(report?.files_written).toBe(54);

      const outTree = resolve(sandboxRoot, 'out', 'uscode', 'title-01');
      const written = readdirSync(outTree).sort();
      expect(written).toContain('_title.md');
      expect(written.filter((name) => /^section-.*\.md$/u.test(name))).toHaveLength(53);
      expect(written).toContain('section-1.md');
      expect(written.some((name) => /§|Title-1|Chapter-1|—|\.\.md/u.test(name))).toBe(false);
      expect(existsSync(join(outTree, 'section-§-1..md'))).toBe(false);

      const titleMarkdown = readFileSync(join(outTree, '_title.md'), 'utf8');
      const parsedTitle = parseFrontmatter(titleMarkdown);
      expect(parsedTitle.data.title).toBe(1);
      expect(parsedTitle.data.sections).toBe(53);
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('transforms numeric titles 1..52 and 54 from selected-vintage cache fixtures while surfacing a reserved-empty diagnostic for title 53', async () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-it-title-matrix-'));
    const vintage = '119-73';
    const fixtureZipByTitle = new Map<number, string>();

    for (let title = 1; title <= 54; title += 1) {
      if (title === 53) {
        continue;
      }

      fixtureZipByTitle.set(title, buildCurrentFormatFixtureZip(sandboxRoot, title));
    }

    seedSelectedVintageOlrcCacheMatrix(sandboxRoot, vintage, fixtureZipByTitle);

    const distEntry = resolve(process.cwd(), 'dist', 'index.js');

    try {
      for (let title = 1; title <= 54; title += 1) {
        const outputDir = resolve(sandboxRoot, `out-${String(title).padStart(2, '0')}`);
        const result = spawnSync(process.execPath, [distEntry, 'transform', '--title', String(title), '--output', outputDir], {
          cwd: sandboxRoot,
          encoding: 'utf8',
          timeout: 60_000,
          env: process.env,
        });

        if (title === 53) {
          expect(result.status).not.toBe(0);
          expect(`${result.stdout}\n${result.stderr}`).toMatch(/reserved|empty|no xml entries|not a zip|zip/i);
          expect(existsSync(resolve(outputDir, 'uscode', 'title-53'))).toBe(false);
          continue;
        }

        expect(result.status).toBe(0);
        const report = parseReportFromStdout(result.stdout);
        expect(report?.title).toBe(title);
        expect(report?.sections_found).toBe(53);
        expect(report?.files_written).toBe(54);

        const outTree = resolve(outputDir, 'uscode', `title-${String(title).padStart(2, '0')}`);
        const written = readdirSync(outTree).sort();
        expect(written).toContain('_title.md');
        expect(written.filter((name) => /^section-.*\.md$/u.test(name))).toHaveLength(53);
        expect(written).toContain('section-1.md');
        expect(written.some((name) => /§|Title-|Chapter-|—|\.\.md/u.test(name))).toBe(false);
      }
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  }, 180000);

  it('returns non-zero and writes no files on invalid title input', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'us-code-tools-it-fail-'));

    const distEntry = resolve(process.cwd(), 'dist', 'index.js');
    const result = spawnSync(process.execPath, [distEntry, 'transform', '--title', '99', '--output', outputDir], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 60_000,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('1 through 54');

    expect(readdirSync(outputDir).length).toBe(0);
    rmSync(outputDir, { recursive: true, force: true });
  });

  it('keeps the integer-only title contract for appendix identifiers like 5a', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'us-code-tools-it-appendix-'));

    const distEntry = resolve(process.cwd(), 'dist', 'index.js');
    const result = spawnSync(process.execPath, [distEntry, 'transform', '--title', '5a', '--output', outputDir], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 60_000,
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/1 through 54|integer|number/i);
    expect(readdirSync(outputDir).length).toBe(0);
    rmSync(outputDir, { recursive: true, force: true });
  });

  beforeAll(() => {
    // Keep test fixtures immutable so tests are deterministic and network-free by default.
  });
});

function seedSelectedVintageOlrcCache(repoRoot: string, fixtureZip: string, vintage: string, title: number): string {
  const titleDir = resolve(repoRoot, 'data', 'cache', 'olrc', 'vintages', vintage, `title-${String(title).padStart(2, '0')}`);
  mkdirSync(titleDir, { recursive: true });

  const zipName = `xml_usc${String(title).padStart(2, '0')}@${vintage}.zip`;
  const zipPath = resolve(titleDir, zipName);
  copyFileSync(fixtureZip, zipPath);

  writeManifest(repoRoot, vintage, {
    [String(title)]: {
      title,
      vintage,
      status: 'downloaded',
      zip_path: `data/cache/olrc/vintages/${vintage}/title-${String(title).padStart(2, '0')}/${zipName}`,
      extraction_path: `data/cache/olrc/vintages/${vintage}/title-${String(title).padStart(2, '0')}/extracted`,
      byte_count: readFileSync(fixtureZip).byteLength,
      fetched_at: '2026-03-28T22:31:00.000Z',
      extracted_xml_artifacts: [],
    },
  });

  return zipPath;
}

function seedSelectedVintageOlrcCacheMatrix(repoRoot: string, vintage: string, fixtureZipByTitle: Map<number, string>) {
  const titles: Record<string, unknown> = {};

  for (let title = 1; title <= 54; title += 1) {
    const titleKey = String(title);
    const paddedTitle = String(title).padStart(2, '0');

    if (title === 53) {
      titles[titleKey] = {
        title,
        vintage,
        status: 'reserved_empty',
        skipped_at: '2026-03-28T22:31:00.000Z',
        source_url: `https://uscode.house.gov/download/releasepoints/us/pl/${vintage.replace('-', '/')}/xml_usc${paddedTitle}@${vintage}.zip`,
        classification_reason: 'no_xml_entries',
      };
      continue;
    }

    const fixtureZip = fixtureZipByTitle.get(title);
    if (!fixtureZip) {
      throw new Error(`Missing fixture zip for title ${title}`);
    }

    const titleDir = resolve(repoRoot, 'data', 'cache', 'olrc', 'vintages', vintage, `title-${paddedTitle}`);
    mkdirSync(titleDir, { recursive: true });

    const zipName = `xml_usc${paddedTitle}@${vintage}.zip`;
    const zipPath = resolve(titleDir, zipName);
    copyFileSync(fixtureZip, zipPath);

    titles[titleKey] = {
      title,
      vintage,
      status: 'downloaded',
      zip_path: `data/cache/olrc/vintages/${vintage}/title-${paddedTitle}/${zipName}`,
      extraction_path: `data/cache/olrc/vintages/${vintage}/title-${paddedTitle}/extracted`,
      byte_count: readFileSync(fixtureZip).byteLength,
      fetched_at: '2026-03-28T22:31:00.000Z',
      extracted_xml_artifacts: [],
    };
  }

  writeManifest(repoRoot, vintage, titles);
}

function writeManifest(repoRoot: string, vintage: string, titles: Record<string, unknown>) {
  writeFileSync(
    resolve(repoRoot, 'data', 'manifest.json'),
    JSON.stringify(
      {
        version: 1,
        updated_at: '2026-03-28T22:31:00.000Z',
        sources: {
          olrc: {
            selected_vintage: vintage,
            last_success_at: '2026-03-28T22:31:00.000Z',
            last_failure: null,
            titles,
          },
          congress: {
            last_success_at: null,
            last_failure: null,
            bulk_scope: null,
            member_snapshot: {
              snapshot_id: null,
              status: 'missing',
              snapshot_completed_at: null,
              cache_ttl_ms: null,
              member_page_count: 0,
              member_detail_count: 0,
              failed_member_details: [],
              artifacts: [],
            },
            congress_runs: {},
            bulk_history_checkpoint: null,
          },
          govinfo: {
            last_success_at: null,
            last_failure: null,
            query_scopes: {},
            checkpoints: {},
          },
          voteview: {
            last_success_at: null,
            last_failure: null,
            files: {},
            indexes: [],
          },
          legislators: {
            last_success_at: null,
            last_failure: null,
            files: {},
            cross_reference: {
              status: 'skipped_missing_congress_cache',
              based_on_snapshot_id: null,
              crosswalk_artifact_id: null,
              matched_bioguide_ids: 0,
              unmatched_legislator_bioguide_ids: 0,
              unmatched_congress_bioguide_ids: 0,
              updated_at: null,
            },
          },
        },
        runs: [],
      },
      null,
      2,
    ),
  );
}

function parseReportFromStdout(stdout: string): any {
  try {
    const lines = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const payload = lines.reverse().find((line) => line.startsWith('{') && line.endsWith('}'));
    return payload ? JSON.parse(payload) : null;
  } catch {
    return null;
  }
}

function parseFrontmatter(markdown: string) {
  return matter(markdown);
}
