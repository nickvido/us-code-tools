import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import matter from 'gray-matter';
import { XMLParser } from 'fast-xml-parser';
import { ensureModuleLoaded, pickCallable, safeImport } from '../../utils/module-helpers';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: false,
});

function readFixture(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), 'tests', 'fixtures', 'xml', relativePath), 'utf8');
}

function fixtureSectionCount(xml: string): number {
  const document = parser.parse(xml);
  const titleNode = document?.uscDoc?.main?.title ?? document?.uslm?.title;

  function countCodifiedSections(node: unknown, insideNoteScope = false, parentKey: string | null = null): number {
    if (!node || typeof node !== 'object') {
      return 0;
    }

    if (Array.isArray(node)) {
      return node.reduce((total, entry) => total + countCodifiedSections(entry, insideNoteScope, parentKey), 0);
    }

    const record = node as Record<string, unknown>;
    const nextInsideNoteScope = insideNoteScope || parentKey === 'note' || parentKey === 'notes';
    let total = 0;

    const identifier = typeof record['@_identifier'] === 'string'
      ? record['@_identifier']
      : typeof record.identifier === 'string'
        ? record.identifier
        : null;

    if (parentKey === 'section' && !insideNoteScope && typeof identifier === 'string' && identifier.startsWith('/us/usc/')) {
      total += 1;
    }

    for (const [key, value] of Object.entries(record)) {
      if (key === 'identifier' || key.startsWith('@_')) {
        continue;
      }
      total += countCodifiedSections(value, nextInsideNoteScope, key);
    }

    return total;
  }

  return countCodifiedSections(titleNode);
}

function normalizeParseResult(result: unknown): { titleIr?: any; parseErrors?: unknown[] } {
  const anyResult = result as {
    titleIr?: any;
    ir?: any;
    title?: any;
    result?: any;
    parseErrors?: unknown[];
    errors?: unknown[];
  };

  return {
    titleIr: anyResult.titleIr ?? anyResult.ir ?? anyResult.title ?? anyResult.result,
    parseErrors: anyResult.parseErrors ?? anyResult.errors ?? [],
  };
}

async function parseXmlFixture(xml: string) {
  const modulePath = resolve(process.cwd(), 'src', 'transforms', 'uslm-to-ir.ts');
  const parseModule = await safeImport(modulePath);
  ensureModuleLoaded(modulePath, parseModule);
  const parseXml = pickCallable(parseModule, [
    'parseUslmToIr',
    'parseUslmToIR',
    'parseUslmXml',
    'parseUslmXmlToIr',
    'parseXmlToIr',
    'parseTitleXml',
    'parseTitleXmlToIr',
    'transformUslmXml',
  ]);

  return normalizeParseResult(await parseXml(xml));
}

async function loadMarkdownRenderers() {
  const modulePath = resolve(process.cwd(), 'src', 'transforms', 'markdown.ts');
  const mod = await safeImport(modulePath);
  ensureModuleLoaded(modulePath, mod);

  return {
    renderSectionMarkdown: pickCallable(mod, [
      'renderSectionMarkdown',
      'renderSection',
      'sectionToMarkdown',
      'toMarkdown',
      'renderSectionDocument',
      'sectionMarkdown',
      'renderSectionText',
    ]) as (section: any) => string,
    renderTitleMarkdown: pickCallable(mod, [
      'renderTitleMetadata',
      'renderTitleMarkdown',
      'titleToMarkdown',
      'titleMetadataToMarkdown',
      'renderTitleDocument',
      'titleMarkdown',
    ]) as (titleIr: any) => string,
  };
}

