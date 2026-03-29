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
  return (xml.match(/<section\b/gu) ?? []).length;
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
    const title5 = (await parseXmlFixture(readFixture('title-05/05-part-chapter-sections.xml'))).titleIr;
    const title10 = (await parseXmlFixture(readFixture('title-10/10-subtitle-part-chapter-sections.xml'))).titleIr;
    const title26 = (await parseXmlFixture(readFixture('title-26/26-deep-hierarchy-sections.xml'))).titleIr;

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
        }),
      );
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
    expect(parsed10.content).toMatch(/\[[^\]]+\]\((?:\.\.\/)+title-\d{2}\/section-\d{5}[A-Za-z0-9-]*\.md\)/u);

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
    expect(parsed26.content).toMatch(/\[[^\]]+\]\((?:\.\.\/)+title-\d{2}\/section-\d{5}[A-Za-z0-9-]*\.md\)/u);
  });

  it('renders _title.md sections in canonical numeric-plus-suffix order instead of discovery order', async () => {
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

    const positions = [
      'Heading alpha 1',
      'Heading beta 2',
      'Heading gamma 10',
      'Heading delta 106a',
      'Heading epsilon 106b',
      'Heading zeta 114',
    ].map((needle) => markdown.indexOf(needle));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
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
