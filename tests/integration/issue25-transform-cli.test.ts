import { beforeAll, describe, expect, it } from 'vitest';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import matter from 'gray-matter';

const VINTAGE = '119-73';
const SUPPORTED_APPENDIXES = ['5A', '11A', '18A', '28A', '50A'] as const;

function buildCurrentFormatFixtureZip(outputDir: string, titleSelector: string): string {
  const normalizedSelector = titleSelector.toUpperCase();
  const paddedNumeric = normalizedSelector.endsWith('A')
    ? `${normalizedSelector.slice(0, -1).padStart(2, '0')}A`
    : normalizedSelector.padStart(2, '0');
  const titleForIdentifiers = normalizedSelector.endsWith('A') ? normalizedSelector.toLowerCase() : normalizedSelector;
  const fixtureDir = resolve(outputDir, `title-${paddedNumeric}-xml`);
  const zipPath = resolve(outputDir, `title-${paddedNumeric}.zip`);
  mkdirSync(fixtureDir, { recursive: true });

  const xml = readFileSync(resolve(process.cwd(), 'tests/fixtures/xml/title-01/04-current-uscdoc.xml'), 'utf8')
    .replace(/<docNumber>1<\/docNumber>/g, `<docNumber>${normalizedSelector}</docNumber>`)
    .replace(/identifier="\/us\/usc\/t1"/g, `identifier="/us/usc/t${titleForIdentifiers}"`)
    .replace(/identifier="\/us\/usc\/t1\/ch1"/g, `identifier="/us/usc/t${titleForIdentifiers}/ch1"`)
    .replace(/identifier="\/us\/usc\/t1\/s(\d+)"/g, `identifier="/us/usc/t${titleForIdentifiers}/s$1"`)
    .replace(/<num value="1">Title 1—<\/num>/g, `<num value="${normalizedSelector}">Title ${normalizedSelector}—</num>`)
    .replace(/<heading>CHAPTER 1—GENERAL PROVISIONS<\/heading>/g, '<heading>Fraud and False Statements</heading>');

  writeFileSync(resolve(fixtureDir, `usc${paddedNumeric}.xml`), xml);
  execSync(`cd ${JSON.stringify(fixtureDir)} && zip -qr ${JSON.stringify(zipPath)} .`, {
    cwd: outputDir,
    shell: '/bin/bash',
  });
  return zipPath;
}

