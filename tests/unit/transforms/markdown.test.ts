import { describe, it, expect } from 'vitest';
import { pickCallable, safeImport, ensureModuleLoaded } from '../../utils/module-helpers';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import matter from 'gray-matter';

function pickSectionRenderer(moduleExports: Record<string, unknown>): (section: any) => string {
  return pickCallable(moduleExports, [
    'renderSectionMarkdown',
    'renderSection',
    'sectionToMarkdown',
    'toMarkdown',
    'renderSectionDocument',
    'sectionMarkdown',
    'renderSectionText',
  ]) as (section: any) => string;
}

function pickTitleRenderer(moduleExports: Record<string, unknown>): (titleIr: any) => string {
  return pickCallable(moduleExports, [
    'renderTitleMetadata',
    'renderTitleMarkdown',
    'titleToMarkdown',
    'titleMetadataToMarkdown',
    'renderTitleDocument',
    'titleMarkdown',
  ]) as (titleIr: any) => string;
}

describe('markdown renderer', () => {
  it('renders section frontmatter including required keys', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'transforms', 'markdown.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);
    const renderSectionMarkdown = pickSectionRenderer(mod);

    const markdown = renderSectionMarkdown({
      titleNumber: 1,
      sectionNumber: '1',
      heading: 'Words denoting number, gender, and so forth',
      status: 'in-force',
      source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title1-section1',
      enacted: '1947-07-30',
      publicLaw: 'PL 80-772',
      lastAmended: '1998-11-13',
      lastAmendedBy: 'PL 105-277',
      content: [
        {
          type: 'subsection',
          label: '(a)',
          heading: 'Definitions',
          text: 'The word "number" means...',
          children: [],
        },
      ],
    });

    const parsed = parseFrontmatter(markdown);
    expect(parsed.data).toMatchObject({
      title: 1,
      section: '1',
      heading: 'Words denoting number, gender, and so forth',
      status: 'in-force',
      source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title1-section1',
      enacted: '1947-07-30',
      public_law: 'PL 80-772',
      last_amended: '1998-11-13',
      last_amended_by: 'PL 105-277',
    });
    expect(parsed.content).toContain('# § 1. Words denoting number, gender, and so forth');
  });

  it('renders markdown hierarchy indentation by node type', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'transforms', 'markdown.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);
    const renderSectionMarkdown = pickSectionRenderer(mod);

    const markdown = renderSectionMarkdown({
      titleNumber: 1,
      sectionNumber: '36B',
      heading: 'Protection for private blocking and screening of offensive material',
      status: 'in-force',
      source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title1-section36B',
      content: [
        {
          type: 'subsection',
          label: '(a)',
          heading: 'Nested',
          children: [
            {
              type: 'paragraph',
              label: '(1)',
              text: 'First paragraph.',
              children: [
                {
                  type: 'subparagraph',
                  label: '(A)',
                  text: 'Lettered child.',
                  children: [
                    {
                      type: 'clause',
                      label: '(i)',
                      text: 'Clause text.',
                      children: [
                        {
                          type: 'item',
                          label: '(I)',
                          text: 'Quad-indented item text.',
                          children: [],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(markdown).toContain('(1) First paragraph.');
    expect(markdown).toContain('  (A) Lettered child.');
    expect(markdown).toContain('    (i) Clause text.');
    expect(markdown).toContain('      (I) Quad-indented item text.');
  });

  it('renders title metadata markdown with required keys', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'transforms', 'markdown.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);
    const renderTitleMetadata = pickTitleRenderer(mod);

    const markdown = renderTitleMetadata({
      titleNumber: 1,
      heading: 'General Provisions',
      positiveLaw: true,
      chapters: [
        { number: 'I', heading: 'General Provisions' },
        { number: 'II', heading: 'Citizenship' },
      ],
      sections: [
        { sectionNumber: '1', heading: 'Words denoting number, gender, and so forth' },
        { sectionNumber: '36B', heading: 'Protection for private blocking and screening of offensive material' },
      ],
      sourceUrlTemplate: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title1-section{section}',
    });

    const parsed = parseFrontmatter(markdown);
    expect(parsed.data).toMatchObject({
      title: 1,
      heading: 'General Provisions',
      positive_law: true,
      chapters: 2,
      sections: 2,
    });
  });

  it('keeps editorial/cross-reference material in rendered section snapshot', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'transforms', 'markdown.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);
    const renderSectionMarkdown = pickSectionRenderer(mod);

    const sectionIr = {
      titleNumber: 1,
      sectionNumber: '2/3',
      heading: 'Section with cross-references',
      status: 'in-force',
      source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title1-section2-3',
      content: [
        {
          type: 'paragraph',
          label: '(1)',
          text: 'See section 1 for definitions and "cross-ref" with citation.',
          children: [
            {
              type: 'text',
              text: 'Inline note: For editorial history see section 1.3.',
            },
          ],
        },
      ],
      editorialNotes: [
        {
          kind: 'editorial',
          text: 'Cross-reference note retained for historical interpretation.',
        },
      ],
    };

    const markdown = renderSectionMarkdown(sectionIr);
    expect(markdown).toContain('cross-ref');
    expect(markdown).toContain('Cross-reference note retained for historical interpretation.');
    expect(markdown).toContain('# § 2/3. Section with cross-references');
  });

  it('snapshot: nested hierarchy with subsection and nested clause/item shapes', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'transforms', 'markdown.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);
    const renderSectionMarkdown = pickSectionRenderer(mod);

    const markdown = renderSectionMarkdown({
      titleNumber: 1,
      sectionNumber: '1',
      heading: 'Words denoting number, gender, and so forth',
      status: 'in-force',
      source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title1-section1',
      content: [
        {
          type: 'subsection',
          label: '(a)',
          heading: 'Definitions',
          children: [
            {
              type: 'paragraph',
              label: '(1)',
              text: 'The word "person" means all living persons.',
              children: [
                {
                  type: 'subparagraph',
                  label: '(A)',
                  text: 'An individual natural person.',
                  children: [
                    {
                      type: 'clause',
                      label: '(i)',
                      text: 'This is the nested clause.',
                      children: [
                        {
                          type: 'item',
                          label: '(I)',
                          text: 'Legal note: this branch stays stable.',
                          children: [],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(markdown).toMatchSnapshot();
  });

  it('snapshot: flat section paragraph', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'transforms', 'markdown.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);
    const renderSectionMarkdown = pickSectionRenderer(mod);

    const markdown = renderSectionMarkdown({
      titleNumber: 1,
      sectionNumber: '36B',
      heading: 'Protection for private blocking and screening of offensive material',
      status: 'in-force',
      source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title1-section36B',
      content: [
        {
          type: 'paragraph',
          label: '(1)',
          text: 'A section that only has a flat paragraph.',
          children: [],
        },
      ],
    });

    expect(markdown).toMatchSnapshot();
  });

  it('snapshot: cross-reference and note text is kept', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'transforms', 'markdown.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);
    const renderSectionMarkdown = pickSectionRenderer(mod);

    const markdown = renderSectionMarkdown({
      titleNumber: 1,
      sectionNumber: '2',
      heading: 'Section notes',
      status: 'in-force',
      source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title1-section2',
      content: [
        {
          type: 'paragraph',
          label: '(1)',
          text: 'See 10 U.S.C. § 101 for definition.',
          children: [
            {
              type: 'text',
              text: 'Inline cross-reference to 10 U.S.C. § 101.',
            },
          ],
        },
      ],
      editorialNotes: [
        {
          kind: 'editorial',
          text: 'Historical and legal note retained.',
        },
      ],
    });

    expect(markdown).toMatchSnapshot();
  });

  it('keeps default section frontmatter key order byte-stable for status before source', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'transforms', 'markdown.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);
    const renderSectionMarkdown = pickSectionRenderer(mod);

    const markdown = renderSectionMarkdown({
      titleNumber: 1,
      sectionNumber: '2',
      heading: 'Section notes',
      status: 'in-force',
      source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title1-section2',
      content: [
        {
          type: 'paragraph',
          label: '(1)',
          text: 'See 10 U.S.C. § 101 for definition.',
          children: [],
        },
      ],
    });

    const frontmatterLines = markdown.split('\n').slice(0, 7);
    expect(frontmatterLines).toEqual([
      '---',
      'title: 1',
      "section: '2'",
      'heading: Section notes',
      'status: in-force',
      "source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title1-section2'",
      '---',
    ]);
    expect(markdown.indexOf('\nstatus: in-force\n')).toBeLessThan(markdown.indexOf('\nsource: \'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title1-section2\'\n'));
  });

  it('renders title 42 section 10307 with chapeau text and all ten paragraph bodies', async () => {
    const markdown = await renderFixtureSection({
      titleDir: 'title-42',
      relativePath: '42-section-10307.xml',
      sectionNumber: '10307',
    });

    expect(markdown).toContain('# § 10307. Types of research and development');
    expect(markdown).toContain('The type of research and development to be undertaken under section 10304 of this title shall include the following:');

    const expectedParagraphs = [
      '(1) Aspects of the hydrologic cycle;',
      '(2) Supply and demand for water;',
      '(3) Conservation and best use of available supplies of water;',
      '(4) Methods of increasing the effective use of water;',
      '(5) Methods of increasing the effective use of precipitation;',
      '(6) More efficient use of water in agriculture;',
      '(7) Methods of reclaiming water and wastewater;',
      '(8) Methods of reducing water pollution;',
      '(9) Effects of water pollution on water supplies and on the environment; and',
      '(10) Improved forecasting of water demand and availability.',
    ];

    for (const paragraph of expectedParagraphs) {
      expect(markdown).toContain(paragraph);
    }

    const renderedTwice = await renderFixtureSection({
      titleDir: 'title-42',
      relativePath: '42-section-10307.xml',
      sectionNumber: '10307',
    });
    expect(renderedTwice).toBe(markdown);
  });

  it('renders deep hierarchy content in source order, including continuation text after nested children', async () => {
    const markdown = await renderFixtureSection({
      titleDir: 'title-26',
      relativePath: '26-deep-hierarchy-sections.xml',
      sectionNumber: '2',
    });

    expect(markdown).toContain('# § 2. Definitions and special rules');
    expect(markdown).toContain('(b) Definition of head of household');
    expect(markdown).toContain('(1) In general For purposes of this subtitle, an individual shall be considered a head of a household if, and only if, such individual is not married at the close of his taxable year, is not a surviving spouse (as defined in subsection (a)), and either—');
    expect(markdown).toContain('  (A) maintains as his home a household which constitutes for more than one-half of such taxable year the principal place of abode, as a member of such household, of—');
    expect(markdown).toContain('    (i) a qualifying child of the individual (as defined in section 152(c), determined without regard to section 152(e)), but not if such child—');
    expect(markdown).toContain('      (I) is married at the close of the taxpayer’s taxable year, and');
    expect(markdown).toContain('      (II) is not a dependent of such individual by reason of section 152(b)(2) or 152(b)(3), or both, or');
    expect(markdown).toContain('For purposes of this paragraph, an individual shall be considered as maintaining a household only if over half of the cost of maintaining the household during the taxable year is furnished by such individual.');

    const orderChecks = [
      '(A) maintains as his home a household',
      '(i) a qualifying child of the individual',
      '(I) is married at the close of the taxpayer’s taxable year, and',
      '(II) is not a dependent of such individual by reason of section 152(b)(2) or 152(b)(3), or both, or',
      'For purposes of this paragraph, an individual shall be considered as maintaining a household only if over half of the cost of maintaining the household during the taxable year is furnished by such individual.',
    ];

    const indexes = orderChecks.map((snippet) => markdown.indexOf(snippet));
    expect(indexes.every((index) => index >= 0)).toBe(true);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });

  it('renders subsection lines as heading blocks and keeps deep nested indentation stable', async () => {
    const markdown = await renderFixtureSection({
      titleDir: 'title-26',
      relativePath: '26-deep-hierarchy-sections.xml',
      sectionNumber: '2',
    });

    const lines = markdown.split('\n');
    expect(lines).toContain('## (b) Definition of head of household');
    expect(lines).toContain('(1) In general For purposes of this subtitle, an individual shall be considered a head of a household if, and only if, such individual is not married at the close of his taxable year, is not a surviving spouse (as defined in subsection (a)), and either—');
    expect(lines).toContain('  (A) maintains as his home a household which constitutes for more than one-half of such taxable year the principal place of abode, as a member of such household, of—');
    expect(lines).toContain('    (i) a qualifying child of the individual (as defined in section 152(c), determined without regard to section 152(e)), but not if such child—');
    expect(lines).toContain('      (I) is married at the close of the taxpayer’s taxable year, and');
    expect(lines).toContain('      (II) is not a dependent of such individual by reason of section 152(b)(2) or 152(b)(3), or both, or');
  });
});

function parseFrontmatter(markdown: string) {
  return matter(markdown);
}

function readFixtureFrom(titleDir: string, relativePath: string): string {
  return readFileSync(resolve(process.cwd(), 'tests', 'fixtures', 'xml', titleDir, relativePath), 'utf8');
}

async function renderFixtureSection(xmlFixture: { titleDir: string; relativePath: string; sectionNumber: string }) {
  const parseModulePath = resolve(process.cwd(), 'src', 'transforms', 'uslm-to-ir.ts');
  const parseModule = await safeImport(parseModulePath);
  ensureModuleLoaded(parseModulePath, parseModule);
  const parseUslmToIr = pickCallable(parseModule, [
    'parseUslmToIr',
    'parseUslmToIR',
    'parseUslmXml',
    'parseUslmXmlToIr',
    'parseXmlToIr',
    'parseTitleXml',
    'parseTitleXmlToIr',
    'transformUslmXml',
  ]) as (xml: string) => Promise<any>;

  const renderModulePath = resolve(process.cwd(), 'src', 'transforms', 'markdown.ts');
  const renderModule = await safeImport(renderModulePath);
  ensureModuleLoaded(renderModulePath, renderModule);
  const renderSectionMarkdown = pickSectionRenderer(renderModule);

  const parsed = await parseUslmToIr(readFixtureFrom(xmlFixture.titleDir, xmlFixture.relativePath));
  const titleIr = parsed.titleIr ?? parsed.ir ?? parsed.title ?? parsed.result;
  const section = titleIr.sections.find((entry: any) => entry.sectionNumber === xmlFixture.sectionNumber);

  expect(section).toBeTruthy();
  return renderSectionMarkdown(section);
}
