import { describe, it, expect } from 'vitest';
import matter from 'gray-matter';

function buildSection(overrides: Record<string, unknown> = {}) {
  return {
    sectionNumber: '101',
    heading: 'Definitions',
    source: 'source-credit',
    sourcePath: '/us/usc/t42/s101',
    hierarchy: {
      title: '42',
      chapter: 'IV',
    },
    content: [
      {
        kind: 'paragraph',
        text: 'Primary body text.',
      },
    ],
    notes: [
      {
        heading: 'Statutory Notes',
        body: 'A statutory note.',
      },
    ],
    crossReferences: [
      {
        label: 'See section 102',
        href: '/us/usc/t42/s102',
      },
    ],
    ...overrides,
  } as any;
}

function buildTitle(overrides: Record<string, unknown> = {}) {
  return {
    titleNumber: 42,
    heading: 'The Public Health and Welfare',
    positiveLaw: true,
    chapters: [],
    sections: [],
    sourceUrlTemplate: 'https://example.test/uscode/title-42',
    ...overrides,
  } as any;
}

function stripFrontmatter(markdown: string): string {
  return matter(markdown).content.trim();
}

describe('issue #16 unit contracts — chapter mode', () => {
  it('normalizes non-numeric chapter identifiers with the spec examples', async () => {
    const normalize = await import('../../src/domain/normalize.js');

    // NOTE: Use the existing shared helper export from src/domain/normalize.ts.
    // Do NOT add a test-only wrapper or overload to satisfy this test.
    const filenameFn =
      typeof (normalize as any).chapterOutputFilename === 'function'
        ? (normalize as any).chapterOutputFilename
        : typeof (normalize as any).chapterFileName === 'function'
          ? (normalize as any).chapterFileName
          : typeof (normalize as any).chapterFilename === 'function'
            ? (normalize as any).chapterFilename
            : undefined;

    expect(typeof filenameFn).toBe('function');
    expect(filenameFn('1')).toBe('chapter-001.md');
    expect(filenameFn('12')).toBe('chapter-012.md');
    expect(filenameFn('IV')).toBe('chapter-iv.md');
    expect(filenameFn(' Subchapter A ')).toBe('chapter-subchapter-a.md');
    expect(filenameFn('A-1 / Special')).toBe('chapter-a-1-special.md');
    expect(filenameFn('***')).toBe('chapter-unnamed.md');
  });

  it('renders chapter frontmatter with exact fallback heading and required keys', async () => {
    const markdownModule = await import('../../src/transforms/markdown.js');
    const renderChapterMarkdown = (markdownModule as any).renderChapterMarkdown;

    expect(typeof renderChapterMarkdown).toBe('function');

    const title = buildTitle({
      chapters: [{ number: '1', heading: 'General Provisions' }],
    });
    const section = buildSection({ sectionNumber: '101', hierarchy: { title: '42', chapter: 'IV' } });

    // NOTE: Use the existing production signature for renderChapterMarkdown().
    // If these args differ slightly, adapt this test to the real signature instead of creating a new overload.
    const chapterMarkdown = renderChapterMarkdown(title, 'IV', [section]);
    const parsed = matter(chapterMarkdown);

    expect(parsed.data).toMatchObject({
      title: 42,
      chapter: 'IV',
      heading: 'Chapter IV',
      section_count: 1,
      source: 'https://example.test/uscode/title-42',
    });
    expect(Object.keys(parsed.data).sort()).toEqual(['chapter', 'heading', 'section_count', 'source', 'title']);
    expect(parsed.content).toContain('# § 101. Definitions');
  });

  it('embeds byte-identical section markdown inside a chapter file body', async () => {
    const markdownModule = await import('../../src/transforms/markdown.js');
    const renderSectionMarkdown = (markdownModule as any).renderSectionMarkdown;
    const renderChapterMarkdown = (markdownModule as any).renderChapterMarkdown;

    expect(typeof renderSectionMarkdown).toBe('function');
    expect(typeof renderChapterMarkdown).toBe('function');

    const title = buildTitle({
      chapters: [{ number: 'IV', heading: 'Program Administration' }],
    });
    const sectionA = buildSection({
      sectionNumber: '101',
      heading: 'Definitions',
      hierarchy: { title: '42', chapter: 'IV' },
      content: [{ kind: 'paragraph', text: 'Definitions body.' }],
    });
    const sectionB = buildSection({
      sectionNumber: '102',
      heading: 'Authorization',
      hierarchy: { title: '42', chapter: 'IV' },
      content: [{ kind: 'paragraph', text: 'Authorization body.' }],
    });

    const standalone = stripFrontmatter(renderSectionMarkdown(sectionA));
    const chapterMarkdown = renderChapterMarkdown(title, 'IV', [sectionA, sectionB]);
    const chapterBody = stripFrontmatter(chapterMarkdown);

    expect(chapterBody).toContain(standalone);
    expect(chapterBody).toContain('# § 101. Definitions');
    expect(chapterBody).toContain('# § 102. Authorization');
    expect(chapterBody.indexOf('# § 101. Definitions')).toBeLessThan(chapterBody.indexOf('# § 102. Authorization'));
  });
});
