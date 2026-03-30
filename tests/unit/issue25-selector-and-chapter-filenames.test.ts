import { describe, expect, it } from 'vitest';

describe('issue #25 unit contracts — selector normalization and descriptive chapter filenames', () => {
  it('builds descriptive chapter filenames from chapter identifiers and headings using the issue #20 slug contract', async () => {
    const normalize = await import('../../src/domain/normalize.js');

    // NOTE: Use the existing shared production export from src/domain/normalize.ts.
    // Do NOT add a test-only wrapper or overload to satisfy this test.
    const descriptiveFilenameFn =
      typeof (normalize as any).descriptiveChapterOutputFilename === 'function'
        ? (normalize as any).descriptiveChapterOutputFilename
        : typeof (normalize as any).chapterOutputFilename === 'function'
          ? (normalize as any).chapterOutputFilename
          : typeof (normalize as any).chapterFileName === 'function'
            ? (normalize as any).chapterFileName
            : typeof (normalize as any).chapterFilename === 'function'
              ? (normalize as any).chapterFilename
              : undefined;

    expect(typeof descriptiveFilenameFn).toBe('function');
    expect(descriptiveFilenameFn('047', 'Fraud and False Statements')).toBe('chapter-047-fraud-and-false-statements.md');
    expect(descriptiveFilenameFn('IV', 'Program Administration')).toBe('chapter-iv-program-administration.md');
    expect(descriptiveFilenameFn('12', '"Emergency" Powers')).toBe('chapter-012-emergency-powers.md');
    expect(descriptiveFilenameFn('A / B', 'General Provisions & Definitions')).toBe('chapter-a-b-general-provisions-definitions.md');
  });

  it('omits the heading suffix when the heading is missing or normalizes empty', async () => {
    const normalize = await import('../../src/domain/normalize.js');

    const descriptiveFilenameFn =
      typeof (normalize as any).descriptiveChapterOutputFilename === 'function'
        ? (normalize as any).descriptiveChapterOutputFilename
        : typeof (normalize as any).chapterOutputFilename === 'function'
          ? (normalize as any).chapterOutputFilename
          : undefined;

    expect(typeof descriptiveFilenameFn).toBe('function');
    expect(descriptiveFilenameFn('12', undefined)).toBe('chapter-012.md');
    expect(descriptiveFilenameFn('12', '  ')).toBe('chapter-012.md');
    expect(descriptiveFilenameFn('12', '""')).toBe('chapter-012.md');
    expect(descriptiveFilenameFn('12', "''")).toBe('chapter-012.md');
  });

  it('normalizes supported title selectors to one canonical internal representation with stable report and output metadata', async () => {
    const normalize = await import('../../src/domain/normalize.js');

    // NOTE: Use the existing selector normalization export from src/domain/normalize.ts.
    // If the function name differs, adapt this test to the real production export instead of adding a new wrapper.
    const normalizeTitleSelector =
      typeof (normalize as any).normalizeTitleSelector === 'function'
        ? (normalize as any).normalizeTitleSelector
        : typeof (normalize as any).normalizeTransformTitleSelector === 'function'
          ? (normalize as any).normalizeTransformTitleSelector
          : undefined;

    expect(typeof normalizeTitleSelector).toBe('function');

    const numeric = normalizeTitleSelector('5');
    expect(numeric).toMatchObject({
      reportId: '5',
      cacheKey: '05',
      outputDirectoryName: 'title-05',
      isReservedEmptyCandidate: false,
    });

    const appendixUpper = normalizeTitleSelector('5A');
    const appendixLower = normalizeTitleSelector('5a');
    expect(appendixUpper).toEqual(appendixLower);
    expect(appendixUpper).toMatchObject({
      reportId: '5A',
      cacheKey: '05A',
      outputDirectoryName: 'title-05a-appendix',
      isReservedEmptyCandidate: false,
    });

    const reserved = normalizeTitleSelector('53');
    expect(reserved).toMatchObject({
      reportId: '53',
      cacheKey: '53',
      outputDirectoryName: 'title-53',
      isReservedEmptyCandidate: true,
    });
  });

  it('rejects unsupported appendix-like selectors', async () => {
    const normalize = await import('../../src/domain/normalize.js');

    const normalizeTitleSelector =
      typeof (normalize as any).normalizeTitleSelector === 'function'
        ? (normalize as any).normalizeTitleSelector
        : typeof (normalize as any).normalizeTransformTitleSelector === 'function'
          ? (normalize as any).normalizeTransformTitleSelector
          : undefined;

    expect(typeof normalizeTitleSelector).toBe('function');
    expect(() => normalizeTitleSelector('0A')).toThrow(/5A|11A|18A|28A|50A/i);
    expect(() => normalizeTitleSelector('6A')).toThrow(/5A|11A|18A|28A|50A/i);
    expect(() => normalizeTitleSelector('5AA')).toThrow(/5A|11A|18A|28A|50A/i);
    expect(() => normalizeTitleSelector('appendix')).toThrow(/5A|11A|18A|28A|50A/i);
  });
});
