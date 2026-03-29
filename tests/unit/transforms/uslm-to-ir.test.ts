import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { pickCallable, safeImport, ensureModuleLoaded } from '../../utils/module-helpers';

function readFixture(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), 'tests', 'fixtures', 'xml', 'title-01', relativePath), 'utf8');
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

  it('preserves section identifiers and reports missing-section parse errors', async () => {
    const result = await parseXmlFixture(readFixture('02-more.xml'));
    const titleIr = result.titleIr;
    const parseErrors = result.parseErrors;

    expect(titleIr.titleNumber).toBe(1);
    const missing = titleIr.sections.find((section: any) => section.sectionNumber === undefined || section.sectionNumber === null || section.sectionNumber === '');
    expect(missing).toBeUndefined();
    expect(titleIr.sections.length).toBe(1);
    expect(titleIr.sections[0].sectionNumber).toBe('2/3');
    expect(Array.isArray(parseErrors)).toBe(true);
    expect(parseErrors.some((error: any) => String(error.code ?? '').includes('MISSING_SECTION_NUMBER'))).toBe(true);
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
});

function parenLabelIsNormalized(label: string): boolean {
  return /^\([a-zA-Z0-9ivx]+\)$/u.test(label);
}