function writeManifest(repoRoot: string, titles: Record<string, unknown>) {
  writeFileSync(
    resolve(repoRoot, 'data', 'manifest.json'),
    JSON.stringify(
      {
        version: 1,
        updated_at: '2026-03-29T22:10:00.000Z',
        sources: {
          olrc: {
            selected_vintage: VINTAGE,
            last_success_at: '2026-03-29T22:10:00.000Z',
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
          govinfo: { last_success_at: null, last_failure: null, query_scopes: {}, checkpoints: {} },
          voteview: { last_success_at: null, last_failure: null, files: {}, indexes: [] },
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

function seedSelectedVintageOlrcCache(repoRoot: string, titleSelector: string, fixtureZip: string) {
  const normalizedSelector = titleSelector.toUpperCase();
  const paddedNumeric = normalizedSelector.endsWith('A')
    ? `${normalizedSelector.slice(0, -1).padStart(2, '0')}A`
    : normalizedSelector.padStart(2, '0');
  const manifestKey = normalizedSelector;
  const titleDir = resolve(repoRoot, 'data', 'cache', 'olrc', 'vintages', VINTAGE, `title-${paddedNumeric}`);
  mkdirSync(titleDir, { recursive: true });

  const zipName = `xml_usc${paddedNumeric}@${VINTAGE}.zip`;
  copyFileSync(fixtureZip, resolve(titleDir, zipName));

  const titleNumber = Number.parseInt(normalizedSelector, 10);
  writeManifest(repoRoot, {
    [manifestKey]: {
      title: Number.isNaN(titleNumber) ? normalizedSelector : titleNumber,
      vintage: VINTAGE,
      status: 'downloaded',
      zip_path: `data/cache/olrc/vintages/${VINTAGE}/title-${paddedNumeric}/${zipName}`,
      extraction_path: `data/cache/olrc/vintages/${VINTAGE}/title-${paddedNumeric}/extracted`,
      byte_count: statSync(fixtureZip).size,
      fetched_at: '2026-03-29T22:10:00.000Z',
      extracted_xml_artifacts: [],
    },
  });
}

function seedSelectedVintageOlrcCacheMatrix(repoRoot: string, fixtureZipBySelector: Map<string, string>) {
  const titles: Record<string, unknown> = {};

  for (let title = 1; title <= 54; title += 1) {
    const key = String(title);
    const padded = String(title).padStart(2, '0');

    if (title === 53) {
      titles[key] = {
        title,
        vintage: VINTAGE,
        status: 'reserved_empty',
        skipped_at: '2026-03-29T22:10:00.000Z',
        source_url: `https://uscode.house.gov/download/releasepoints/us/pl/${VINTAGE.replace('-', '/')}/xml_usc${padded}@${VINTAGE}.zip`,
        classification_reason: 'no_xml_entries',
      };
      continue;
    }

    const fixtureZip = fixtureZipBySelector.get(key);
    if (!fixtureZip) {
      throw new Error(`Missing fixture zip for selector ${key}`);
    }

    const titleDir = resolve(repoRoot, 'data', 'cache', 'olrc', 'vintages', VINTAGE, `title-${padded}`);
    mkdirSync(titleDir, { recursive: true });
    const zipName = `xml_usc${padded}@${VINTAGE}.zip`;
    copyFileSync(fixtureZip, resolve(titleDir, zipName));

    titles[key] = {
      title,
      vintage: VINTAGE,
      status: 'downloaded',
      zip_path: `data/cache/olrc/vintages/${VINTAGE}/title-${padded}/${zipName}`,
      extraction_path: `data/cache/olrc/vintages/${VINTAGE}/title-${padded}/extracted`,
      byte_count: statSync(fixtureZip).size,
      fetched_at: '2026-03-29T22:10:00.000Z',
      extracted_xml_artifacts: [],
    };
  }

  for (const selector of SUPPORTED_APPENDIXES) {
    const padded = `${selector.slice(0, -1).padStart(2, '0')}A`;
    const fixtureZip = fixtureZipBySelector.get(selector);
    if (!fixtureZip) {
      throw new Error(`Missing fixture zip for selector ${selector}`);
    }

    const titleDir = resolve(repoRoot, 'data', 'cache', 'olrc', 'vintages', VINTAGE, `title-${padded}`);
    mkdirSync(titleDir, { recursive: true });
    const zipName = `xml_usc${padded}@${VINTAGE}.zip`;
    copyFileSync(fixtureZip, resolve(titleDir, zipName));

    titles[selector] = {
      title: selector,
      vintage: VINTAGE,
      status: 'downloaded',
      zip_path: `data/cache/olrc/vintages/${VINTAGE}/title-${padded}/${zipName}`,
      extraction_path: `data/cache/olrc/vintages/${VINTAGE}/title-${padded}/extracted`,
      byte_count: statSync(fixtureZip).size,
      fetched_at: '2026-03-29T22:10:00.000Z',
      extracted_xml_artifacts: [],
    };
  }

  writeManifest(repoRoot, titles);
}

function parseReportFromStdout(stdout: string): any {
  try {
    const payload = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .reverse()
      .find((line) => line.startsWith('{') && line.endsWith('}'));

    return payload ? JSON.parse(payload) : null;
  } catch {
    return null;
  }
}

describe('issue #25 integration — appendix selectors, chapter filenames, and --all', () => {
  beforeAll(() => {
    execSync('npm run build', { cwd: process.cwd(), stdio: 'ignore' });
  });

  it('accepts case-insensitive appendix selectors and writes chapter-grouped appendix output under title-05a-appendix', () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-issue25-appendix-'));
    const fixtureZip = buildCurrentFormatFixtureZip(sandboxRoot, '5A');
    seedSelectedVintageOlrcCache(sandboxRoot, '5A', fixtureZip);
    const distEntry = resolve(process.cwd(), 'dist', 'index.js');

    const upper = spawnSync(
      process.execPath,
      [distEntry, 'transform', '--title', '5A', '--output', './out-upper', '--group-by', 'chapter'],
      { cwd: sandboxRoot, encoding: 'utf8', timeout: 60_000, env: process.env },
    );
    const lower = spawnSync(
      process.execPath,
      [distEntry, 'transform', '--title', '5a', '--output', './out-lower', '--group-by', 'chapter'],
      { cwd: sandboxRoot, encoding: 'utf8', timeout: 60_000, env: process.env },
    );

    try {
      expect(upper.status).toBe(0);
      expect(lower.status).toBe(0);

      const upperTree = resolve(sandboxRoot, 'out-upper', 'uscode', 'title-05a-appendix');
      const lowerTree = resolve(sandboxRoot, 'out-lower', 'uscode', 'title-05a-appendix');
      const upperFiles = readdirSync(upperTree).sort();
      const lowerFiles = readdirSync(lowerTree).sort();
      const upperReport = parseReportFromStdout(upper.stdout);
      const lowerReport = parseReportFromStdout(lower.stdout);

      expect(upperFiles).toContain('_title.md');
      expect(upperFiles).toContain('chapter-001-rules-of-construction.md');
      expect(upperFiles.some((name) => name === '_uncategorized.md')).toBe(false);
      expect(upperFiles.some((name) => /^section-.*\.md$/u.test(name))).toBe(false);
      expect(upperFiles).toEqual(lowerFiles);

      expect(upperReport?.title).toBe('5A');
      expect(lowerReport?.title).toBe('5A');
      expect(upperReport?.parse_errors).toEqual([]);
      expect(lowerReport?.parse_errors).toEqual([]);
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('rejects invalid appendix-like selectors and duplicate --title/--all flags before writing output', () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-issue25-cli-'));
    const distEntry = resolve(process.cwd(), 'dist', 'index.js');

    const invalidCases = [
      ['--title', '6A', '--output', './out-6a'],
      ['--title', '5AA', '--output', './out-5aa'],
      ['--title', 'appendix', '--output', './out-appendix'],
      ['--title', '5A', '--title', '11A', '--output', './out-duplicate-title'],
      ['--all', '--all', '--output', './out-duplicate-all'],
      ['--all', '--title', '5A', '--output', './out-mixed'],
    ];

    try {
      for (const args of invalidCases) {
        const result = spawnSync(process.execPath, [distEntry, 'transform', ...args], {
          cwd: sandboxRoot,
          encoding: 'utf8',
          timeout: 60_000,
          env: process.env,
        });

        expect(result.status).not.toBe(0);
        expect(`${result.stdout}\n${result.stderr}`).toMatch(/5A|11A|18A|28A|50A|duplicate|--all|--title/i);
        const outputArgIndex = args.indexOf('--output');
        const outputDir = outputArgIndex >= 0 ? resolve(sandboxRoot, args[outputArgIndex + 1]) : null;
        expect(outputDir && existsSync(outputDir) ? readdirSync(outputDir).length : 0).toBe(0);
      }
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('runs transform --all --group-by chapter across numeric and appendix fixtures, preserves title 53 diagnostics, and emits descriptive chapter filenames', () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-issue25-all-'));
    const fixtureZipBySelector = new Map<string, string>();

    for (let title = 1; title <= 54; title += 1) {
      if (title === 53) continue;
      fixtureZipBySelector.set(String(title), buildCurrentFormatFixtureZip(sandboxRoot, String(title)));
    }

    for (const appendix of SUPPORTED_APPENDIXES) {
      fixtureZipBySelector.set(appendix, buildCurrentFormatFixtureZip(sandboxRoot, appendix));
    }

    seedSelectedVintageOlrcCacheMatrix(sandboxRoot, fixtureZipBySelector);
    const distEntry = resolve(process.cwd(), 'dist', 'index.js');

    const result = spawnSync(
      process.execPath,
      [distEntry, 'transform', '--all', '--output', './out', '--group-by', 'chapter'],
      { cwd: sandboxRoot, encoding: 'utf8', timeout: 180_000, env: process.env },
    );

    try {
      expect(result.status).toBe(0);
      const report = parseReportFromStdout(result.stdout);
      expect(report?.requested_scope).toBe('all');
      expect(Array.isArray(report?.targets)).toBe(true);
      expect(report.targets).toHaveLength(59);

      const reportIds = report.targets.map((target: any) => String(target.title));
      expect(reportIds).toEqual(expect.arrayContaining(['1', '52', '53', '54', ...SUPPORTED_APPENDIXES]));

      const title53 = report.targets.find((target: any) => String(target.title) === '53');
      expect(title53?.files_written).toBe(0);
      expect(JSON.stringify(title53?.parse_errors ?? [])).toMatch(/reserved|empty|no writable sections|no xml entries|invalid_xml/i);

      const uscodeDir = resolve(sandboxRoot, 'out', 'uscode');
      const titleDirs = readdirSync(uscodeDir).filter((name) => name.startsWith('title-')).sort();
      expect(titleDirs).toEqual(
        expect.arrayContaining([
          'title-01-general-provisions',
          'title-54-general-provisions',
          'title-05a-appendix',
          'title-11a-appendix',
          'title-18a-appendix',
          'title-28a-appendix',
          'title-50a-appendix',
        ]),
      );
      expect(titleDirs).not.toContain('title-53');

      const appendixTree = resolve(uscodeDir, 'title-05a-appendix');
      const appendixFiles = readdirSync(appendixTree).sort();
      expect(appendixFiles).toContain('_title.md');
      expect(appendixFiles).toContain('chapter-001-rules-of-construction.md');
      expect(appendixFiles.every((name) => !/[\s'"—A-Z]/u.test(name))).toBe(true);
      expect(appendixFiles.filter((name) => name.startsWith('chapter-'))).not.toHaveLength(0);

      const numericTree = resolve(uscodeDir, 'title-01-general-provisions');
      const numericFiles = readdirSync(numericTree).sort();
      expect(numericFiles).toContain('_title.md');
      expect(numericFiles).toContain('chapter-001-rules-of-construction.md');
      expect(numericFiles.some((name) => name === 'chapter-001.md')).toBe(false);
      expect(numericFiles.every((name) => name === '_title.md' || name === '_uncategorized.md' || /^chapter-[a-z0-9-]+\.md$/u.test(name))).toBe(true);

      const chapterMarkdown = readFileSync(resolve(numericTree, 'chapter-001-rules-of-construction.md'), 'utf8');
      const parsed = matter(chapterMarkdown);
      expect(parsed.data.heading).toBe('Rules of Construction');
      expect(parsed.content).not.toContain('](./section-');
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  }, 240_000);
});
