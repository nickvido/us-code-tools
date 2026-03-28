import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { pickCallable, safeImport, ensureModuleLoaded } from './utils/module-helpers';

function normalizeParseResult(result: unknown): {
  titleIr?: any;
  parseErrors: unknown[];
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

async function loadParseFn(): Promise<(xml: string) => Promise<unknown>> {
  const modulePath = resolve(process.cwd(), 'src', 'transforms', 'uslm-to-ir.ts');
  const mod = await safeImport(modulePath);
  ensureModuleLoaded(modulePath, mod);
  return pickCallable(mod, [
    'parseUslmToIr',
    'parseUslmToIR',
    'parseUslmXml',
    'parseUslmXmlToIr',
    'parseXmlToIr',
    'parseTitleXml',
    'parseTitleXmlToIr',
    'transformUslmXml',
  ]) as (xml: string) => Promise<unknown>;
}

describe('adversary round 3 regressions for #1', () => {
  it('separates source-credit notes from editorial notes in section IR', async () => {
    const parseXml = await loadParseFn();

    const xml = `
      <uslm>
        <title>
          <num>1</num>
          <heading>General Provisions</heading>
          <section>
            <num>999</num>
            <heading>Source credit test</heading>
            <status>in-force</status>
            <source>https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title1-section999</source>
            <note>
              <type>source-credit</type>
              <text>Derived from 1994 U.S.C. Historical Sources.</text>
            </note>
            <note>
              <type>editorial</type>
              <text>General editorial history follows.</text>
            </note>
            <paragraph>
              <num>(1)</num>
              <text>The word “code” means this section.</text>
            </paragraph>
          </section>
        </title>
      </uslm>
    `;

    const result = normalizeParseResult(await parseXml(xml));
    const section = result.titleIr?.sections?.[0];

    expect(result.titleIr).toBeTypeOf('object');
    expect(Array.isArray(result.titleIr?.sections)).toBe(true);
    expect(section?.sectionNumber).toBe('999');

    const sourceCredits = Array.isArray(section?.sourceCredits) ? section.sourceCredits : [];
    const editorialNotes = Array.isArray(section?.editorialNotes) ? section.editorialNotes : [];

    expect(sourceCredits).toHaveLength(1);
    expect(sourceCredits[0]).toContain('1994 U.S.C. Historical Sources');
    expect(editorialNotes).toHaveLength(1);
    expect(editorialNotes[0]).toMatchObject({
      kind: 'editorial',
      text: expect.stringContaining('General editorial history'),
    });
    expect(editorialNotes.some((note: any) => note?.kind === 'source-credit')).toBe(false);
  });

  it('reports oversized normalized field text as parse error and does not emit that section', async () => {
    const parseXml = await loadParseFn();
    const oversizedText = 'A'.repeat(1_100_000);

    const xml = `
      <uslm>
        <title>
          <num>1</num>
          <heading>General Provisions</heading>
          <section>
            <num>1000</num>
            <heading>Oversize field test</heading>
            <status>in-force</status>
            <source>https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title1-section1000</source>
            <paragraph>
              <num>(1)</num>
              <text>${oversizedText}</text>
            </paragraph>
          </section>
        </title>
      </uslm>
    `;

    const result = normalizeParseResult(await parseXml(xml));

    expect(result.titleIr).toBeTypeOf('object');
    expect(Array.isArray(result.parseErrors)).toBe(true);
    expect(result.parseErrors.length).toBeGreaterThan(0);

    const parseErrorCodes = result.parseErrors
      .map((error: any) => String(error?.code ?? error?.kind ?? '').toLowerCase())
      .filter((code) => code.length > 0);

    expect(
      parseErrorCodes.includes('unsupported_structure') ||
        parseErrorCodes.includes('invalid_xml') ||
        parseErrorCodes.includes('invalid-xml') ||
        parseErrorCodes.includes('unsupported-structure')
    ).toBe(true);

    expect(Array.isArray(result.titleIr?.sections)).toBe(true);
    expect(result.titleIr?.sections.some((section: any) => section?.sectionNumber === '1000')).toBe(false);
    expect(result.titleIr?.sections).toHaveLength(0);
  });
});
