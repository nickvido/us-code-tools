import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TitleIR } from '../../src/domain/model.js';

const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

const resolveCachedOlrcTitleZipPath = vi.fn(async () => '/tmp/title-01.zip');
const extractXmlEntriesFromZip = vi.fn(async () => [{ xmlPath: 'usc01.xml', xml: '<xml />' }]);
const resolveTitleUrl = vi.fn((titleNumber: number) => `https://example.test/title-${titleNumber}.zip`);
const parseUslmToIr = vi.fn();
const writeTitleOutput = vi.fn();

vi.mock('../../src/sources/olrc.js', () => ({
  resolveCachedOlrcTitleZipPath,
  extractXmlEntriesFromZip,
  resolveTitleUrl,
}));

vi.mock('../../src/transforms/uslm-to-ir.js', () => ({
  parseUslmToIr,
}));

vi.mock('../../src/transforms/write-output.js', () => ({
  writeTitleOutput,
}));

beforeEach(() => {
  stdoutWrite.mockClear();
  stderrWrite.mockClear();
  resolveCachedOlrcTitleZipPath.mockClear();
  extractXmlEntriesFromZip.mockClear();
  resolveTitleUrl.mockClear();
  parseUslmToIr.mockReset();
  writeTitleOutput.mockReset();
});

describe('issue #16 CLI exit semantics', () => {
  it('keeps default section mode at exit 0 when only _title.md write fails after section output succeeds', async () => {
    parseUslmToIr.mockReturnValue({
      titleIr: buildTitleIr([{ sectionNumber: '1', heading: 'Section 1', chapter: '1' }]),
      parseErrors: [],
    });

    writeTitleOutput.mockResolvedValue({
      filesWritten: 1,
      parseErrors: [
        {
          code: 'OUTPUT_WRITE_FAILED',
          message: 'disk full while writing _title.md',
          sectionHint: '_title.md',
        },
      ],
      warnings: [],
    });

    const { main } = await import('../../src/index.js');
    const exitCode = await main(['transform', '--title', '1', '--output', '/tmp/out']);

    expect(exitCode).toBe(0);
    expect(writeTitleOutput).toHaveBeenCalledWith('/tmp/out', expect.any(Object), { groupBy: 'section' });
    expect(stderrWrite).not.toHaveBeenCalled();

    const report = getLastJsonReport();
    expect(report?.sections_found).toBe(1);
    expect(report?.files_written).toBe(1);
    expect(report?.warnings ?? []).toEqual([]);
    expect(report?.parse_errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OUTPUT_WRITE_FAILED',
          sectionHint: '_title.md',
          message: expect.stringContaining('disk full while writing _title.md'),
        }),
      ]),
    );
  });

  it('returns non-zero in chapter mode when a chapter bucket write fails', async () => {
    parseUslmToIr.mockReturnValue({
      titleIr: buildTitleIr([{ sectionNumber: '1', heading: 'Section 1', chapter: '1' }]),
      parseErrors: [],
    });

    writeTitleOutput.mockResolvedValue({
      filesWritten: 1,
      parseErrors: [
        {
          code: 'OUTPUT_WRITE_FAILED',
          message: 'permission denied writing chapter-001.md',
          sectionHint: 'chapter-001.md',
        },
      ],
      warnings: [],
    });

    const { main } = await import('../../src/index.js');
    const exitCode = await main(['transform', '--title', '1', '--output', '/tmp/out', '--group-by', 'chapter']);

    expect(exitCode).toBe(1);
    expect(writeTitleOutput).toHaveBeenCalledWith('/tmp/out', expect.any(Object), { groupBy: 'chapter' });

    const report = getLastJsonReport();
    expect(report?.sections_found).toBe(1);
    expect(report?.files_written).toBe(1);
    expect(report?.warnings ?? []).toEqual([]);
    expect(report?.parse_errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OUTPUT_WRITE_FAILED',
          sectionHint: 'chapter-001.md',
          message: expect.stringContaining('chapter-001.md'),
        }),
      ]),
    );
  });
});

function buildTitleIr(sections: Array<{ sectionNumber: string; heading: string; chapter: string }>): TitleIR {
  return {
    titleNumber: 1,
    heading: 'General Provisions',
    positiveLaw: true,
    chapters: [{ number: '1', heading: 'Chapter 1' }],
    sourceUrlTemplate: 'https://example.test/title-1',
    sections: sections.map((section) => ({
      titleNumber: 1,
      sectionNumber: section.sectionNumber,
      heading: section.heading,
      status: 'in-force',
      source: `https://example.test/section-${section.sectionNumber}`,
      hierarchy: { title: '1', chapter: section.chapter },
      content: [],
    })),
  };
}

function getLastJsonReport(): any {
  const jsonWrites = stdoutWrite.mock.calls
    .map(([chunk]) => String(chunk))
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith('{') && chunk.endsWith('}'));

  return jsonWrites.length > 0 ? JSON.parse(jsonWrites.at(-1) as string) : null;
}
