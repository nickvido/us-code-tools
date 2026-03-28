import { describe, it, expect } from 'vitest';
import { pickCallable, safeImport, ensureModuleLoaded } from '../../utils/module-helpers';
import { resolve } from 'node:path';
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
});

function parseFrontmatter(markdown: string) {
  return matter(markdown);
}
