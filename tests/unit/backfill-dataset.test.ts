import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { safeImport, ensureModuleLoaded } from '../utils/module-helpers.js';

function extractDataset(moduleExports: Record<string, unknown>) {
  const candidateKeys = ['constitutionDataset', 'constitutionData', 'dataset', 'CONSTITUTION_DATASET', 'data'];

  for (const key of candidateKeys) {
    const value = moduleExports[key];
    if (isConstitutionDataset(value)) {
      return value;
    }
  }

  const def = moduleExports.default;
  if (isConstitutionDataset(def)) {
    return def;
  }

  if (typeof moduleExports === 'object' && Object.values(moduleExports).some((value) => isConstitutionDataset(value))) {
    return Object.values(moduleExports).find((value) => isConstitutionDataset(value));
  }

  throw new Error('Could not locate constitution dataset export');
}

function isConstitutionDataset(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    Boolean(candidate.constitution) &&
    typeof (candidate.constitution as Record<string, unknown>) === 'object' &&
    Array.isArray((candidate.constitution as Record<string, unknown>).articles) &&
    Array.isArray(candidate.amendments)
  );
}

function isDateLike(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isOfficialUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\/constitution\.congress\.gov\//.test(value);
}

describe('Constitution dataset', () => {
  it('contains complete static records for 7 articles and 27 amendments', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'backfill', 'constitution', 'dataset.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);

    const dataset = extractDataset(mod);
    const constitution = dataset.constitution as Record<string, unknown>;
    const articles = constitution.articles as Array<Record<string, unknown>>;
    const amendments = dataset.amendments as Array<Record<string, unknown>>;

    expect(articles).toHaveLength(7);
    expect(amendments).toHaveLength(27);

    const articleNumbers = articles.map((article) => article.number);
    expect(articleNumbers).toEqual([1, 2, 3, 4, 5, 6, 7]);

    const amendmentNumbers = amendments.map((amendment) => amendment.number);
    expect(amendmentNumbers).toEqual(Array.from({ length: 27 }, (_, idx) => idx + 1));

    expect(constitution.signed).toBe('1787-09-17');
    expect(constitution.ratified).toBe('1788-06-21');
    expect(constitution.ratifiedDetail).toContain('9th state');
    expect(constitution.source).toBe('https://constitution.congress.gov/constitution/');

    const sampleFields = ['type', 'number', 'heading', 'proposed', 'ratified', 'proposing_body', 'source', 'authorName', 'authorEmail'];
    for (const article of articles) {
      for (const field of sampleFields) {
        expect(article).toHaveProperty(field);
      }
      expect(article.type).toBe('article');
      expect(isDateLike(article.proposed)).toBe(true);
      expect(isDateLike(article.ratified)).toBe(true);
      expect(isOfficialUrl(article.source)).toBe(true);
      expect(typeof article.heading).toBe('string');
      expect((article as { markdownBody?: string }).markdownBody).toBeTruthy();
      expect(typeof article.authorEmail).toBe('string');
      expect(article.heading.length).toBeGreaterThan(3);
    }

    for (const amendment of amendments) {
      for (const field of sampleFields) {
        expect(amendment).toHaveProperty(field);
      }
      expect(amendment.type).toBe('amendment');
      expect(isDateLike(amendment.proposed)).toBe(true);
      expect(isDateLike(amendment.ratified)).toBe(true);
      expect(isOfficialUrl(amendment.source)).toBe(true);
      expect(typeof amendment.heading).toBe('string');
      expect((amendment as { markdownBody?: string }).markdownBody).toBeTruthy();
      expect(typeof amendment.authorName).toBe('string');
      expect(amendment.authorName).toContain('Congress');
      expect(typeof amendment.authorEmail).toBe('string');
    }
  });

  it('enforces deterministic author identities for constitutional authors', async () => {
    const modulePath = resolve(process.cwd(), 'src/backfill/constitution/dataset.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);

    const dataset = extractDataset(mod);

    const constitution = dataset.constitution as Record<string, unknown>;
    expect(constitution.authorName).toBe('Constitutional Convention');
    expect(constitution.authorEmail).toBe('convention@constitution.gov');

    const amendments = dataset.amendments as Array<Record<string, unknown>>;
    const byNumber = new Map(amendments.map((entry) => [entry.number as number, entry]));

    expect(byNumber.get(1)?.authorName).toBe('1st Congress');
    expect(byNumber.get(1)?.authorEmail).toBe('congress-1@congress.gov');
    expect(byNumber.get(11)?.authorName).toBe('3rd Congress');
    expect(byNumber.get(11)?.authorEmail).toBe('congress-3@congress.gov');
    expect(byNumber.get(14)?.authorName).toBe('39th Congress');
    expect(byNumber.get(27)?.authorName).toBe('1st Congress');
  });
});
