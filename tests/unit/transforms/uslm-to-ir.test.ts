import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { pickCallable, safeImport, ensureModuleLoaded } from '../../utils/module-helpers';

function readFixture(relativePath: string): string {
  return readFixtureFrom('title-01', relativePath);
}

function readFixtureFrom(titleDir: string, relativePath: string): string {
  return readFileSync(resolve(process.cwd(), 'tests', 'fixtures', 'xml', titleDir, relativePath), 'utf8');
}

function normalizeParseResult(result: unknown): {
  titleIr?: any;
  parseErrors?: unknown[];
} {
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

function parseFixtureSource(xml: string) {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    trimValues: false,
  }).parse(xml);
}

function buildNumContractXml(options: {
  titleNum: string;
  chapterNum: string;
  sectionNum: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<uscDoc xmlns="http://xml.house.gov/schemas/uslm/1.0" schemaLocation="http://xml.house.gov/schemas/uslm/1.0 USLM-1.0.15.xsd">
  <meta>
    <docNumber>1</docNumber>
    <docTitle>General Provisions</docTitle>
  </meta>
  <main>
    <title identifier="/us/usc/t1">
      ${options.titleNum}
      <heading>General Provisions</heading>
      <chapter identifier="/us/usc/t1/ch1">
        ${options.chapterNum}
        <heading>Rules of Construction</heading>
        <section identifier="/us/usc/t1/s1">
          ${options.sectionNum}
          <heading>Words denoting number, gender, and so forth</heading>
          <content><p>Section 1 text.</p></content>
        </section>
      </chapter>
    </title>
  </main>
</uscDoc>`;
}

function buildEmbeddedActInNoteXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<uscDoc xmlns="http://xml.house.gov/schemas/uslm/1.0" xmlns:html="http://www.w3.org/1999/xhtml">
  <meta>
    <docNumber>4</docNumber>
    <docTitle>Flag and Seal, Seat of Government, and the States</docTitle>
  </meta>
  <main>
    <title identifier="/us/usc/t4">
      <num value="4">Title 4—</num>
      <heading>FLAG AND SEAL, SEAT OF GOVERNMENT, AND THE STATES</heading>
      <chapter identifier="/us/usc/t4/ch1">
        <num value="1">CHAPTER 1—</num>
        <heading>THE FLAG</heading>
        <section identifier="/us/usc/t4/s8">
          <num value="8">§ 8.</num>
          <heading>Respect for flag</heading>
          <content><p>No disrespect should be shown to the flag of the United States of America.</p></content>
          <notes>
            <note topic="statutoryNotes">
              <heading>Freedom to Display the American Flag Act of 2005</heading>
              <p>Pub. L. 109–243 provided that:</p>
              <section identifier="/us/pl/109/243/s1">
                <num value="1">§ 1.</num>
                <heading>Short Title</heading>
                <content><p>This Act may be cited as the “Freedom to Display the American Flag Act of 2005”.</p></content>
              </section>
              <section identifier="/us/pl/109/243/s2">
                <num value="2">§ 2.</num>
                <heading>Definitions</heading>
                <content><p>In this Act, the term “residential real estate management association” has the meaning given that term in section 3.</p></content>
              </section>
            </note>
          </notes>
        </section>
      </chapter>
    </title>
  </main>
</uscDoc>`;
}

describe('uslm-to-ir parser', () => {
  it('parses title, chapters, and section metadata from fixture XML', async () => {
    const result = await parseXmlFixture(readFixture('01-base.xml'));
    const titleIr = result.titleIr;

    expect(titleIr).toBeTypeOf('object');
    expect(titleIr.titleNumber).toBe(1);
    expect(titleIr.heading).toBe('General Provisions');
    expect(Array.isArray(titleIr.chapters)).toBe(true);
    expect(titleIr.chapters).toHaveLength(1);
    expect(titleIr.chapters[0]).toMatchObject({
      number: 'I',
      heading: 'General Provisions',
    });
    expect(Array.isArray(titleIr.sections)).toBe(true);
    expect(titleIr.sections).toHaveLength(2);

    const section1 = titleIr.sections.find((section: any) => section.sectionNumber === '1');
    expect(section1).toBeTruthy();
    expect(section1?.heading).toBe('Words denoting number, gender, and so forth');
    expect(section1?.status).toBe('in-force');
    expect(section1?.source).toContain('USC-prelim-title1-section1');
    expect(Array.isArray(section1?.content)).toBe(true);

    const subsection = section1?.content?.find((node: any) => node.type === 'subsection');
    expect(subsection?.label).toBe('(a)');
    expect(Array.isArray(subsection?.children)).toBe(true);
  });

  it('normalizes single-item and multi-item hierarchy nodes to array-backed content trees', async () => {
    const result = await parseXmlFixture(readFixture('01-base.xml'));
    const titleIr = result.titleIr;
    const section = titleIr?.sections?.find((item: any) => item.sectionNumber === '36B');

    expect(section).toBeTruthy();
    expect(Array.isArray(section.content)).toBe(true);
    expect(section.content[0].type).toBe('paragraph');

    const paragraph = section.content[0];
    expect(parenLabelIsNormalized(paragraph.label)).toBe(true);
    expect(paragraph.children).toBeInstanceOf(Array);
  });

  it('preserves codified section identifiers and synthesizes stable ids for uncodified nested sections', async () => {
    const result = await parseXmlFixture(readFixture('02-more.xml'));
    const titleIr = result.titleIr;
    const parseErrors = result.parseErrors;

    expect(titleIr.titleNumber).toBe(1);
    expect(titleIr.sections.some((section: any) => section.sectionNumber === '2/3')).toBe(true);
    expect(titleIr.sections.some((section: any) => String(section.sectionNumber).startsWith('uncodified-'))).toBe(true);
    expect(Array.isArray(parseErrors)).toBe(true);
    expect(parseErrors).toEqual([]);
  });

  it('uses non-empty <num @value> as the canonical number for title, chapter, and section nodes', async () => {
    const result = await parseXmlFixture(
      buildNumContractXml({
        titleNum: '<num value="1">Title 9—</num>',
        chapterNum: '<num value="1">Chapter 7—</num>',
        sectionNum: '<num value="1">§ 8.</num>',
      }),
    );

    expect(result.titleIr.titleNumber).toBe(1);
    expect(result.titleIr.chapters).toHaveLength(1);
    expect(result.titleIr.chapters[0].number).toBe('1');
    expect(result.titleIr.sections).toHaveLength(1);
    expect(result.titleIr.sections[0].sectionNumber).toBe('1');
    expect(result.parseErrors).toEqual([]);
  });

  it('falls back to cleaned display text when <num @value> is absent', async () => {
    const result = await parseXmlFixture(
      buildNumContractXml({
        titleNum: '<num>Title 1—</num>',
        chapterNum: '<num>Chapter 36B—</num>',
        sectionNum: '<num>§ 2/3.</num>',
      }),
    );

    expect(result.titleIr.titleNumber).toBe(1);
    expect(result.titleIr.chapters[0].number).toBe('36B');
    expect(result.titleIr.sections[0].sectionNumber).toBe('2/3');
  });

  it('falls back to cleaned display text when <num @value> is present but empty or whitespace-only', async () => {
    const result = await parseXmlFixture(
      buildNumContractXml({
        titleNum: '<num value="   ">Title 1—</num>',
        chapterNum: '<num value="">Chapter 36B—</num>',
        sectionNum: '<num value="  ">§ 2/3.</num>',
      }),
    );

    expect(result.titleIr.titleNumber).toBe(1);
    expect(result.titleIr.chapters[0].number).toBe('36B');
    expect(result.titleIr.sections[0].sectionNumber).toBe('2/3');
  });

  it('strips mixed and doubled trailing decoration from fallback <num> text for title, chapter, and section nodes', async () => {
    const absentValueResult = await parseXmlFixture(
      buildNumContractXml({
        titleNum: '<num>Title 1.—</num>',
        chapterNum: '<num>Chapter 36B.—</num>',
        sectionNum: '<num>§ 2/3.—</num>',
      }),
    );

    expect(absentValueResult.titleIr.titleNumber).toBe(1);
    expect(absentValueResult.titleIr.chapters[0].number).toBe('36B');
    expect(absentValueResult.titleIr.sections[0].sectionNumber).toBe('2/3');

    const emptyValueResult = await parseXmlFixture(
      buildNumContractXml({
        titleNum: '<num value="   ">Title 1.—</num>',
        chapterNum: '<num value="">Chapter 36B.—</num>',
        sectionNum: '<num value="  ">§ 1.—</num>',
      }),
    );

    expect(emptyValueResult.titleIr.titleNumber).toBe(1);
    expect(emptyValueResult.titleIr.chapters[0].number).toBe('36B');
    expect(emptyValueResult.titleIr.sections[0].sectionNumber).toBe('1');
    expect(emptyValueResult.parseErrors).toEqual([]);
  });

  it('treats non-empty <num @value> as authoritative even when display text cleans to a different number', async () => {
    const result = await parseXmlFixture(
      buildNumContractXml({
        titleNum: '<num value="1">Title 7—</num>',
        chapterNum: '<num value="2">Chapter 8—</num>',
        sectionNum: '<num value="7">§ 8.</num>',
      }),
    );

    expect(result.titleIr.titleNumber).toBe(1);
    expect(result.titleIr.chapters[0].number).toBe('2');
    expect(result.titleIr.sections[0].sectionNumber).toBe('7');
  });

  it('parses current uscDoc fixtures with namespaces and returns 53 sections whose numbers match source <num @value> values', async () => {
    const xml = readFixture('04-current-uscdoc.xml');
    const source = parseFixtureSource(xml);
    const sourceTitle = source.uscDoc.main.title;
    const sourceChapter = Array.isArray(sourceTitle.chapter) ? sourceTitle.chapter[0] : sourceTitle.chapter;
    const sourceSections = Array.isArray(sourceChapter.section) ? sourceChapter.section : [sourceChapter.section];

    const result = await parseXmlFixture(xml);
    const titleIr = result.titleIr;
    const parseErrors = result.parseErrors as any[];

    expect(titleIr).toBeTypeOf('object');
    expect(titleIr.titleNumber).toBe(1);
    expect(titleIr.heading).toBe('General Provisions');
    expect(Array.isArray(titleIr.chapters)).toBe(true);
    expect(titleIr.chapters).toHaveLength(1);
    expect(titleIr.chapters[0].number).toBe(sourceChapter.num['@_value']);
    expect(Array.isArray(titleIr.sections)).toBe(true);
    expect(titleIr.sections).toHaveLength(53);

    expect(titleIr.sections.map((section: any) => section.sectionNumber)).toEqual(
      sourceSections.map((section: any) => section.num['@_value']),
    );
    expect(titleIr.sections[0].sectionNumber).toBe('1');
    expect(titleIr.sections[52].sectionNumber).toBe('53');
    expect(titleIr.sections.every((section: any) => typeof section.sectionNumber === 'string')).toBe(true);
    expect(parseErrors.some((error) => String(error.code ?? '').includes('INVALID_XML'))).toBe(false);
    expect(parseErrors.some((error) => String(error.code ?? '').includes('MISSING_SECTION_NUMBER'))).toBe(false);
  });

  it('asserts the refreshed current uscDoc fixture matches the XSD-shaped structural contract', () => {
    const xml = readFixture('04-current-uscdoc.xml');
    const parsed = parseFixtureSource(xml);
    const sourceTitle = parsed.uscDoc.main.title;
    const sourceChapter = Array.isArray(sourceTitle.chapter) ? sourceTitle.chapter[0] : sourceTitle.chapter;
    const sourceSections = Array.isArray(sourceChapter.section) ? sourceChapter.section : [sourceChapter.section];

    expect(parsed.uscDoc).toBeTypeOf('object');
    expect(parsed.uscDoc.meta.docNumber).toBe(1);
    expect(parsed.uscDoc.main).toBeTypeOf('object');
    expect(sourceTitle['@_identifier']).toBe('/us/usc/t1');
    expect(sourceTitle.num['#text']).toBe('Title 1—');
    expect(sourceTitle.num['@_value']).toBe('1');
    expect(sourceTitle.heading).toBe('General Provisions');
    expect(sourceChapter['@_identifier']).toBe('/us/usc/t1/ch1');
    expect(sourceChapter.num['#text']).toBe('Chapter 1—');
    expect(sourceChapter.num['@_value']).toBe('1');
    expect(sourceChapter.heading).toBe('Rules of Construction');
    expect(sourceSections).toHaveLength(53);
    expect(sourceSections.every((section: any) => /^\/us\/usc\/t1\/s[^\s]+$/u.test(section['@_identifier']))).toBe(true);
    expect(sourceSections.every((section: any) => typeof section.content?.p === 'string' && section.content.p.length > 0)).toBe(true);

    const sampleSection = sourceSections[0];
    expect(sampleSection.num['#text']).toBe('§ 1.');
    expect(sampleSection.num['@_value']).toBe('1');
    expect(sampleSection.heading).toBe('Section 1 heading');
    expect(sampleSection.num['#text']).not.toBe(sampleSection.num['@_value']);

    expect(xml).toMatch(/<title[^>]*>\s*<num value="1">Title 1—<\/num>\s*<heading>/u);
    expect(xml).toMatch(/<chapter[^>]*>\s*<num value="1">Chapter 1—<\/num>\s*<heading>/u);
    expect(xml).toMatch(/<section identifier="\/us\/usc\/t1\/s1"><num value="1">§ 1\.<\/num><heading>/u);
  });

  it('tolerates raw namespaced uscDoc XML without caller-side preprocessing', async () => {
    const xml = readFixture('04-current-uscdoc.xml')
      .replace(/<uscDoc/g, '<ns:uscDoc')
      .replace(/<\/uscDoc>/g, '</ns:uscDoc>')
      .replace(/<main>/g, '<ns:main>')
      .replace(/<\/main>/g, '</ns:main>')
      .replace(/<title /g, '<ns:title ')
      .replace(/<\/title>/g, '</ns:title>')
      .replace(/<chapter /g, '<ns:chapter ')
      .replace(/<\/chapter>/g, '</ns:chapter>')
      .replace(/<section /g, '<ns:section ')
      .replace(/<\/section>/g, '</ns:section>')
      .replace(/<num /g, '<ns:num ')
      .replace(/<num>/g, '<ns:num>')
      .replace(/<\/num>/g, '</ns:num>')
      .replace(/<heading>/g, '<ns:heading>')
      .replace(/<\/heading>/g, '</ns:heading>')
      .replace(/<content>/g, '<ns:content>')
      .replace(/<\/content>/g, '</ns:content>')
      .replace(/<p>/g, '<ns:p>')
      .replace(/<\/p>/g, '</ns:p>')
      .replace('schemaLocation=', 'xmlns:ns="http://xml.house.gov/schemas/uslm/1.0" schemaLocation=');

    const result = await parseXmlFixture(xml);
    const titleIr = result.titleIr;

    expect(titleIr).toBeTypeOf('object');
    expect(titleIr.titleNumber).toBe(1);
    expect(titleIr.sections).toHaveLength(53);
    expect(titleIr.sections[0].sectionNumber).toBe('1');
  });

  it('preserves section chapeau and all ten numbered paragraph bodies for title 42 section 10307', async () => {
    const result = await parseXmlFixture(readFixtureFrom('title-42', '42-section-10307.xml'));
    const section = result.titleIr.sections.find((entry: any) => entry.sectionNumber === '10307');

    expect(section).toBeTruthy();
    expect(section.heading).toBe('Types of research and development');
    expect(Array.isArray(section.content)).toBe(true);
    expect(section.content[0]).toMatchObject({
      type: 'text',
      text: 'The type of research and development to be undertaken under section 10304 of this title shall include the following:',
    });

    const paragraphs = section.content.filter((node: any) => node.type === 'paragraph');
    expect(paragraphs).toHaveLength(10);
    expect(paragraphs.map((node: any) => node.label)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
    ]);
    expect(paragraphs.map((node: any) => node.text)).toEqual([
      'Aspects of the hydrologic cycle;',
      'Supply and demand for water;',
      'Conservation and best use of available supplies of water;',
      'Methods of increasing the effective use of water;',
      'Methods of increasing the effective use of precipitation;',
      'More efficient use of water in agriculture;',
      'Methods of reclaiming water and wastewater;',
      'Methods of reducing water pollution;',
      'Effects of water pollution on water supplies and on the environment; and',
      'Improved forecasting of water demand and availability.',
    ]);
    expect(result.parseErrors).toEqual([]);
  });

  it('preserves continuation text after nested children and does not drop subclause bodies', async () => {
    const result = await parseXmlFixture(readFixtureFrom('title-26', '26-deep-hierarchy-sections.xml'));
    const section = result.titleIr.sections.find((entry: any) => entry.sectionNumber === '2');

    expect(section).toBeTruthy();

    const subsection = section.content.find((node: any) => node.type === 'subsection' && node.label === 'b');
    expect(subsection).toBeTruthy();

    const paragraph = subsection.children.find((node: any) => node.type === 'paragraph' && node.label === '1');
    expect(paragraph).toBeTruthy();
    expect(String(paragraph.text ?? '')).toContain('For purposes of this subtitle, an individual shall be considered a head of a household');

    const subparagraph = paragraph.children.find((node: any) => node.type === 'subparagraph' && node.label === 'A');
    expect(subparagraph).toBeTruthy();
    expect(String(subparagraph.text ?? '')).toContain('maintains as his home a household');

    const clause = subparagraph.children.find((node: any) => node.type === 'clause' && node.label === 'i');
    expect(clause).toBeTruthy();
    expect(String(clause.text ?? '')).toContain('a qualifying child of the individual');
    expect(clause.children.map((node: any) => node.type)).toEqual(['subclause', 'subclause']);
    expect(clause.children.map((node: any) => node.label)).toEqual(['I', 'II']);
    expect(clause.children.map((node: any) => node.text)).toEqual([
      'is married at the close of the taxpayer’s taxable year, and',
      'is not a dependent of such individual by reason of section 152(b)(2) or 152(b)(3), or both, or',
    ]);

    expect(
      paragraph.children.some(
        (node: any) => node.type === 'text' && String(node.text).includes('For purposes of this paragraph, an individual shall be considered as maintaining a household'),
      ),
    ).toBe(true);
    expect(result.parseErrors).toEqual([]);
  });

  it('extracts subsection body text from nested <content><p> blocks without collapsing later structured children', async () => {
    const result = await parseXmlFixture(readFixtureFrom('title-26', '26-deep-hierarchy-sections.xml'));
    const section = result.titleIr.sections.find((entry: any) => entry.sectionNumber === '1');

    expect(section).toBeTruthy();

    const subsection = section.content.find((node: any) => node.type === 'subsection' && node.label === 'b');
    expect(subsection).toBeTruthy();
    expect(String(subsection.text ?? '')).toContain('There is hereby imposed on the taxable income of every head of a household');
    expect(String(subsection.text ?? '')).toContain('The tax is:');
    expect(subsection.children).toEqual([]);

    const subsectionWithNestedChildren = section.content.find((node: any) => node.type === 'subsection' && node.label === 'f');
    expect(subsectionWithNestedChildren).toBeTruthy();
    expect(subsectionWithNestedChildren.children.some((node: any) => node.type === 'paragraph' && node.label === '2')).toBe(true);
  });

  it('uses the canonical OLRC sourceUrlTemplate contract with num=0 and edition=prelim', async () => {
    const result = await parseXmlFixture(readFixtureFrom('title-05', '05-part-chapter-sections.xml'));

    expect(result.titleIr.sourceUrlTemplate).toBe(
      'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section{section}&num=0&edition=prelim',
    );
    expect(result.titleIr.sourceUrlTemplate).toContain('&num=0');
    expect(result.titleIr.sourceUrlTemplate).toContain('&edition=prelim');

    const section101 = result.titleIr.sections.find((entry: any) => entry.sectionNumber === '101');
    expect(section101).toBeTruthy();
    expect(String(section101.source ?? '')).toContain('&num=0');
    expect(String(section101.source ?? '')).toContain('&edition=prelim');
  });

  it('preserves multi-paragraph note boundaries and table structure from real note fixtures', async () => {
    const result = await parseXmlFixture(readFixtureFrom('title-05', '05-part-chapter-sections.xml'));
    const section101 = result.titleIr.sections.find((entry: any) => entry.sectionNumber === '101');

    expect(section101).toBeTruthy();

    const noteText = JSON.stringify({
      statutoryNotes: section101.statutoryNotes ?? [],
      editorialNotes: section101.editorialNotes ?? [],
    });

    expect(noteText).toContain('Historical and Revision Notes');
    expect(noteText).toContain('The reference in former section 1 to the application of the provisions of this title');
    expect(noteText).toContain('The statement in former section 2 that the use of the word “department” means one of the Executive departments named in former section 1 is omitted as unnecessary');
    expect(noteText).toContain('\n\n');
    expect(noteText).toContain('Derivation');
    expect(noteText).toContain('U.S. Code');
    expect(noteText).toContain('Revised Statutes');
    expect(noteText).not.toContain('DerivationU.S. CodeRevised Statutes andStatutes at Large');
  });

  it('keeps embedded Act sections inside note scope instead of promoting them to top-level sections', async () => {
    const result = await parseXmlFixture(buildEmbeddedActInNoteXml());
    const titleIr = result.titleIr;

    expect(titleIr.sections).toHaveLength(1);
    expect(titleIr.sections.map((section: any) => section.sectionNumber)).toEqual(['8']);
    expect(titleIr.sections.some((section: any) => section.sectionNumber === '1')).toBe(false);
    expect(titleIr.sections.some((section: any) => section.sectionNumber === '2')).toBe(false);

    const section8 = titleIr.sections[0];
    const noteText = JSON.stringify({
      statutoryNotes: section8.statutoryNotes ?? [],
      editorialNotes: section8.editorialNotes ?? [],
    });

    expect(noteText).toContain('Freedom to Display the American Flag Act of 2005');
    expect(noteText).toContain('§ 1.');
    expect(noteText).toContain('Short Title');
    expect(noteText).toContain('§ 2.');
    expect(noteText).toContain('Definitions');
    expect(result.parseErrors).toEqual([]);
  });
});

function parenLabelIsNormalized(label: string): boolean {
  return /^\([a-zA-Z0-9ivx]+\)$/u.test(label);
}
