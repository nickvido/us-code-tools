import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
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

    const outTree = resolve(outputDir, 'uscode', 'title-99');
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

  writeFileSync(
    resolve(repoRoot, 'data', 'manifest.json'),
    JSON.stringify(
      {
        sources: {
          olrc: {
            selected_vintage: vintage,
            titles: {
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
            },
          },
        },
      },
      null,
      2,
    ),
  );

  return zipPath;
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
