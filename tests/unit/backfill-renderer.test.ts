import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import matter from 'gray-matter';
import { safeImport, ensureModuleLoaded } from '../utils/module-helpers.js';

function extractRenderer(mod: Record<string, unknown>) {
  const callableNames = [
    'renderConstitutionProvision',
    'renderProvision',
    'renderBackfillProvision',
    'renderConstitutionRecord',
    'renderMarkdownFromRecord',
    'renderProvisionMarkdown',
    'renderToMarkdown',
  ];

  for (const name of callableNames) {
    if (typeof mod[name] === 'function') {
      return mod[name] as (record: unknown) => string;
    }
  }

  if (typeof mod.default === 'function') {
    return mod.default as (record: unknown) => string;
  }

  if (mod.default && typeof mod.default === 'object') {
    const nested = mod.default as Record<string, unknown>;
    for (const name of callableNames) {
      if (typeof nested[name] === 'function') {
        return nested[name] as (record: unknown) => string;
      }
    }
    if (typeof nested.render === 'function') {
      return nested.render as (record: unknown) => string;
    }
  }

  if (typeof (mod as Record<string, unknown>).render === 'function') {
    return (mod as Record<string, unknown>).render as (record: unknown) => string;
  }

  throw new Error('Could not find renderer function in backfill renderer module');
}

function sampleArticleRecord() {
  return {
    type: 'article',
    number: 1,
    heading: 'Legislative Powers',
    proposed: '1787-09-17',
    ratified: '1788-06-21',
    proposing_body: 'Constitutional Convention',
    source: 'https://constitution.congress.gov/browse/article-1/',
    markdownBody: '## Article I\n\nSection 1. All legislative Powers herein granted shall be vested in a Congress of the United States.',
    content: [
      {
        kind: 'section',
        number: '1',
        heading: 'The Legislature',
        text: 'All legislative Powers herein granted shall be vested in a Congress of the United States.',
      },
    ],
  };
}

function sampleAmendmentRecord() {
  return {
    type: 'amendment',
    number: 1,
    heading: 'Freedom of Religion, Speech, Assembly, and Petition',
    proposed: '1789-09-25',
    ratified: '1791-12-15',
    proposing_body: '1st Congress',
    source: 'https://constitution.congress.gov/browse/amendment-1/',
    markdownBody: 'Congress shall make no law respecting an establishment of religion, or prohibiting the free exercise thereof...',
    content: [
      {
        type: 'clause',
        label: '(a)',
        text: 'Congress shall make no law respecting an establishment of religion, or prohibiting the free exercise thereof...',
      },
    ],
  };
}

describe('Constitution markdown rendering', () => {
  it('renders valid YAML frontmatter and stable markdown for articles', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'backfill', 'renderer.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);
    const renderConstitutionMarkdown = extractRenderer(mod);

    const articleMarkdown = renderConstitutionMarkdown(sampleArticleRecord());
    const parsed = matter(articleMarkdown);

    expect(parsed.data).toMatchObject({
      type: 'article',
      number: 1,
      heading: 'Legislative Powers',
      proposed: '1787-09-17',
      ratified: '1788-06-21',
      proposing_body: 'Constitutional Convention',
      source: 'https://constitution.congress.gov/browse/article-1/',
    });
    expect(articleMarkdown).toContain('Section 1. All legislative Powers herein granted');
    expect(renderConstitutionMarkdown(sampleArticleRecord())).toBe(articleMarkdown);
    expect(articleMarkdown.trim().startsWith('---')).toBe(true);
  });

  it('renders valid frontmatter for amendments and preserves amendment text', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'backfill', 'renderer.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);
    const renderConstitutionMarkdown = extractRenderer(mod);

    const amendmentMarkdown = renderConstitutionMarkdown(sampleAmendmentRecord());
    const parsed = matter(amendmentMarkdown);

    expect(parsed.data).toMatchObject({
      type: 'amendment',
      number: 1,
      heading: 'Freedom of Religion, Speech, Assembly, and Petition',
      proposed: '1789-09-25',
      ratified: '1791-12-15',
      proposing_body: '1st Congress',
      source: 'https://constitution.congress.gov/browse/amendment-1/',
    });
    expect(parsed.content).toContain('Congress shall make no law');
  });

  it('produces snapshot coverage for Article I markdown', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'backfill', 'renderer.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);
    const renderConstitutionMarkdown = extractRenderer(mod);

    const articleMarkdown = renderConstitutionMarkdown(sampleArticleRecord());
    expect(articleMarkdown).toMatchSnapshot();
  });

  it('produces snapshot coverage for Amendment I markdown', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'backfill', 'renderer.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);
    const renderConstitutionMarkdown = extractRenderer(mod);

    const amendmentMarkdown = renderConstitutionMarkdown(sampleAmendmentRecord());
    expect(amendmentMarkdown).toMatchSnapshot();
  });
});
