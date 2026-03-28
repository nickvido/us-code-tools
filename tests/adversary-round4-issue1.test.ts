import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TitleIR } from '../src/domain/model.js';

const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

const getTitleZipPath = vi.fn(async () => '/tmp/title-01.zip');
const extractXmlEntriesFromZip = vi.fn(async () => [
  { xmlPath: 'usc01.xml', xml: '<xml />' },
  { xmlPath: 'nested/usc01-extra.xml', xml: '<xml />' },
]);
const resolveTitleUrl = vi.fn((titleNumber: number) => `https://example.test/title-${titleNumber}.zip`);
const parseUslmToIr = vi.fn();
const writeTitleOutput = vi.fn();

vi.mock('../src/sources/olrc.js', () => ({
  getTitleZipPath,
  extractXmlEntriesFromZip,
  resolveTitleUrl,
}));

vi.mock('../src/transforms/uslm-to-ir.js', () => ({
  parseUslmToIr,
}));

vi.mock('../src/transforms/write-output.js', () => ({
  writeTitleOutput,
}));

beforeEach(() => {
  stdoutWrite.mockClear();
  stderrWrite.mockClear();
  getTitleZipPath.mockClear();
  extractXmlEntriesFromZip.mockClear();
  resolveTitleUrl.mockClear();
  parseUslmToIr.mockReset();
  writeTitleOutput.mockReset();
});

describe('adversary round 4 regressions for #1', () => {
  it('reports duplicate section numbers across XML entries and skips the duplicate section during merge', async () => {
    parseUslmToIr
      .mockReturnValueOnce({
        titleIr: buildTitleIr([{ sectionNumber: '12', heading: 'Original section 12' }]),
        parseErrors: [],
      })
      .mockReturnValueOnce({
        titleIr: buildTitleIr([{ sectionNumber: '12', heading: 'Duplicate section 12' }]),
        parseErrors: [],
      });

    writeTitleOutput.mockImplementation(async (_outputRoot: string, titleIr: TitleIR) => {
      expect(titleIr.sections).toHaveLength(1);
      expect(titleIr.sections[0]?.heading).toBe('Original section 12');
      return { filesWritten: 2, parseErrors: [] };
    });

    const { main } = await import('../src/index.js');
    const exitCode = await main(['transform', '--title', '1', '--output', '/tmp/out']);

    // Architecture requires deterministic failure when duplicate section numbers appear across XML files.
    expect(exitCode).toBe(1);
    expect(writeTitleOutput).toHaveBeenCalledTimes(1);

    const report = getLastJsonReport();
    expect(report?.sections_found).toBe(1);
    expect(report?.files_written).toBe(2);
    expect(report?.parse_errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'INVALID_XML',
          xmlPath: 'nested/usc01-extra.xml',
          sectionHint: '12',
          message: expect.stringContaining("Duplicate section number '12'"),
        }),
      ]),
    );
  });

  it('preserves structured reporting when title metadata writing fails after section files succeed', async () => {
    parseUslmToIr.mockReturnValue({
      titleIr: buildTitleIr([{ sectionNumber: '1', heading: 'Section 1' }]),
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
    });

    const { main } = await import('../src/index.js');
    const exitCode = await main(['transform', '--title', '1', '--output', '/tmp/out']);

    // Architecture contract: section output success is authoritative for exit code.
    // Keep fail-semantics in the report, but do not fail the whole run solely because
    // the title metadata file failed to write after sections were emitted.
    expect(exitCode).toBe(0);
    expect(stderrWrite).not.toHaveBeenCalled();

    const report = getLastJsonReport();
    expect(report?.sections_found).toBe(1);
    expect(report?.files_written).toBe(1);
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
});

function buildTitleIr(sections: Array<{ sectionNumber: string; heading: string }>): TitleIR {
  return {
    titleNumber: 1,
    heading: 'General Provisions',
    positiveLaw: true,
    chapters: [],
    sourceUrlTemplate: 'https://example.test/title-1',
    sections: sections.map((section) => ({
      titleNumber: 1,
      sectionNumber: section.sectionNumber,
      heading: section.heading,
      status: 'in-force',
      source: `https://example.test/section-${section.sectionNumber}`,
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