describe('issue #12 recursive hierarchy and metadata QA', () => {
  it('parses every fixture <section> node for title 1, 5, 10, and 26 without dropping deeper nested sections', async () => {
    const cases = [
      { relativePath: 'title-01/04-current-uscdoc.xml', title: 1 },
      { relativePath: 'title-05/05-part-chapter-sections.xml', title: 5 },
      { relativePath: 'title-10/10-subtitle-part-chapter-sections.xml', title: 10 },
      { relativePath: 'title-26/26-deep-hierarchy-sections.xml', title: 26 },
    ];

    for (const testCase of cases) {
      const xml = readFixture(testCase.relativePath);
      const result = await parseXmlFixture(xml);
      const titleIr = result.titleIr;

      expect(titleIr?.titleNumber).toBe(testCase.title);
      expect(Array.isArray(titleIr?.sections)).toBe(true);
      expect(titleIr.sections).toHaveLength(fixtureSectionCount(xml));
      expect(result.parseErrors).toEqual([]);
    }
  });

  it('preserves hierarchy metadata on parsed sections from part-, subtitle-, and deep-nesting fixtures', async () => {
    const title5 = (await parseXmlFixture(readFixture('title-05/05-part-chapter-sections.xml'))).titleIr;
    const title10 = (await parseXmlFixture(readFixture('title-10/10-subtitle-part-chapter-sections.xml'))).titleIr;
    const title26 = (await parseXmlFixture(readFixture('title-26/26-deep-hierarchy-sections.xml'))).titleIr;

    const section101Title5 = title5.sections.find((section: any) => section.sectionNumber === '101');
    expect(section101Title5?.hierarchy).toMatchObject({ part: 'I', chapter: '1' });
    expect(section101Title5?.hierarchy?.subtitle).toBeUndefined();
    expect(section101Title5?.hierarchy?.subpart).toBeUndefined();
    expect(section101Title5?.hierarchy?.subchapter).toBeUndefined();

    const section101Title10 = title10.sections.find((section: any) => section.sectionNumber === '101');
    expect(section101Title10?.hierarchy).toMatchObject({ subtitle: 'A', part: 'I', chapter: '1' });
    expect(section101Title10?.hierarchy?.subchapter).toBeUndefined();

    const section1Title26 = title26.sections.find((section: any) => section.sectionNumber === '1');
    expect(section1Title26?.hierarchy).toMatchObject({ subtitle: 'A', chapter: '1', subchapter: 'A', part: 'I' });
    expect(section1Title26?.hierarchy?.subpart).toBeUndefined();
  });

  it('extracts sourceCredit and statutory notes into dedicated section fields for real OLRC fixtures', async () => {
    const title5Xml = readFixture('title-05/05-part-chapter-sections.xml');
    const title10Xml = readFixture('title-10/10-subtitle-part-chapter-sections.xml');
    const title26Xml = readFixture('title-26/26-deep-hierarchy-sections.xml');

    expect(title5Xml).toContain('<notes type="uscNote"');
    expect(title10Xml).toContain('<notes type="uscNote"');
    expect(title26Xml).toContain('<notes type="uscNote"');

    const title5 = (await parseXmlFixture(title5Xml)).titleIr;
    const title10 = (await parseXmlFixture(title10Xml)).titleIr;
    const title26 = (await parseXmlFixture(title26Xml)).titleIr;

    for (const [titleIr, sectionNumber] of [
      [title5, '101'],
      [title10, '101'],
      [title26, '1'],
    ] as const) {
      const section = titleIr.sections.find((entry: any) => entry.sectionNumber === sectionNumber);
      expect(typeof section?.sourceCredit).toBe('string');
      expect(section.sourceCredit.length).toBeGreaterThan(10);
      expect(Array.isArray(section?.statutoryNotes)).toBe(true);
      expect(section.statutoryNotes.length).toBeGreaterThan(0);
      expect(section.statutoryNotes[0]).toEqual(
        expect.objectContaining({
          text: expect.any(String),
          topic: expect.any(String),
          noteType: 'uscNote',
        }),
      );
      expect(section.statutoryNotes.every((note: any) => note.noteType === 'uscNote')).toBe(true);
    }
  });

  it('renders hierarchy frontmatter, source_credit, statutory notes, and USC ref links from parsed sections', async () => {
    const { renderSectionMarkdown } = await loadMarkdownRenderers();

    const title10 = (await parseXmlFixture(readFixture('title-10/10-subtitle-part-chapter-sections.xml'))).titleIr;
    const title26 = (await parseXmlFixture(readFixture('title-26/26-deep-hierarchy-sections.xml'))).titleIr;

    const title10Section = title10.sections.find((section: any) => section.sectionNumber === '101');
    const title26Section = title26.sections.find((section: any) => section.sectionNumber === '1');

    const title10Markdown = renderSectionMarkdown(title10Section);
    const title26Markdown = renderSectionMarkdown(title26Section);

    const parsed10 = matter(title10Markdown);
    expect(parsed10.data).toMatchObject({
      title: 10,
      section: '101',
      subtitle: 'A',
      part: 'I',
      chapter: '1',
      source_credit: expect.any(String),
    });
    expect(parsed10.data.subchapter).toBeUndefined();
    expect(parsed10.content).toContain('## Statutory Notes');
    expect(parsed10.content).toMatch(/\[[^\]]*125\(d\)[^\]]*\]\(\.\.\/title-10-armed-forces\/section-00125d\.md\)/u);
    expect(parsed10.content).not.toMatch(/\[[^\]]+\]\(\.\.\.\/title-10\/section-00125d\.md\)/u);
    expect(parsed10.content).toContain(
      'that is established by the Secretary of Defense under [section 191 of this title](../title-10-armed-forces/section-00191.md) (or under the second sentence of [section 125(d) of this title](../title-10-armed-forces/section-00125d.md) (as in effect before October 1, 1986)) to perform a supply or service activity common to more than one military department',
    );
    expect(parsed10.content).toContain(
      'that is established by the Secretary of Defense under [section 191 of this title](../title-10-armed-forces/section-00191.md) (or under the second sentence of [section 125(d) of this title](../title-10-armed-forces/section-00125d.md) (as in effect before October 1, 1986)) to perform a supply or service activity common to more than one military department; and',
    );
    expect(parsed10.content).toContain(
      '[Section 125(d) of this title](../title-10-armed-forces/section-00125d.md), referred to in subsec. (a)(12)(A), was repealed by Pub. L. 99–433, title III, § 301(b)(1), Oct. 1, 1986, 100 Stat. 1022.',
    );
    expect(parsed10.content).not.toContain('#ref=');
    expect(String(parsed10.data.source_credit)).toContain('(Aug. 10, 1956, ch. 1041, 70A Stat. 3;');
    expect(String(parsed10.data.source_credit)).toContain('Pub. L. 85–861, §§ 1(1), 33(a)(1), Sept. 2, 1958, 72 Stat. 1437, 1564;');
    expect(String(parsed10.data.source_credit)).toContain('Pub. L. 99–433, title III, § 302, Oct. 1, 1986, 100 Stat. 1022;');
    expect(String(parsed10.data.source_credit)).not.toContain('](/us/');
    expect(String(parsed10.data.source_credit)).not.toContain('[Aug. 10, 1956, ch. 1041]');
    expect(String(parsed10.data.source_credit)).not.toContain('[70A Stat. 3]');

    const parsed26 = matter(title26Markdown);
    expect(parsed26.data).toMatchObject({
      title: 26,
      section: '1',
      subtitle: 'A',
      chapter: '1',
      subchapter: 'A',
      part: 'I',
      source_credit: expect.any(String),
    });
    expect(parsed26.data.subpart).toBeUndefined();
    expect(parsed26.content).toContain('## Statutory Notes');
    expect(parsed26.content).toMatch(/\[[^\]]+\]\((?:\.\.\/)+title-\d{2}(?:-[a-z0-9-]+)?\/section-\d{5}[A-Za-z0-9-]*\.md\)/u);
  });

  it('omits the duplicate per-section list from _title.md while keeping chapter navigation', async () => {
    const { renderTitleMarkdown } = await loadMarkdownRenderers();

    const markdown = renderTitleMarkdown({
      titleNumber: 1,
      heading: 'Ordering test',
      positiveLaw: true,
      chapters: [{ number: 'I', heading: 'Ordering' }],
      sections: [
        { sectionNumber: '114', heading: 'Heading zeta 114' },
        { sectionNumber: '106b', heading: 'Heading epsilon 106b' },
        { sectionNumber: '2', heading: 'Heading beta 2' },
        { sectionNumber: '106a', heading: 'Heading delta 106a' },
        { sectionNumber: '10', heading: 'Heading gamma 10' },
        { sectionNumber: '1', heading: 'Heading alpha 1' },
      ],
    });

    expect(markdown).toContain('# Title 1. Ordering test');
    expect(markdown).toContain('## Chapters');
    expect(markdown).toContain('- I — Ordering');
    expect(markdown).not.toContain('Heading alpha 1');
    expect(markdown).not.toContain('Heading beta 2');
    expect(markdown).not.toContain('Heading gamma 10');
    expect(markdown).not.toContain('Heading delta 106a');
    expect(markdown).not.toContain('Heading epsilon 106b');
    expect(markdown).not.toContain('Heading zeta 114');
  });

  it('keeps mixed-case suffix ordering deterministic for 106, 106A, 106a, and 106b', async () => {
    const normalizeModulePath = resolve(process.cwd(), 'src', 'domain', 'normalize.ts');
    const normalizeModule = await safeImport(normalizeModulePath);
    ensureModuleLoaded(normalizeModulePath, normalizeModule);
    const compareSectionNumbers = pickCallable(normalizeModule, [
      'compareSectionNumbers',
      'compareSections',
      'compareSectionIds',
      'compareSectionIdentifiers',
    ]) as (left: string, right: string) => number;

    expect(compareSectionNumbers('106', '106A')).toBeLessThan(0);
    expect(compareSectionNumbers('106A', '106a')).not.toBe(0);
    expect(compareSectionNumbers('106a', '106b')).toBeLessThan(0);

    const { renderTitleMarkdown } = await loadMarkdownRenderers();
    const markdown = renderTitleMarkdown({
      titleNumber: 1,
      heading: 'Mixed case ordering test',
      positiveLaw: true,
      chapters: [{ number: 'I', heading: 'Ordering' }],
      sections: [
        { sectionNumber: '106b', heading: 'Heading delta 106b' },
        { sectionNumber: '106a', heading: 'Heading gamma 106a' },
        { sectionNumber: '106A', heading: 'Heading beta 106A' },
        { sectionNumber: '106', heading: 'Heading alpha 106' },
      ],
    });

    expect(markdown).toContain('## Chapters');
    expect(markdown).toContain('- I — Ordering');
    expect(markdown).not.toContain('Heading alpha 106');
    expect(markdown).not.toContain('Heading beta 106A');
    expect(markdown).not.toContain('Heading gamma 106a');
    expect(markdown).not.toContain('Heading delta 106b');
  });

  it('derives zero-padded section filenames from the write-output path helper for canonical examples', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'transforms', 'write-output.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);
    const sectionFilePath = pickCallable(mod, [
      'sectionFilePath',
      'buildSectionFilePath',
      'getSectionFilePath',
      'getSectionFileName',
      'sectionFileName',
      'deriveSectionFileName',
      'deriveSectionPath',
    ]) as (titleNumber: number, sectionNumber: string) => string;

    expect(sectionFilePath(1, '1')).toMatch(/section-00001\.md$/u);
    expect(sectionFilePath(1, '101')).toMatch(/section-00101\.md$/u);
    expect(sectionFilePath(1, '1234')).toMatch(/section-01234\.md$/u);
    expect(sectionFilePath(1, '106a')).toMatch(/section-00106a\.md$/u);
    expect(sectionFilePath(1, '7702B')).toMatch(/section-07702B\.md$/u);
    expect(sectionFilePath(1, '2/3')).toMatch(/section-00002-3\.md$/u);
  });

  it('committed hierarchy fixtures stay aligned with their claimed structural depth', () => {
    const title5 = parser.parse(readFixture('title-05/05-part-chapter-sections.xml'));
    const title10 = parser.parse(readFixture('title-10/10-subtitle-part-chapter-sections.xml'));
    const title26 = parser.parse(readFixture('title-26/26-deep-hierarchy-sections.xml'));

    expect(title5.uscDoc.main.title.part.chapter.section).toBeTruthy();
    expect(title10.uscDoc.main.title.subtitle.part.chapter.section).toBeTruthy();
    expect(title26.uscDoc.main.title.subtitle.chapter.subchapter.part.section).toBeTruthy();
  });
});
