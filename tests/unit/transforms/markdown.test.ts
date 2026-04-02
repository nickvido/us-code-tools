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

function pickEmbeddedRenderer(moduleExports: Record<string, unknown>): (...args: any[]) => string {
  return pickCallable(moduleExports, [
    'renderChapterMarkdown',
    'renderUncategorizedMarkdown',
    'renderEmbeddedSectionsMarkdown',
    'renderEmbeddedMarkdown',
    'renderChapterDocument',
    'chapterToMarkdown',
  ]) as (...args: any[]) => string;
}

function pickCanonicalUrlBuilder(moduleExports: Record<string, unknown>): (titleNumber: number | string, sectionNumber: string) => string {
  return pickCallable(moduleExports, [
    'buildCanonicalSectionUrl',
    'canonicalSectionUrl',
    'buildSectionUrl',
  ]) as (titleNumber: number | string, sectionNumber: string) => string;
}

function pickSectionLinkRenderer(
  moduleExports: Record<string, unknown>,
): (from: { titleNumber: number; heading?: string | null }, to: { titleNumber: number; heading?: string | null; sectionNumber: string }) => string {
  return pickCallable(moduleExports, [
    'sectionRelativeMarkdownLink',
    'renderSectionRelativeMarkdownLink',
    'sectionLinkHref',
    'renderSectionLinkHref',
  ]) as (from: { titleNumber: number; heading?: string | null }, to: { titleNumber: number; heading?: string | null; sectionNumber: string }) => string;
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

  it('renders nested labeled descendants as bold GitHub-safe paragraphs without code-block indentation', async () => {
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

    expect(markdown).toContain('**(a) Nested**');
    expect(markdown).toContain('\n\n**(1)** First paragraph.');
    expect(markdown).toContain('\n\n**(A)** Lettered child.');
    expect(markdown).toContain('\n\n**(i)** Clause text.');
    expect(markdown).toContain('\n\n**(I)** Quad-indented item text.');
    expect(markdown).not.toContain('\n    (i)');
    expect(markdown).not.toContain('\n      (I)');
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

  it('derives cross-title section links through the shared slugged title directory helper with fallback support', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'transforms', 'markdown.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);
    const renderSectionLink = pickSectionLinkRenderer(mod);

    const sluggedLink = renderSectionLink(
      { titleNumber: 1, heading: 'General Provisions' },
      { titleNumber: 18, heading: 'Crimes and Criminal Procedure', sectionNumber: '1' },
    );
    expect(sluggedLink).toBe('../title-18-crimes-and-criminal-procedure/section-00001.md');

    const fallbackLink = renderSectionLink(
      { titleNumber: 1, heading: 'General Provisions' },
      { titleNumber: 4, heading: ` ' `, sectionNumber: '1' },
    );
    expect(fallbackLink).toBe('../title-04/section-00001.md');
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

  it('renders deep hierarchy content in source order with bold nested labels and GitHub-safe continuation lines', async () => {
    const markdown = await renderFixtureSection({
      titleDir: 'title-26',
      relativePath: '26-deep-hierarchy-sections.xml',
      sectionNumber: '2',
    });

    expect(markdown).toContain('# § 2. Definitions and special rules');
    expect(markdown).toContain('**(b) Definition of head of household**');
    expect(markdown).toContain('**(1) In general** For purposes of this subtitle, an individual shall be considered a head of a household if, and only if, such individual is not married at the close of his taxable year, is not a surviving spouse (as defined in subsection (a)), and either—');
    expect(markdown).toContain('\n\n**(A)** maintains as his home a household which constitutes for more than one-half of such taxable year the principal place of abode, as a member of such household, of—');
    expect(markdown).toContain('\n\n**(i)** a qualifying child of the individual (as defined in section 152(c), determined without regard to section 152(e)), but not if such child—');
    expect(markdown).toContain('\n\n**(I)** is married at the close of the taxpayer’s taxable year, and');
    expect(markdown).toContain('\n\n**(II)** is not a dependent of such individual by reason of section 152(b)(2) or 152(b)(3), or both, or');
    expect(markdown).toContain('For purposes of this paragraph, an individual shall be considered as maintaining a household only if over half of the cost of maintaining the household during the taxable year is furnished by such individual.');
    expect(markdown).not.toContain('\n    (i)');
    expect(markdown).not.toContain('\n      (I)');
    expect(markdown).not.toMatch(/\n {4,}For purposes of this paragraph/);

    const orderChecks = [
      '**(A)** maintains as his home a household',
      '**(i)** a qualifying child of the individual',
      '**(I)** is married at the close of the taxpayer’s taxable year, and',
      '**(II)** is not a dependent of such individual by reason of section 152(b)(2) or 152(b)(3), or both, or',
      'For purposes of this paragraph, an individual shall be considered as maintaining a household only if over half of the cost of maintaining the household during the taxable year is furnished by such individual.',
    ];

    const indexes = orderChecks.map((snippet) => markdown.indexOf(snippet));
    expect(indexes.every((index) => index >= 0)).toBe(true);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });

  it('keeps top-level subsection output inline while promoting deeper descendants to bold paragraph blocks', async () => {
    const markdown = await renderFixtureSection({
      titleDir: 'title-26',
      relativePath: '26-deep-hierarchy-sections.xml',
      sectionNumber: '2',
    });

    const lines = markdown.split('\n');
    expect(lines).toContain('**(b) Definition of head of household**');
    expect(lines).toContain('**(1) In general** For purposes of this subtitle, an individual shall be considered a head of a household if, and only if, such individual is not married at the close of his taxable year, is not a surviving spouse (as defined in subsection (a)), and either—');
    expect(lines).toContain('**(A)** maintains as his home a household which constitutes for more than one-half of such taxable year the principal place of abode, as a member of such household, of—');
    expect(lines).toContain('**(i)** a qualifying child of the individual (as defined in section 152(c), determined without regard to section 152(e)), but not if such child—');
    expect(lines).toContain('**(I)** is married at the close of the taxpayer’s taxable year, and');
    expect(lines).toContain('**(II)** is not a dependent of such individual by reason of section 152(b)(2) or 152(b)(3), or both, or');
    expect(lines).not.toContain('## (b) Definition of head of household');
    expect(lines).not.toContain('    (i) a qualifying child of the individual (as defined in section 152(c), determined without regard to section 152(e)), but not if such child—');
  });

  it('renders cross-title references from parsed USLM fixtures with slugged target directories on the real parser-to-markdown path', async () => {
    const markdown = await renderFixtureSectionByNeedle({
      titleDir: 'title-05',
      relativePath: '05-part-chapter-sections.xml',
      needle: 'Federal Prison Oversight Act',
    });

    expect(markdown).toContain('[section 4041 of Title 18](../title-18-crimes-and-criminal-procedure/section-04041.md)');
    expect(markdown).toContain('[section 2473 of Title 42](../title-42-the-public-health-and-welfare/section-02473.md)');
    expect(markdown).not.toContain('../title-18/section-04041.md');
    expect(markdown).not.toContain('../title-42/section-02473.md');
  });

  it('builds canonical OLRC section URLs with num=0 and edition=prelim', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'domain', 'normalize.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);
    const buildCanonicalSectionUrl = pickCanonicalUrlBuilder(mod);

    const url = buildCanonicalSectionUrl(4, '8');
    expect(url).toBe('https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title4-section8&num=0&edition=prelim');
    expect(url).toContain('&num=0');
    expect(url).toContain('&edition=prelim');
    expect(url).not.toBe('https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title4-section8');
  });

  it('renders embedded chapter output with standalone anchors instead of visible {#section-...} suffixes', async () => {
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
    const renderEmbeddedMarkdown = pickEmbeddedRenderer(renderModule);

    const parsed = await parseUslmToIr(readFixtureFrom('title-01', '03-chapter-section.xml'));
    const titleIr = parsed.titleIr ?? parsed.ir ?? parsed.title ?? parsed.result;

    const chapter = titleIr.chapters?.[0];
    const embeddedSections = titleIr.sections;

    // NOTE: Use the EXISTING embedded/chapter renderer signature — do NOT add a new overload.
    // If the args below differ, adapt this call to the real production signature.
    const markdown = renderEmbeddedMarkdown(titleIr, chapter?.number ?? 'I', embeddedSections);

    expect(markdown).toContain('<a id="section-999"></a>');
    expect(markdown).toContain('## § 999. Chapter-contained section');
    expect(markdown).not.toContain('{#section-999}');
    expect(markdown).not.toContain('## § 999. Chapter-contained section {#section-999}');
    expect(markdown).toMatch(/<a id="section-999"><\/a>\n## § 999\. Chapter-contained section/u);
  });

  it('separates structured subsection siblings with blank lines in rendered markdown', async () => {
    const markdown = await renderFixtureSection({
      titleDir: 'title-10',
      relativePath: '10-subtitle-part-chapter-sections.xml',
      sectionNumber: '101',
    });

    expect(markdown).toContain('The following definitions apply in this title:\n\n(1)');
    expect(markdown).toContain('The following definitions relating to military personnel apply in this title:\n\n(1)');
    expect(markdown).toContain('\n\n(b) Personnel Generally');
    expect(markdown).toContain('\n\n(c) Reserve Components');
    expect(markdown).not.toContain('The following definitions apply in this title:\n(1)');
  });

  it('keeps subsection chapeau and sibling blocks as separate paragraphs on consecutive lines', async () => {
    const markdown = await renderFixtureSection({
      titleDir: 'title-10',
      relativePath: '10-subtitle-part-chapter-sections.xml',
      sectionNumber: '101',
    });

    expect(markdown).toContain('(a) In General.— The following definitions apply in this title:');
    expect(markdown).toContain('The following definitions apply in this title:\n\n(1) The term “United States”');
    expect(markdown).toContain('(b) Personnel Generally.— The following definitions relating to military personnel apply in this title:');
    expect(markdown).toContain('The following definitions relating to military personnel apply in this title:\n\n(1) The term “officer”');
    expect(markdown).toContain('(c) Reserve Components.— The following definitions relating to the reserve components apply in this title:');
    expect(markdown).toContain('The following definitions relating to the reserve components apply in this title:\n\n(1) The term “National Guard”');
    expect(markdown).not.toContain('The following definitions apply in this title:\n(1) The term “United States”');
    expect(markdown).not.toContain('The following definitions relating to military personnel apply in this title:\n(1) The term “officer”');
    expect(markdown).not.toContain('The following definitions relating to the reserve components apply in this title:\n(1) The term “National Guard”');
  });

  it('renders multi-paragraph note content and note tables with preserved structure', async () => {
    const markdown = await renderFixtureSection({
      titleDir: 'title-05',
      relativePath: '05-part-chapter-sections.xml',
      sectionNumber: '101',
    });

    expect(markdown).toContain('Historical and Revision Notes');
    expect(markdown).toMatch(/\|\s*Derivation\s*\|\s*U\.S\. Code\s*\|\s*Revised Statutes and\s+Statutes at Large\s*\|/u);
    expect(markdown).toContain('| --- | --- | --- |');
    expect(markdown).toContain('5 U.S.C. 1');
    expect(markdown).toContain('R.S. §');
    expect(markdown).toContain('The reference in former section 1 to the application of the provisions of this title');
    expect(markdown).toContain('The statement in former section 2 that the use of the word “department” means one of the Executive departments named in former section 1 is omitted as unnecessary');
    expect(markdown).toMatch(/\|[^\n]*\|[^\n]*\|[^\n]*\|\n\nThe reference in former section 1/u);
    expect(markdown).not.toContain('DerivationU.S. CodeRevised Statutes andStatutes at Large');
  });

  it('keeps note prose, markdown tables, and following paragraphs in source order with blank-line boundaries', async () => {
    const markdown = await renderFixtureSection({
      titleDir: 'title-05',
      relativePath: '05-part-chapter-sections.xml',
      sectionNumber: '101',
    });

    const headingIndex = markdown.indexOf('## Statutory Notes');
    const tableHeaderIndex = markdown.indexOf('| Historical and Revision Notes |  |  |');
    const tableDividerIndex = markdown.indexOf('| --- | --- | --- |');
    const columnHeaderIndex = markdown.indexOf('| Derivation | U.S. Code | Revised Statutes and Statutes at Large |');
    const tableRowIndex = markdown.indexOf('|  | [5 U.S.C. 1](../title-05-government-organization-and-employees/section-00001.md). | R.S. § 158. Feb. 9, 1889, ch. 122, § 1 (38th through 54th words), 25 Stat. 659. |');
    const paragraphIndex = markdown.indexOf('The reference in former section 1 to the application of the provisions of this title');
    const laterParagraphIndex = markdown.indexOf('The statement in former section 2 that the use of the word “department” means one of the Executive departments named in former section 1 is omitted as unnecessary');

    expect(headingIndex).toBeGreaterThanOrEqual(0);
    expect(tableHeaderIndex).toBeGreaterThan(headingIndex);
    expect(tableDividerIndex).toBeGreaterThan(tableHeaderIndex);
    expect(columnHeaderIndex).toBeGreaterThan(tableDividerIndex);
    expect(tableRowIndex).toBeGreaterThan(columnHeaderIndex);
    expect(paragraphIndex).toBeGreaterThan(tableRowIndex);
    expect(laterParagraphIndex).toBeGreaterThan(paragraphIndex);
    expect(markdown).toContain('## Statutory Notes\n\n| Historical and Revision Notes |  |  |');
    expect(markdown).toContain('|  | [5 U.S.C. 2](../title-05-government-organization-and-employees/section-00002.md). | R.S. § 159. |\n\nThe reference in former section 1 to the application of the provisions of this title');
    expect(markdown).toContain('the application of those provisions is stated in the text.\n\nThe statement in former section 2 that the use of the word “department” means one of the Executive departments named in former section 1 is omitted as unnecessary');
    expect(markdown).not.toContain('the application of those provisions is stated in the text. The statement in former section 2 that the use of the word “department” means one of the Executive departments named in former section 1 is omitted as unnecessary');
  });
});

function parseFrontmatter(markdown: string) {
  return matter(markdown);
}

function readFixtureFrom(titleDir: string, relativePath: string): string {
  return readFileSync(resolve(process.cwd(), 'tests', 'fixtures', 'xml', titleDir, relativePath), 'utf8');
}

async function renderFixtureSection(xmlFixture: { titleDir: string; relativePath: string; sectionNumber: string }) {
  const { titleIr, renderSectionMarkdown } = await loadParsedFixture(xmlFixture.titleDir, xmlFixture.relativePath);
  const section = titleIr.sections.find((entry: any) => entry.sectionNumber === xmlFixture.sectionNumber);

  expect(section).toBeTruthy();
  return renderSectionMarkdown(section);
}

async function renderFixtureSectionByNeedle(xmlFixture: { titleDir: string; relativePath: string; needle: string }) {
  const { titleIr, renderSectionMarkdown } = await loadParsedFixture(xmlFixture.titleDir, xmlFixture.relativePath);
  const section = titleIr.sections.find((entry: any) => JSON.stringify(entry).includes(xmlFixture.needle));

  expect(section).toBeTruthy();
  return renderSectionMarkdown(section);
}

async function loadParsedFixture(titleDir: string, relativePath: string) {
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

  const parsed = await parseUslmToIr(readFixtureFrom(titleDir, relativePath));
  const titleIr = parsed.titleIr ?? parsed.ir ?? parsed.title ?? parsed.result;

  return { titleIr, renderSectionMarkdown };
}
