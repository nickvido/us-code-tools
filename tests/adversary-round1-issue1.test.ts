import { describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  symlinkSync,
  lstatSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pickCallable, safeImport, ensureModuleLoaded } from './utils/module-helpers';

function readFixture(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), 'tests', 'fixtures', 'xml', 'title-01', relativePath), 'utf8');
}

function normalizeParseResult(result: unknown): {
  titleIr?: unknown;
  parseErrors?: unknown[];
} {
  const anyResult = result as {
    titleIr?: unknown;
    ir?: unknown;
    title?: unknown;
    result?: unknown;
    parseErrors?: unknown[];
    errors?: unknown[];
  };

  return {
    titleIr: anyResult.titleIr ?? anyResult.ir ?? anyResult.title ?? anyResult.result,
    parseErrors: anyResult.parseErrors ?? anyResult.errors ?? [],
  };
}

function runTransform(outputDir: string, fixtureZip: string) {
  const distEntry = resolve(process.cwd(), 'dist', 'index.js');
  return spawnSync(process.execPath, [distEntry, 'transform', '--title', '1', '--output', outputDir], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      US_CODE_TOOLS_TITLE_01_FIXTURE_ZIP: fixtureZip,
    },
  });
}

describe('adversary round 1 regressions for #1', () => {
  it('collects <section> elements nested under <chapter>', async () => {
    const parseModule = await safeImport(resolve(process.cwd(), 'src/transforms/uslm-to-ir.ts'));
    ensureModuleLoaded(resolve(process.cwd(), 'src/transforms/uslm-to-ir.ts'), parseModule);
    const parseXml = pickCallable(parseModule, [
      'parseUslmToIr',
      'parseUslmToIR',
      'parseUslmXml',
      'parseUslmXmlToIr',
      'parseXmlToIr',
      'parseTitleXml',
      'parseTitleXmlToIr',
      'transformUslmXml',
    ]);

    const result = normalizeParseResult(await parseXml(readFixture('03-chapter-section.xml')));
    const titleIr: any = result.titleIr;

    expect(titleIr).toBeTypeOf('object');
    expect(Array.isArray(titleIr.sections)).toBe(true);
    expect(titleIr.sections).toHaveLength(1);
    expect(titleIr.sections[0].sectionNumber).toBe('999');
    expect(titleIr.sections[0].heading).toBe('Chapter-contained section');
    expect(Array.isArray(result.parseErrors)).toBe(true);
    expect(result.parseErrors).toHaveLength(0);

    const chapter = titleIr.chapters?.find((entry: any) => entry.number === 'I');
    expect(chapter).toBeTruthy();
  });

  it('refuses to write through symlinked intermediate output directories', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'us-code-tools-it-symlink-'));
    const escapedOutputDir = resolve(outputDir, 'outside-destination');
    const symlinkRoot = resolve(outputDir, 'uscode');
    const fixtureZip = resolve(process.cwd(), 'tests', 'fixtures', 'title-01', 'title-01.zip');

    try {
      mkdirSync(escapedOutputDir, { recursive: true });
      writeFileSync(resolve(escapedOutputDir, 'preexisting.txt'), 'outside-sentinel');

      symlinkSync(escapedOutputDir, symlinkRoot, 'dir');
      const linkStat = lstatSync(symlinkRoot);
      expect(linkStat.isSymbolicLink()).toBe(true);

      const result = runTransform(outputDir, fixtureZip);
      const diagnostic = `${result.stderr}\n${result.stdout}`.toLowerCase();

      expect(result.status).not.toBe(0);
      expect(
        diagnostic.includes('symlink') ||
          diagnostic.includes('unsafe') ||
          diagnostic.includes('symbolic') ||
          diagnostic.includes('traversal') ||
          diagnostic.includes('outside output'),
      ).toBe(true);

      const titleOutput = resolve(outputDir, 'uscode', 'title-01');
      expect(existsSync(titleOutput)).toBe(false);
      const outsideFiles = readdirSync(escapedOutputDir).filter((name) => name !== 'preexisting.txt');
      expect(outsideFiles).toEqual([]);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
