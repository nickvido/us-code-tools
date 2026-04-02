import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';

import { titleDirectoryName } from '../src/domain/normalize.js';
import { renderChapterMarkdown, renderSectionMarkdown, renderTitleMarkdown } from '../src/transforms/markdown.js';
import { parseUslmToIr } from '../src/transforms/uslm-to-ir.js';

describe('issue #29 — markdown chapter rendering correctness', () => {
  it('renders embedded chapter sections and notes with bumped heading levels', () => {
    const title = {
      titleNumber: 42,
      heading: 'The Public Health and Welfare',
      positiveLaw: true,
      chapters: [{ number: '6A', heading: 'Public Health Service' }],
      sections: [],
      sourceUrlTemplate: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title42',
    };

    const section = {
      titleNumber: 42,
      sectionNumber: '411',
      heading: 'Definitions',
      source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title42-section411',
      hierarchy: { chapter: '6A' },
      content: [
        {
          type: 'text',
          text: 'Introductory text.',
        },
      ],
      statutoryNotes: [
        {
          heading: 'Amendments',
          text: '2010—Pub. L. 111–148 amended this section.',
        },
      ],
      editorialNotes: [{ heading: '', text: 'Prior provisions were omitted.' }],
    };

    const markdown = renderChapterMarkdown(title as never, '6A' as never, [section] as never);

    expect(markdown).toContain('## § 411. Definitions');
    expect(markdown).not.toContain('\n# § 411. Definitions');
    expect(markdown).toContain('### Statutory Notes');
    expect(markdown).toContain('#### Amendments');
    expect(markdown).toContain('### Notes');
  });

  it('writes a concrete title source URL in chapter frontmatter without unresolved placeholders', () => {
    const title = {
      titleNumber: 42,
      heading: 'The Public Health and Welfare',
      positiveLaw: true,
      chapters: [{ number: '6A', heading: 'Public Health Service' }],
      sections: [],
      sourceUrlTemplate: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title42',
    };

    const section = {
      titleNumber: 42,
      sectionNumber: '411',
      heading: 'Definitions',
      source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title42-section411',
      hierarchy: { chapter: '6A' },
      content: [],
      statutoryNotes: [],
      editorialNotes: [],
    };

    const markdown = renderChapterMarkdown(title as never, '6A' as never, [section] as never);
    const parsed = matter(markdown);

    expect(parsed.data.source).toBe('https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title42');
    expect(String(parsed.data.source)).not.toContain('{section}');
    expect(String(parsed.data.source)).not.toMatch(/[{}]/);
  });

  it('keeps standalone section markdown at H1 while chapter output moves embedded sections to H2', () => {
    const section = {
      titleNumber: 42,
      sectionNumber: '411',
      heading: 'Definitions',
      source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title42-section411',
      content: [],
      statutoryNotes: [],
      editorialNotes: [],
    };

    const standalone = renderSectionMarkdown(section as never);

    expect(standalone).toContain('# § 411. Definitions');
    expect(standalone).not.toContain('## § 411. Definitions');
  });

  it('keeps standalone subsection labels as inline body paragraphs while nested descendants render as bold paragraph blocks', () => {
    const section = {
      titleNumber: 26,
      sectionNumber: '2',
      heading: 'Definitions and special rules',
      source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title26-section2',
      content: [
        {
          type: 'subsection',
          label: '(b)',
          heading: 'Definition of head of household',
          children: [
            {
              type: 'paragraph',
              label: '(1)',
              heading: 'In general',
              text: 'An individual is a head of household if the statutory conditions are met.',
              children: [],
            },
          ],
        },
      ],
      statutoryNotes: [],
      editorialNotes: [],
    };

    const standalone = renderSectionMarkdown(section as never);

    expect(standalone).toContain('# § 2. Definitions and special rules');
    expect(standalone).toContain('**(b) Definition of head of household**');
    expect(standalone).toContain('**(1) In general** An individual is a head of household if the statutory conditions are met.');
    expect(standalone).not.toContain('## (b) Definition of head of household');
    expect(standalone).not.toContain('\n## (1) In general');
  });

  it('renders nested labeled content as multiple indented lines in source order', () => {
    const title = {
      titleNumber: 25,
      heading: 'Indians',
      positiveLaw: false,
      chapters: [{ number: '43', heading: 'Indian Health Care Improvement' }],
      sections: [],
      sourceUrlTemplate: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title25',
    };

    const section = {
      titleNumber: 25,
      sectionNumber: '1603',
      heading: 'Definitions',
      source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title25-section1603',
      hierarchy: { chapter: '43' },
      content: [
        { type: 'text', text: 'In this chapter:' },
        {
          type: 'paragraph',
          label: '(1)',
          heading: 'Area office',
          text: 'The term "Area office" means a regional office.',
        },
        {
          type: 'paragraph',
          label: '(2)',
          heading: 'Behavioral health',
          children: [
            {
              type: 'subparagraph',
              label: '(A)',
              heading: 'In general',
              text: 'The term "behavioral health" means mental wellness.',
            },
            {
              type: 'subparagraph',
              label: '(B)',
              heading: 'Inclusions',
              text: 'The term "behavioral health" includes prevention.',
            },
          ],
        },
      ],
      statutoryNotes: [],
      editorialNotes: [],
    };

    const markdown = renderChapterMarkdown(title as never, '43' as never, [section] as never);

    expect(markdown).toContain('In this chapter:');
    expect(markdown).toContain('(1) **Area office** — The term "Area office" means a regional office.');
    expect(markdown).toContain('(2) **Behavioral health**');
    expect(markdown).toContain('  (A) *In general* — The term "behavioral health" means mental wellness.');
    expect(markdown).toContain('  (B) *Inclusions* — The term "behavioral health" includes prevention.');
    expect(markdown).toMatch(/In this chapter:\n\n\(1\)/);
  });

  it('omits the duplicate per-section list from title index markdown while keeping chapter navigation', () => {
    const title = {
      titleNumber: 51,
      heading: 'National and Commercial Space Programs',
      positiveLaw: true,
      chapters: [
        { number: '201', heading: 'National Aeronautics and Space Program' },
        { number: '203', heading: 'Land Remote Sensing Policy' },
      ],
      sections: [
        { sectionNumber: '1', heading: 'Short title' },
        { sectionNumber: '2', heading: 'Definitions' },
        { sectionNumber: 'uncodified-1', heading: 'Artifact' },
      ],
      sourceUrlTemplate: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title51',
    };

    const markdown = renderTitleMarkdown(title as never);

    expect(markdown).toContain('# Title 51');
    expect(markdown).toContain('National and Commercial Space Programs');
    expect(markdown).toContain('## Chapters');
    expect(markdown).toContain('National Aeronautics and Space Program');
    expect(markdown).not.toContain('## Sections');
    expect(markdown).not.toContain('§ 1.');
    expect(markdown).not.toContain('§ 2.');
    expect(markdown).not.toContain('§ uncodified-1.');
  });

  it('uses titleDirectoryName-compatible cross-title chapter links and never emits section markdown hrefs in chapter mode', () => {
    const title3Directory = titleDirectoryName({ titleNumber: 3, heading: 'The President' });

    const title = {
      titleNumber: 5,
      heading: 'Government Organization and Employees',
      positiveLaw: true,
      chapters: [{ number: '4', heading: 'Officers and Employees' }],
      sections: [],
      sourceUrlTemplate: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5',
    };

    const section = {
      titleNumber: 5,
      sectionNumber: '4101',
      heading: 'Training',
      source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section4101',
      hierarchy: { chapter: '4' },
      content: [
        {
          type: 'text',
          text: '[section 411 of title 3](./section-00411.md)',
        },
      ],
      statutoryNotes: [],
      editorialNotes: [],
    };

    const sectionTargetMap = new Map([
      ['3:411', `../${title3Directory}/chapter-004-officers-and-employees.md#section-411`],
    ]);

    // NOTE: Use the EXISTING renderChapterMarkdown signature. Do not add a test-only overload.
    // If section target maps are passed via a different existing parameter shape, adapt this call to that signature.
    const markdown = renderChapterMarkdown(
      title as never,
      '4' as never,
      [section] as never,
      { sectionTargetsByRef: sectionTargetMap } as never,
    );

    expect(markdown).toContain(`../${title3Directory}/chapter-004-officers-and-employees.md#section-411`);
    expect(markdown).not.toContain('section-00411.md');
  });

  it('falls back to the exact canonical uscode.house.gov section URL when a chapter target cannot be mapped', () => {
    const title = {
      titleNumber: 5,
      heading: 'Government Organization and Employees',
      positiveLaw: true,
      chapters: [{ number: '4', heading: 'Officers and Employees' }],
      sections: [],
      sourceUrlTemplate: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5',
    };

    const section = {
      titleNumber: 5,
      sectionNumber: '4101',
      heading: 'Training',
      source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section4101',
      hierarchy: { chapter: '4' },
      content: [
        {
          type: 'text',
          text: '[section 411 of title 3](./section-00411.md)',
        },
      ],
      statutoryNotes: [],
      editorialNotes: [],
    };

    const markdown = renderChapterMarkdown(
      title as never,
      '4' as never,
      [section] as never,
      { sectionTargetsByRef: new Map() } as never,
    );

    expect(markdown).toContain('https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title3-section411');
    expect(markdown).not.toContain('section-00411.md');
  });

  it('rewrites real parse-output cross-title section links to chapter anchors during chapter rendering', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<uslm>
  <title>
    <num>Title 5</num>
    <heading>Government Organization and Employees</heading>
    <chapter>
      <num>4</num>
      <heading>Officers and Employees</heading>
    </chapter>
    <section>
      <num>§ 4101</num>
      <heading>Training</heading>
      <chapter>
        <num>4</num>
      </chapter>
      <paragraph>
        <xref href="/us/usc/t3/s411">section 411 of title 3</xref>
      </paragraph>
    </section>
  </title>
</uslm>`;

    const parsed = parseUslmToIr(xml, 'title5.xml');
    const title3Directory = titleDirectoryName({ titleNumber: 3, heading: 'The President' });
    const markdown = renderChapterMarkdown(
      parsed.titleIr as never,
      '4' as never,
      parsed.titleIr.sections as never,
      {
        sectionTargetsByRef: new Map([
          ['3:411', `../${title3Directory}/chapter-004-officers-and-employees.md#section-411`],
        ]),
      } as never,
    );

    expect(markdown).toContain('[section 411 of title 3]');
    expect(markdown).toContain(`../${title3Directory}/chapter-004-officers-and-employees.md#section-411`);
    expect(markdown).not.toContain(`../${title3Directory}/section-00411.md`);
    expect(markdown).not.toContain('./section-00411.md');
    expect(markdown).not.toMatch(/\]\([^)]*section-\d+\.md\)/);
  });

  it('does not rewrite a cross-title reference to the current title chapter target when only the section number matches locally', () => {
    const title = {
      titleNumber: 5,
      heading: 'Government Organization and Employees',
      positiveLaw: true,
      chapters: [{ number: '4', heading: 'Officers and Employees' }],
      sections: [],
      sourceUrlTemplate: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5',
    };

    const section = {
      titleNumber: 5,
      sectionNumber: '4101',
      heading: 'Training',
      source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section4101',
      hierarchy: { chapter: '4' },
      content: [
        {
          type: 'text',
          text: '[section 411 of title 3](../title-03-the-president/section-00411.md)',
        },
      ],
      statutoryNotes: [],
      editorialNotes: [],
    };

    const markdown = renderChapterMarkdown(
      title as never,
      '4' as never,
      [section] as never,
      {
        // NOTE: Use the EXISTING renderChapterMarkdown signature. Do not add a test-only overload.
        // This map intentionally contains only the current title's local section-411 target.
        sectionTargetsByRef: new Map([
          ['5:411', './chapter-004-officers-and-employees.md#section-411'],
        ]),
      } as never,
    );

    expect(markdown).toContain('[section 411 of title 3]');
    expect(markdown).toContain('https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title3-section411');
    expect(markdown).not.toContain('./chapter-004-officers-and-employees.md#section-411');
    expect(markdown).not.toContain('../title-03-the-president/section-00411.md');
    expect(markdown).not.toMatch(/\]\([^)]*section-\d+\.md\)/);
  });

  it('rewrites slash-bearing section identifiers to mapped chapter anchors instead of falling back to dashed canonical URLs', () => {
    const title = {
      titleNumber: 5,
      heading: 'Government Organization and Employees',
      positiveLaw: true,
      chapters: [{ number: '4', heading: 'Officers and Employees' }],
      sections: [],
      sourceUrlTemplate: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5',
    };

    const section = {
      titleNumber: 5,
      sectionNumber: '4101',
      heading: 'Training',
      source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section4101',
      hierarchy: { chapter: '4' },
      content: [
        {
          type: 'text',
          text: '[section 125/d of title 5](./section-00125-d.md)',
        },
      ],
      statutoryNotes: [],
      editorialNotes: [],
    };

    const markdown = renderChapterMarkdown(
      title as never,
      '4' as never,
      [section] as never,
      {
        // NOTE: Use the EXISTING renderChapterMarkdown signature. Do not add a test-only overload.
        sectionTargetsByRef: new Map([
          ['5:125/d', './chapter-004-officers-and-employees.md#section-125-d'],
        ]),
      } as never,
    );

    expect(markdown).toContain('[section 125/d of title 5]');
    expect(markdown).toContain('./chapter-004-officers-and-employees.md#section-125-d');
    expect(markdown).not.toContain('https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section125-d');
    expect(markdown).not.toContain('./section-00125-d.md');
  });

  it('falls back to the exact canonical slash-bearing section URL when a mapped chapter target is unavailable', () => {
    const title = {
      titleNumber: 5,
      heading: 'Government Organization and Employees',
      positiveLaw: true,
      chapters: [{ number: '4', heading: 'Officers and Employees' }],
      sections: [],
      sourceUrlTemplate: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5',
    };

    const section = {
      titleNumber: 5,
      sectionNumber: '4101',
      heading: 'Training',
      source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section4101',
      hierarchy: { chapter: '4' },
      content: [
        {
          type: 'text',
          text: '[section 125/d of title 5](./section-00125-d.md)',
        },
      ],
      statutoryNotes: [],
      editorialNotes: [],
    };

    const markdown = renderChapterMarkdown(
      title as never,
      '4' as never,
      [section] as never,
      { sectionTargetsByRef: new Map() } as never,
    );

    expect(markdown).toContain('[section 125/d of title 5]');
    expect(markdown).toContain('https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section125/d');
    expect(markdown).not.toContain('https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section125-d');
    expect(markdown).not.toContain('./section-00125-d.md');
  });

  it('rewrites real parse-output slash-bearing markdown links to mapped chapter anchors even when the link text omits the title number', () => {
    const title = {
      titleNumber: 5,
      heading: 'Government Organization and Employees',
      positiveLaw: true,
      chapters: [{ number: '4', heading: 'Officers and Employees' }],
      sections: [],
      sourceUrlTemplate: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5',
    };

    const section = {
      titleNumber: 5,
      sectionNumber: '4101',
      heading: 'Training',
      source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section4101',
      hierarchy: { chapter: '4' },
      content: [
        {
          type: 'text',
          text: '[section 125/d](../title-05-government-organization-and-employees/section-00125d.md)',
        },
      ],
      statutoryNotes: [],
      editorialNotes: [],
    };

    const markdown = renderChapterMarkdown(
      title as never,
      '4' as never,
      [section] as never,
      {
        sectionTargetsByRef: new Map([
          ['5:125/d', './chapter-004-officers-and-employees.md#section-125-d'],
        ]),
      } as never,
    );

    expect(markdown).toContain('[section 125/d]');
    expect(markdown).toContain('./chapter-004-officers-and-employees.md#section-125-d');
    expect(markdown).not.toContain('../title-05-government-organization-and-employees/section-00125d.md');
    expect(markdown).not.toContain('https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section125d');
  });

  it('falls back from real parse-output slash-bearing markdown links to the exact canonical slash-bearing URL when no chapter target exists', () => {
    const title = {
      titleNumber: 5,
      heading: 'Government Organization and Employees',
      positiveLaw: true,
      chapters: [{ number: '4', heading: 'Officers and Employees' }],
      sections: [],
      sourceUrlTemplate: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5',
    };

    const section = {
      titleNumber: 5,
      sectionNumber: '4101',
      heading: 'Training',
      source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section4101',
      hierarchy: { chapter: '4' },
      content: [
        {
          type: 'text',
          text: '[section 125/d](../title-05-government-organization-and-employees/section-00125d.md)',
        },
      ],
      statutoryNotes: [],
      editorialNotes: [],
    };

    const markdown = renderChapterMarkdown(
      title as never,
      '4' as never,
      [section] as never,
      { sectionTargetsByRef: new Map() } as never,
    );

    expect(markdown).toContain('[section 125/d]');
    expect(markdown).toContain('https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section125/d');
    expect(markdown).not.toContain('https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section125d');
    expect(markdown).not.toContain('../title-05-government-organization-and-employees/section-00125d.md');
  });

  it('renders deterministic embedded section anchors for numeric, alphanumeric, hyphenated, and slash-bearing identifiers', () => {
    const title = {
      titleNumber: 5,
      heading: 'Government Organization and Employees',
      positiveLaw: true,
      chapters: [{ number: '4', heading: 'Officers and Employees' }],
      sections: [],
      sourceUrlTemplate: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5',
    };

    const sections = [
      {
        titleNumber: 5,
        sectionNumber: '411',
        heading: 'Numeric',
        source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section411',
        hierarchy: { chapter: '4' },
        content: [],
        statutoryNotes: [],
        editorialNotes: [],
      },
      {
        titleNumber: 5,
        sectionNumber: '125d',
        heading: 'Alphanumeric',
        source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section125d',
        hierarchy: { chapter: '4' },
        content: [],
        statutoryNotes: [],
        editorialNotes: [],
      },
      {
        titleNumber: 5,
        sectionNumber: '301-1',
        heading: 'Hyphenated',
        source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section301-1',
        hierarchy: { chapter: '4' },
        content: [],
        statutoryNotes: [],
        editorialNotes: [],
      },
      {
        titleNumber: 5,
        sectionNumber: '125/d',
        heading: 'Slash bearing',
        source: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section125/d',
        hierarchy: { chapter: '4' },
        content: [],
        statutoryNotes: [],
        editorialNotes: [],
      },
    ];

    const markdown = renderChapterMarkdown(title as never, '4' as never, sections as never);

    expect(markdown).toContain('<a id="section-411"></a>');
    expect(markdown).toContain('<a id="section-125d"></a>');
    expect(markdown).toContain('<a id="section-301-1"></a>');
    expect(markdown).toContain('<a id="section-125-d"></a>');
  });

  it('preserves section headings across equivalent ordered and non-ordered parse paths and returns empty string when heading is absent', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<uslm>
  <title>
    <num>Title 51</num>
    <heading>National and Commercial Space Programs</heading>
    <section>
      <num>§ 106</num>
      <heading>Definitions</heading>
      <paragraph>For purposes of this chapter.</paragraph>
    </section>
    <section>
      <num>§ 202</num>
      <heading>Administrative authority</heading>
      <subsection>
        <num>(a)</num>
        <heading>General authority</heading>
        <paragraph>The Administrator may act.</paragraph>
      </subsection>
    </section>
    <section>
      <num>§ 303</num>
      <paragraph>Body text without a heading.</paragraph>
    </section>
  </title>
</uslm>`;

    const parsed = parseUslmToIr(xml, 'title51.xml');
    const headingsBySection = new Map(parsed.titleIr.sections.map((section) => [section.sectionNumber, section.heading]));

    expect(headingsBySection.get('106')).toBe('Definitions');
    expect(headingsBySection.get('202')).toBe('Administrative authority');
    expect(headingsBySection.get('303')).toBe('');
  });

  it('preserves ordered xref-only paragraph content so chapter rendering can rewrite the parsed markdown link', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<uslm>
  <title>
    <num>Title 5</num>
    <heading>Government Organization and Employees</heading>
    <chapter>
      <num>4</num>
      <heading>Officers and Employees</heading>
    </chapter>
    <section>
      <num>§ 4101</num>
      <heading>Training</heading>
      <chapter>
        <num>4</num>
      </chapter>
      <paragraph>
        <xref href="/us/usc/t3/s411">section 411 of title 3</xref>
      </paragraph>
    </section>
  </title>
</uslm>`;

    const parsed = parseUslmToIr(xml, 'title5-xref-only.xml');
    const title3Directory = titleDirectoryName({ titleNumber: 3, heading: 'The President' });
    const markdown = renderChapterMarkdown(
      parsed.titleIr as never,
      '4' as never,
      parsed.titleIr.sections as never,
      {
        sectionTargetsByRef: new Map([
          ['3:411', `../${title3Directory}/chapter-004-officers-and-employees.md#section-411`],
        ]),
      } as never,
    );

    expect(markdown).toContain('[section 411 of title 3]');
    expect(markdown).toContain(`../${title3Directory}/chapter-004-officers-and-employees.md#section-411`);
    expect(markdown).not.toContain('../title-03-the-president/section-00411.md');
    expect(markdown).not.toContain('./section-00411.md');
    expect(markdown).not.toMatch(/\n## § 4101\. Training[^]*section 411 of title 3[^]*\n\n###/);
  });

  it('recovers slash-bearing canonical refs from ordered parse-output links and falls back to the exact canonical slash URL when unmapped', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<uslm>
  <title>
    <num>Title 5</num>
    <heading>Government Organization and Employees</heading>
    <chapter>
      <num>4</num>
      <heading>Officers and Employees</heading>
    </chapter>
    <section>
      <num>§ 4101</num>
      <heading>Training</heading>
      <chapter>
        <num>4</num>
      </chapter>
      <paragraph>
        <xref href="/us/usc/t5/s125/d">section 125/d</xref>
      </paragraph>
    </section>
  </title>
</uslm>`;

    const parsed = parseUslmToIr(xml, 'title5-slash-xref.xml');
    const mappedMarkdown = renderChapterMarkdown(
      parsed.titleIr as never,
      '4' as never,
      parsed.titleIr.sections as never,
      {
        sectionTargetsByRef: new Map([
          ['5:125/d', './chapter-004-officers-and-employees.md#section-125-d'],
        ]),
      } as never,
    );
    const fallbackMarkdown = renderChapterMarkdown(
      parsed.titleIr as never,
      '4' as never,
      parsed.titleIr.sections as never,
      { sectionTargetsByRef: new Map() } as never,
    );

    expect(mappedMarkdown).toContain('[section 125/d]');
    expect(mappedMarkdown).toContain('./chapter-004-officers-and-employees.md#section-125-d');
    expect(mappedMarkdown).not.toContain('./section-00125d.md');
    expect(mappedMarkdown).not.toContain('https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section125d');

    expect(fallbackMarkdown).toContain('[section 125/d]');
    expect(fallbackMarkdown).toContain('https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section125/d');
    expect(fallbackMarkdown).not.toContain('https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section125d');
    expect(fallbackMarkdown).not.toContain('./section-00125d.md');
  });

});
