import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { pickCallable, safeImport, ensureModuleLoaded } from '../../utils/module-helpers';

function pickPathRenderer(moduleExports: Record<string, unknown>): (titleNumber: number, sectionId: string, titleHeading?: string | null) => string {
  return pickCallable(moduleExports, [
    'sectionFilePath',
    'buildSectionFilePath',
    'getSectionFilePath',
    'getSectionFileName',
    'sectionFileName',
    'deriveSectionFileName',
    'deriveSectionPath',
  ]) as (titleNumber: number, sectionId: string, titleHeading?: string | null) => string;
}

describe('write-output path derivation', () => {
  it('normalizes section identifiers with slash and zero-pads the numeric stem', async () => {
    const mod = await safeImport(resolve(process.cwd(), 'src', 'transforms', 'write-output.ts'));
    ensureModuleLoaded(resolve(process.cwd(), 'src', 'transforms', 'write-output.ts'), mod);
    const deriveSectionPath = pickPathRenderer(mod);

    // NOTE: Use the existing production signature for the path helper. Do NOT create a test-only overload.
    const path = deriveSectionPath(1, '2/3', 'General Provisions');
    expect(path).toContain('section-00002-3.md');
    expect(path).not.toContain('2_3');
    expect(path).not.toContain('2\\3');
  });

  it('preserves alphanumeric section suffixes while zero-padding numeric stems in filenames', async () => {
    const mod = await safeImport(resolve(process.cwd(), 'src', 'transforms', 'write-output.ts'));
    ensureModuleLoaded(resolve(process.cwd(), 'src', 'transforms', 'write-output.ts'), mod);
    const deriveSectionPath = pickPathRenderer(mod);

    const path = deriveSectionPath(1, '36B', 'General Provisions');
    expect(path).toContain('section-00036B.md');
  });

  it('uses slugged title directories when a heading is available and falls back to title-NN when it is not', async () => {
    const mod = await safeImport(resolve(process.cwd(), 'src', 'transforms', 'write-output.ts'));
    ensureModuleLoaded(resolve(process.cwd(), 'src', 'transforms', 'write-output.ts'), mod);
    const deriveSectionPath = pickPathRenderer(mod);

    // NOTE: Use the existing production signature for the path helper. Do NOT create a test-only overload.
    const path = deriveSectionPath(1, '1', 'General Provisions');
    expect(path).toMatch(/title-01-general-provisions[\\/]section-00001\.md$/);

    const path9 = deriveSectionPath(9, '1', 'The Public Debt');
    expect(path9).toContain('title-09-the-public-debt');

    const fallbackPath = deriveSectionPath(4, '1', ` ' `);
    expect(fallbackPath).toMatch(/title-04[\\/]section-00001\.md$/);
    expect(fallbackPath).not.toContain('title-04-');
  });
});
