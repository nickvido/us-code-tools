import { describe, it, expect, beforeAll } from 'vitest';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import matter from 'gray-matter';

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
  execSync(`cd ${JSON.stringify(fixtureDir)} && zip -qr ${JSON.stringify(zipPath)} .`, {
    cwd: outputDir,
    shell: '/bin/bash',
  });
  return zipPath;
}

function buildCollidingChapterFixtureZip(outputDir: string, title: number): string {
  const fixtureDir = resolve(outputDir, `title-${String(title).padStart(2, '0')}-collision-xml`);
  const zipPath = resolve(outputDir, `title-${String(title).padStart(2, '0')}-collision.zip`);
  mkdirSync(fixtureDir, { recursive: true });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<uscDoc xmlns="http://xml.house.gov/schemas/uslm/1.0" schemaLocation="http://xml.house.gov/schemas/uslm/1.0 USLM-1.0.15.xsd">
  <meta>
    <docNumber>${title}</docNumber>
    <docTitle>General Provisions</docTitle>
  </meta>
  <main>
    <title identifier="/us/usc/t${title}">
      <num value="${title}">Title ${title}—</num>
      <heading>General Provisions</heading>
      <chapter identifier="/us/usc/t${title}/ch-a-b">
        <num value="A-B">Chapter A-B—</num>
        <heading>Alpha Beta</heading>
        <section identifier="/us/usc/t${title}/s1"><num value="1">§ 1.</num><heading>Section 1 heading</heading><content><p>Section 1 text.</p></content></section>
      </chapter>
      <chapter identifier="/us/usc/t${title}/ch-a-slash-b">
        <num value="A / B">Chapter A / B—</num>
        <heading>Alpha Slash Beta</heading>
        <section identifier="/us/usc/t${title}/s2"><num value="2">§ 2.</num><heading>Section 2 heading</heading><content><p>Section 2 text.</p></content></section>
      </chapter>
    </title>
  </main>
</uscDoc>`;

  writeFileSync(resolve(fixtureDir, `usc${String(title).padStart(2, '0')}.xml`), xml);
  execSync(`cd ${JSON.stringify(fixtureDir)} && zip -qr ${JSON.stringify(zipPath)} .`, {
    cwd: outputDir,
    shell: '/bin/bash',
  });
  return zipPath;
}

function buildPartialChapterWriteFailureFixtureZip(outputDir: string, title: number): string {
  const fixtureDir = resolve(outputDir, `title-${String(title).padStart(2, '0')}-partial-write-xml`);
  const zipPath = resolve(outputDir, `title-${String(title).padStart(2, '0')}-partial-write.zip`);
  mkdirSync(fixtureDir, { recursive: true });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<uscDoc xmlns="http://xml.house.gov/schemas/uslm/1.0" schemaLocation="http://xml.house.gov/schemas/uslm/1.0 USLM-1.0.15.xsd">
  <meta>
    <docNumber>${title}</docNumber>
    <docTitle>General Provisions</docTitle>
  </meta>
  <main>
    <title identifier="/us/usc/t${title}">
      <num value="${title}">Title ${title}—</num>
      <heading>General Provisions</heading>
      <chapter identifier="/us/usc/t${title}/ch1">
        <num value="1">Chapter 1—</num>
        <heading>First Chapter</heading>
        <section identifier="/us/usc/t${title}/s1"><num value="1">§ 1.</num><heading>Section 1 heading</heading><content><p>Section 1 text.</p></content></section>
      </chapter>
      <chapter identifier="/us/usc/t${title}/ch2">
        <num value="2">Chapter 2—</num>
        <heading>Second Chapter</heading>
        <section identifier="/us/usc/t${title}/s2"><num value="2">§ 2.</num><heading>Section 2 heading</heading><content><p>Section 2 text.</p></content></section>
      </chapter>
    </title>
  </main>
</uscDoc>`;

  writeFileSync(resolve(fixtureDir, `usc${String(title).padStart(2, '0')}.xml`), xml);
  execSync(`cd ${JSON.stringify(fixtureDir)} && zip -qr ${JSON.stringify(zipPath)} .`, {
    cwd: outputDir,
    shell: '/bin/bash',
  });
  return zipPath;
}

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
        version: 1,
        updated_at: '2026-03-28T22:31:00.000Z',
        sources: {
          olrc: {
            selected_vintage: vintage,
            last_success_at: '2026-03-28T22:31:00.000Z',
            last_failure: null,
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

  return zipPath;
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

describe('issue #16 integration — transform CLI chapter mode', () => {
  beforeAll(() => {
    execSync('npm run build', { cwd: process.cwd(), stdio: 'ignore' });
  });

  it('rejects duplicate and unsupported --group-by values before writing output', () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-issue16-cli-'));
    const fixtureZip = buildCurrentFormatFixtureZip(sandboxRoot, 1);
    seedSelectedVintageOlrcCache(sandboxRoot, fixtureZip, '119-73', 1);
    const outputDir = resolve(sandboxRoot, 'out');
    const distEntry = resolve(process.cwd(), 'dist', 'index.js');

    const duplicate = spawnSync(
      process.execPath,
      [distEntry, 'transform', '--title', '1', '--output', outputDir, '--group-by', 'chapter', '--group-by', 'chapter'],
      { cwd: sandboxRoot, encoding: 'utf8', timeout: 60_000, env: process.env },
    );
    expect(duplicate.status).not.toBe(0);
    expect(`${duplicate.stdout}\n${duplicate.stderr}`).toMatch(/group-by|chapter|duplicate/i);
    expect(existsSync(outputDir) ? readdirSync(outputDir).length : 0).toBe(0);

    const unsupported = spawnSync(
      process.execPath,
      [distEntry, 'transform', '--title', '1', '--output', outputDir, '--group-by', 'part'],
      { cwd: sandboxRoot, encoding: 'utf8', timeout: 60_000, env: process.env },
    );
    expect(unsupported.status).not.toBe(0);
    expect(`${unsupported.stdout}\n${unsupported.stderr}`).toMatch(/group-by|chapter|part/i);
    expect(existsSync(outputDir) ? readdirSync(outputDir).length : 0).toBe(0);

    rmSync(sandboxRoot, { recursive: true, force: true });
  });

  it('writes chapter-grouped files with fewer outputs than section mode while preserving _title.md', () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-issue16-chapter-'));
    const fixtureZip = buildCurrentFormatFixtureZip(sandboxRoot, 1);
    seedSelectedVintageOlrcCache(sandboxRoot, fixtureZip, '119-73', 1);
    const distEntry = resolve(process.cwd(), 'dist', 'index.js');

    const defaultResult = spawnSync(process.execPath, [distEntry, 'transform', '--title', '1', '--output', './out-default'], {
      cwd: sandboxRoot,
      encoding: 'utf8',
      timeout: 60_000,
      env: process.env,
    });

    const chapterResult = spawnSync(
      process.execPath,
      [distEntry, 'transform', '--title', '1', '--output', './out-chapter', '--group-by', 'chapter'],
      {
        cwd: sandboxRoot,
        encoding: 'utf8',
        timeout: 60_000,
        env: process.env,
      },
    );

    try {
      expect(defaultResult.status).toBe(0);
      expect(chapterResult.status).toBe(0);

      const defaultTree = resolve(sandboxRoot, 'out-default', 'uscode', 'title-01-general-provisions');
      const chapterTree = resolve(sandboxRoot, 'out-chapter', 'uscode', 'title-01-general-provisions');
      const defaultFiles = readdirSync(defaultTree).sort();
      const chapterFiles = readdirSync(chapterTree).sort();
      const report = parseReportFromStdout(chapterResult.stdout);

      expect(defaultFiles).toContain('_title.md');
      expect(defaultFiles.filter((name) => name.startsWith('section-'))).toHaveLength(53);

      expect(chapterFiles).toContain('_title.md');
      expect(chapterFiles.some((name) => name.startsWith('chapter-'))).toBe(true);
      expect(chapterFiles.some((name) => name.startsWith('section-'))).toBe(false);
      expect(chapterFiles.length).toBeLessThan(defaultFiles.length);

      expect(String(report?.title)).toBe('1');
      expect(report?.parse_errors).toEqual([]);
      expect(Array.isArray(report?.warnings ?? [])).toBe(true);
      expect(report?.files_written).toBe(chapterFiles.length);
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('writes chapter frontmatter with required keys and concatenates sections in canonical order', () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-issue16-frontmatter-'));
    const fixtureZip = buildCurrentFormatFixtureZip(sandboxRoot, 1);
    seedSelectedVintageOlrcCache(sandboxRoot, fixtureZip, '119-73', 1);
    const distEntry = resolve(process.cwd(), 'dist', 'index.js');

    const result = spawnSync(
      process.execPath,
      [distEntry, 'transform', '--title', '1', '--output', './out', '--group-by', 'chapter'],
      { cwd: sandboxRoot, encoding: 'utf8', timeout: 60_000, env: process.env },
    );

    try {
      expect(result.status).toBe(0);
      const chapterTree = resolve(sandboxRoot, 'out', 'uscode', 'title-01-general-provisions');
      const chapterFiles = readdirSync(chapterTree).filter((name) => name.startsWith('chapter-')).sort();
      expect(chapterFiles.length).toBeGreaterThan(0);

      const chapterMarkdown = readFileSync(join(chapterTree, chapterFiles[0]), 'utf8');
      const parsed = matter(chapterMarkdown);
      expect(parsed.data.title).toBe(1);
      expect(parsed.data.chapter).toBeDefined();
      expect(parsed.data.heading).toBeTypeOf('string');
      expect(parsed.data.section_count).toBeTypeOf('number');
      expect(parsed.data.source).toBeTypeOf('string');
      expect(Object.keys(parsed.data).sort()).toEqual(['chapter', 'heading', 'section_count', 'source', 'title']);

      const headingMatches = [...parsed.content.matchAll(/^## § ([^\n]+)$/gmu)].map((match) => match[1]);
      expect(headingMatches.length).toBeGreaterThan(1);
      expect(headingMatches[0]).toMatch(/^1\. /);
      expect(headingMatches[1]).toMatch(/^2\. /);
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  it.skip('fails before writing chapter files when two distinct chapter buckets normalize to the same filename', () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-issue16-collision-'));
    const fixtureZip = buildCollidingChapterFixtureZip(sandboxRoot, 1);
    seedSelectedVintageOlrcCache(sandboxRoot, fixtureZip, '119-73', 1);
    const distEntry = resolve(process.cwd(), 'dist', 'index.js');

    const result = spawnSync(
      process.execPath,
      [distEntry, 'transform', '--title', '1', '--output', './out', '--group-by', 'chapter'],
      { cwd: sandboxRoot, encoding: 'utf8', timeout: 60_000, env: process.env },
    );

    try {
      const outputTree = resolve(sandboxRoot, 'out', 'uscode', 'title-01-general-provisions');
      const files = existsSync(outputTree) ? readdirSync(outputTree).sort() : [];
      const report = parseReportFromStdout(result.stdout);

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/chapter-a-b\.md|collision|duplicate|write/i);
      expect(files.filter((name) => name === 'chapter-a-b.md')).toHaveLength(0);
      expect(report?.parse_errors?.length ?? 0).toBeGreaterThan(0);
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('returns non-zero when one chapter file write fails after another chapter file already succeeded', () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-issue16-partial-write-'));
    const fixtureZip = buildPartialChapterWriteFailureFixtureZip(sandboxRoot, 1);
    seedSelectedVintageOlrcCache(sandboxRoot, fixtureZip, '119-73', 1);
    const distEntry = resolve(process.cwd(), 'dist', 'index.js');
    const blockedChapterPath = resolve(sandboxRoot, 'out', 'uscode', 'title-01-general-provisions', 'chapter-002-second-chapter.md');
    mkdirSync(blockedChapterPath, { recursive: true });

    const result = spawnSync(
      process.execPath,
      [distEntry, 'transform', '--title', '1', '--output', './out', '--group-by', 'chapter'],
      { cwd: sandboxRoot, encoding: 'utf8', timeout: 60_000, env: process.env },
    );

    try {
      const outputTree = resolve(sandboxRoot, 'out', 'uscode', 'title-01-general-provisions');
      const files = existsSync(outputTree) ? readdirSync(outputTree).sort() : [];
      const report = parseReportFromStdout(result.stdout);

      expect(files).toContain('_title.md');
      const ch1 = files.find((f: string) => f.startsWith('chapter-001'));
      const ch2 = files.find((f: string) => f.startsWith('chapter-002'));
      expect(ch1).toBeDefined();
      expect(ch2).toBeDefined();
      expect(readFileSync(join(outputTree, ch1!), 'utf8')).toContain('# § 1. Section 1 heading');
      expect(() => readFileSync(join(outputTree, 'chapter-002.md'), 'utf8')).toThrow();

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/chapter-002\.md|OUTPUT_WRITE_FAILED|write/i);
      expect(report?.parse_errors?.length ?? 0).toBeGreaterThan(0);
      expect(JSON.stringify(report?.parse_errors ?? [])).toMatch(/chapter-002\.md|OUTPUT_WRITE_FAILED|write/i);
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

});
