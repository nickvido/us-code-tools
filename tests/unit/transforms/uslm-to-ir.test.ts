import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { pickCallable, safeImport, ensureModuleLoaded } from '../../utils/module-helpers';

function readFixture(relativePath: string): string {
  return readFile(resolve(process.cwd(), 'tests', 'fixtures', 'xml', 'title-01', relativePath), 'utf8');
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

describe('uslm-to-ir parser', () => {
  it('parses title, chapters, and section metadata from fixture XML', async () => {
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

    const result = normalizeParseResult(await parseXml(readFixture('01-base.xml')));
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
    const parseModule = await safeImport(resolve(process.cwd(), 'src', 'transforms', 'uslm-to-ir.ts'));
    ensureModuleLoaded(resolve(process.cwd(), 'src', 'transforms', 'uslm-to-ir.ts'), parseModule);
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

    const result = normalizeParseResult(await parseXml(readFixture('01-base.xml')));
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
    const parseModule = await safeImport(resolve(process.cwd(), 'src', 'transforms', 'uslm-to-ir.ts'));
    ensureModuleLoaded(resolve(process.cwd(), 'src', 'transforms', 'uslm-to-ir.ts'), parseModule);
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

    const result = normalizeParseResult(await parseXml(readFixture('02-more.xml')));
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
});

function parenLabelIsNormalized(label: string): boolean {
  return /^\([a-zA-Z0-9ivx]+\)$/u.test(label);
}
