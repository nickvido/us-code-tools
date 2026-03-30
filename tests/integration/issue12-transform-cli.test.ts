import { beforeAll, describe, expect, it } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';

function readFixture(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), 'tests', 'fixtures', 'xml', relativePath), 'utf8');
}

function buildFixtureZip(outputDir: string, title: number, relativePath: string): string {
  const paddedTitle = String(title).padStart(2, '0');
  const fixtureDir = resolve(outputDir, `title-${paddedTitle}-xml`);
  const zipPath = resolve(outputDir, `title-${paddedTitle}.zip`);
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(resolve(fixtureDir, `usc${paddedTitle}.xml`), readFixture(relativePath));
  execSync(`cd ${JSON.stringify(fixtureDir)} && zip -qr ${JSON.stringify(zipPath)} .`, {
    cwd: outputDir,
    shell: '/bin/bash',
  });
  return zipPath;
}

function seedSelectedVintageOlrcCache(repoRoot: string, fixtureZip: string, vintage: string, title: number) {
  const paddedTitle = String(title).padStart(2, '0');
  const titleDir = resolve(repoRoot, 'data', 'cache', 'olrc', 'vintages', vintage, `title-${paddedTitle}`);
  mkdirSync(titleDir, { recursive: true });

  const zipName = `xml_usc${paddedTitle}@${vintage}.zip`;
  execSync(`cp ${JSON.stringify(fixtureZip)} ${JSON.stringify(resolve(titleDir, zipName))}`);

  writeFileSync(
    resolve(repoRoot, 'data', 'manifest.json'),
    JSON.stringify(
      {
        version: 1,
        updated_at: '2026-03-29T01:45:00.000Z',
        sources: {
          olrc: {
            selected_vintage: vintage,
            last_success_at: '2026-03-29T01:45:00.000Z',
            last_failure: null,
            titles: {
              [String(title)]: {
                title,
                vintage,
                status: 'downloaded',
                zip_path: `data/cache/olrc/vintages/${vintage}/title-${paddedTitle}/${zipName}`,
                extraction_path: `data/cache/olrc/vintages/${vintage}/title-${paddedTitle}/extracted`,
                byte_count: readFileSync(fixtureZip).byteLength,
                fetched_at: '2026-03-29T01:45:00.000Z',
                extracted_xml_artifacts: [],
              },
            },
          },
          congress: { last_success_at: null, last_failure: null, bulk_scope: null, member_snapshot: { snapshot_id: null, status: 'missing', snapshot_completed_at: null, cache_ttl_ms: null, member_page_count: 0, member_detail_count: 0, failed_member_details: [], artifacts: [] }, congress_runs: {}, bulk_history_checkpoint: null },
          govinfo: { last_success_at: null, last_failure: null, query_scopes: {}, checkpoints: {} },
          voteview: { last_success_at: null, last_failure: null, files: {}, indexes: [] },
          legislators: { last_success_at: null, last_failure: null, files: {}, cross_reference: { status: 'skipped_missing_congress_cache', based_on_snapshot_id: null, crosswalk_artifact_id: null, matched_bioguide_ids: 0, unmatched_legislator_bioguide_ids: 0, unmatched_congress_bioguide_ids: 0, updated_at: null } },
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
    const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
    const payload = [...lines].reverse().find((line) => line.startsWith('{') && line.endsWith('}'));
    return payload ? JSON.parse(payload) : null;
  } catch {
    return null;
  }
}

describe('issue #12 CLI transform QA', () => {
  beforeAll(() => {
    execSync('npm run build', { cwd: process.cwd(), stdio: 'ignore' });
  });

  it('transforms real nested fixtures for titles 5, 10, and 26 with section counts that match the XML source', () => {
    const vintage = '119-73';
    const cases = [
      { title: 5, relativePath: 'title-05/05-part-chapter-sections.xml', expectedSections: 2 },
      { title: 10, relativePath: 'title-10/10-subtitle-part-chapter-sections.xml', expectedSections: 2 },
      { title: 26, relativePath: 'title-26/26-deep-hierarchy-sections.xml', expectedSections: 2 },
    ];

    for (const testCase of cases) {
      const sandboxRoot = mkdtempSync(join(tmpdir(), `us-code-tools-issue12-${testCase.title}-`));
      try {
        const fixtureZip = buildFixtureZip(sandboxRoot, testCase.title, testCase.relativePath);
        seedSelectedVintageOlrcCache(sandboxRoot, fixtureZip, vintage, testCase.title);

        const distEntry = resolve(process.cwd(), 'dist', 'index.js');
        const result = spawnSync(process.execPath, [distEntry, 'transform', '--title', String(testCase.title), '--output', './out'], {
          cwd: sandboxRoot,
          encoding: 'utf8',
          timeout: 60_000,
          env: process.env,
        });

        expect(result.status).toBe(0);
        const report = parseReportFromStdout(result.stdout);
        expect(String(report?.title)).toBe(String(testCase.title));
        expect(report?.sections_found).toBe(testCase.expectedSections);
        expect(report?.files_written).toBe(testCase.expectedSections + 1);

        const uscodeDir = resolve(sandboxRoot, 'out', 'uscode');
        const [titleDir] = readdirSync(uscodeDir).filter((entry) => entry.startsWith(`title-${String(testCase.title).padStart(2, '0')}`));
        const outTree = resolve(uscodeDir, titleDir);
        const sectionFiles = readdirSync(outTree).filter((entry) => entry.startsWith('section-')).sort();
        expect(sectionFiles).toHaveLength(testCase.expectedSections);
      } finally {
        rmSync(sandboxRoot, { recursive: true, force: true });
      }
    }
  });

  it('renders slash-separated USC refs as relative markdown links in written section output', () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-issue12-ref-links-'));

    try {
      const fixtureZip = buildFixtureZip(sandboxRoot, 10, 'title-10/10-subtitle-part-chapter-sections.xml');
      seedSelectedVintageOlrcCache(sandboxRoot, fixtureZip, '119-73', 10);

      const distEntry = resolve(process.cwd(), 'dist', 'index.js');
      const result = spawnSync(process.execPath, [distEntry, 'transform', '--title', '10', '--output', './out'], {
        cwd: sandboxRoot,
        encoding: 'utf8',
        timeout: 60_000,
        env: process.env,
      });

      expect(result.status).toBe(0);

      const outTree = resolve(sandboxRoot, 'out', 'uscode', 'title-10-armed-forces');
      const sectionMarkdown = readFileSync(join(outTree, 'section-00101.md'), 'utf8');
      const parsedSection = matter(sectionMarkdown);

      expect(parsedSection.data).toMatchObject({
        title: 10,
        section: '101',
        subtitle: 'A',
        part: 'I',
        chapter: '1',
        source_credit: expect.any(String),
      });
      expect(parsedSection.content).toContain('## Statutory Notes');
      expect(parsedSection.content).toContain('[section 125(d) of this title](../title-10-armed-forces/section-00125d.md)');
      expect(parsedSection.content).not.toContain('section 125(d) of this title](/us/usc/t10/s125/d)');
      expect(parsedSection.content).not.toContain('[section 125(d) of this title]()');
      expect(parsedSection.content).not.toContain('#ref=');
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('writes zero-padded filenames and a canonically sorted _title.md for mixed-width section identifiers', () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-issue12-ordering-'));
    const fixtureXml = `<?xml version="1.0" encoding="UTF-8"?>
<uscDoc xmlns="http://xml.house.gov/schemas/uslm/1.0" schemaLocation="http://xml.house.gov/schemas/uslm/1.0 USLM-1.0.15.xsd">
  <meta>
    <docNumber>1</docNumber>
    <docTitle>Ordering Fixture</docTitle>
  </meta>
  <main>
    <title identifier="/us/usc/t1">
      <num value="1">Title 1—</num>
      <heading>Ordering Fixture</heading>
      <chapter identifier="/us/usc/t1/ch1">
        <num value="1">Chapter 1—</num>
        <heading>Canonical Sorting</heading>
        <section identifier="/us/usc/t1/s114"><num value="114">§ 114.</num><heading>Section 114</heading><content><p>114.</p></content><sourceCredit>(source 114)</sourceCredit></section>
        <section identifier="/us/usc/t1/s106b"><num value="106b">§ 106b.</num><heading>Section 106b</heading><content><p>106b.</p></content><sourceCredit>(source 106b)</sourceCredit></section>
        <section identifier="/us/usc/t1/s2"><num value="2">§ 2.</num><heading>Section 2</heading><content><p>2.</p></content><sourceCredit>(source 2)</sourceCredit></section>
        <section identifier="/us/usc/t1/s106a"><num value="106a">§ 106a.</num><heading>Section 106a</heading><content><p>106a.</p></content><sourceCredit>(source 106a)</sourceCredit></section>
        <section identifier="/us/usc/t1/s10"><num value="10">§ 10.</num><heading>Section 10</heading><content><p>10.</p></content><sourceCredit>(source 10)</sourceCredit></section>
        <section identifier="/us/usc/t1/s1"><num value="1">§ 1.</num><heading>Section 1</heading><content><p>1.</p></content><sourceCredit>(source 1)</sourceCredit></section>
      </chapter>
    </title>
  </main>
</uscDoc>`;

    try {
      const paddedTitle = '01';
      const fixtureDir = resolve(sandboxRoot, `title-${paddedTitle}-xml`);
      mkdirSync(fixtureDir, { recursive: true });
      writeFileSync(resolve(fixtureDir, 'usc01.xml'), fixtureXml);
      const fixtureZip = resolve(sandboxRoot, `title-${paddedTitle}.zip`);
      execSync(`cd ${JSON.stringify(fixtureDir)} && zip -qr ${JSON.stringify(fixtureZip)} .`, { cwd: sandboxRoot, shell: '/bin/bash' });
      seedSelectedVintageOlrcCache(sandboxRoot, fixtureZip, '119-73', 1);

      const distEntry = resolve(process.cwd(), 'dist', 'index.js');
      const result = spawnSync(process.execPath, [distEntry, 'transform', '--title', '1', '--output', './out'], {
        cwd: sandboxRoot,
        encoding: 'utf8',
        timeout: 60_000,
        env: process.env,
      });

      expect(result.status).toBe(0);
      const outTree = resolve(sandboxRoot, 'out', 'uscode', 'title-01-ordering-fixture');
      const written = readdirSync(outTree).filter((entry) => entry.startsWith('section-')).sort();
      expect(written).toEqual([
        'section-00001.md',
        'section-00002.md',
        'section-00010.md',
        'section-00106a.md',
        'section-00106b.md',
        'section-00114.md',
      ]);
      expect(written).not.toContain('section-1.md');
      expect(written).not.toContain('section-10.md');
      expect(written).not.toContain('section-106a.md');

      const titleMarkdown = readFileSync(join(outTree, '_title.md'), 'utf8');
      const parsedTitle = matter(titleMarkdown);
      expect(parsedTitle.data.sections).toBe(6);
      expect(titleMarkdown).not.toContain('## Sections');
      expect(titleMarkdown).not.toContain('§ 1');
      expect(titleMarkdown).not.toContain('§ 2');
      expect(titleMarkdown).not.toContain('§ 10');
      expect(titleMarkdown).not.toContain('§ 106a');
      expect(titleMarkdown).not.toContain('§ 106b');
      expect(titleMarkdown).not.toContain('§ 114');
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });
});
