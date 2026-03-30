import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { ensureModuleLoaded, pickCallable, safeImport } from '../../utils/module-helpers';

function pickHeadingSlugifier(moduleExports: Record<string, unknown>): (heading?: string | null) => string | null {
  return pickCallable(moduleExports, [
    'slugifyTitleHeading',
    'titleHeadingSlug',
    'normalizeTitleHeadingSlug',
    'slugifyHeading',
  ]) as (heading?: string | null) => string | null;
}

function pickTitleDirectoryName(moduleExports: Record<string, unknown>): (input: { titleNumber: number; heading?: string | null }) => string {
  return pickCallable(moduleExports, [
    'titleDirectoryName',
    'getTitleDirectoryName',
    'deriveTitleDirectoryName',
    'titleOutputDirectoryName',
  ]) as (input: { titleNumber: number; heading?: string | null }) => string;
}

describe('title directory normalization contract', () => {
  it('slugifies canonical title headings into lowercase hyphenated filesystem-safe segments', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'domain', 'normalize.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);
    const slugifyTitleHeading = pickHeadingSlugifier(mod);

    expect(slugifyTitleHeading('General Provisions')).toBe('general-provisions');
    expect(slugifyTitleHeading('Armed Forces')).toBe('armed-forces');
    expect(slugifyTitleHeading('Crimes and Criminal Procedure')).toBe('crimes-and-criminal-procedure');
    expect(slugifyTitleHeading('The Public Health and Welfare')).toBe('the-public-health-and-welfare');
  });

  it('strips straight and curly quotes instead of converting them into doubled separators', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'domain', 'normalize.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);
    const slugifyTitleHeading = pickHeadingSlugifier(mod);

    const slug = slugifyTitleHeading('“Patriotic Societies and Observances”');
    const apostropheSlug = slugifyTitleHeading(`Veterans' Benefits`);

    expect(slug).toBe('patriotic-societies-and-observances');
    expect(slug).not.toContain('"');
    expect(slug).not.toContain('“');
    expect(slug).not.toContain('”');
    expect(slug).not.toContain('--');
    expect(apostropheSlug).toBe('veterans-benefits');
    expect(apostropheSlug).not.toContain("'");
  });

  it('falls back to null slug for punctuation-only or empty headings', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'domain', 'normalize.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);
    const slugifyTitleHeading = pickHeadingSlugifier(mod);

    expect(slugifyTitleHeading(undefined)).toBeNull();
    expect(slugifyTitleHeading('')).toBeNull();
    expect(slugifyTitleHeading(`  '  `)).toBeNull();
    expect(slugifyTitleHeading(' --- /// “ ” ')).toBeNull();
  });

  it('derives title-NN-slug directories and preserves title-NN fallback without trailing hyphen', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'domain', 'normalize.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);
    const titleDirectoryName = pickTitleDirectoryName(mod);

    expect(titleDirectoryName({ titleNumber: 1, heading: 'General Provisions' })).toBe('title-01-general-provisions');
    expect(titleDirectoryName({ titleNumber: 10, heading: 'Armed Forces' })).toBe('title-10-armed-forces');
    expect(titleDirectoryName({ titleNumber: 18, heading: 'Crimes and Criminal Procedure' })).toBe('title-18-crimes-and-criminal-procedure');
    expect(titleDirectoryName({ titleNumber: 42, heading: 'The Public Health and Welfare' })).toBe('title-42-the-public-health-and-welfare');
    expect(titleDirectoryName({ titleNumber: 4, heading: '' })).toBe('title-04');
    expect(titleDirectoryName({ titleNumber: 4, heading: ` ' ` })).toBe('title-04');
    expect(titleDirectoryName({ titleNumber: 4 })).toBe('title-04');
    expect(titleDirectoryName({ titleNumber: 4, heading: ` ' ` })).not.toBe('title-04-');
  });
});
