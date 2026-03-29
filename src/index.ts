#!/usr/bin/env node
import { mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { extractXmlEntriesFromZip, resolveCachedOlrcTitleZipPath, resolveTitleUrl } from './sources/olrc.js';
import type { ParseError, TitleIR } from './domain/model.js';
import { parseUslmToIr } from './transforms/uslm-to-ir.js';
import { writeTitleOutput } from './transforms/write-output.js';
import { runConstitutionBackfill } from './backfill/orchestrator.js';
import { runFetchCommand } from './commands/fetch.js';

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [command, ...args] = argv;

  if (command === 'transform') {
    return runTransformCommand(args);
  }

  if (command === 'backfill') {
    return runBackfillCommand(args);
  }

  if (command === 'fetch') {
    return runFetchCommand(args);
  }

  usage('Unknown command');
  return 1;
}

async function runBackfillCommand(args: string[]): Promise<number> {
  const parsed = parseBackfillArgs(args);
  if (!parsed.ok) {
    backfillUsage(parsed.error);
    return 1;
  }

  try {
    const summary = await runConstitutionBackfill(parsed.value.target);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : 'Unknown failure'}\n`);
    return 1;
  }
}

function parseBackfillArgs(args: string[]): { ok: true; value: { phase: 'constitution'; target: string } } | { ok: false; error: string } {
  let phase: string | null = null;
  let target: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === '--phase') {
      const value = args[index + 1];
      if (!value) {
        return { ok: false, error: 'Missing required --phase flag' };
      }

      if (phase !== null) {
        return { ok: false, error: 'Duplicate --phase flag' };
      }

      phase = value;
      index += 1;
      continue;
    }

    if (token === '--target') {
      const value = args[index + 1];
      if (!value) {
        return { ok: false, error: 'Missing required --target flag' };
      }

      if (target !== null) {
        return { ok: false, error: 'Duplicate --target flag' };
      }

      target = value;
      index += 1;
      continue;
    }

    if (token.startsWith('--')) {
      return { ok: false, error: `Unknown flag '${token}'` };
    }

    return { ok: false, error: `Unknown argument '${token}'` };
  }

  if (phase === null) {
    return { ok: false, error: 'Missing required --phase flag' };
  }

  if (target === null) {
    return { ok: false, error: 'Missing required --target flag' };
  }

  if (phase !== 'constitution') {
    return { ok: false, error: `Unsupported --phase '${phase}'; expected 'constitution'` };
  }

  return {
    ok: true,
    value: {
      phase: 'constitution',
      target: resolve(target),
    },
  };
}

async function runTransformCommand(args: string[]): Promise<number> {
  const parsed = parseTransformArgs(args);
  if (!parsed.ok) {
    transformUsage(parsed.error);
    return 1;
  }

  const { titleNumber, outputDir } = parsed.value;

  const outputValidationError = await validateOutputDirectory(outputDir);
  if (outputValidationError) {
    transformUsage(outputValidationError);
    return 1;
  }

  try {
    const zipPath = await resolveCachedOlrcTitleZipPath(titleNumber);
    const xmlEntries = await extractXmlEntriesFromZip(zipPath);
    if (xmlEntries.length === 0) {
      throw new Error(`failed to download title ${titleNumber} from ${resolveTitleUrl(titleNumber)} (no XML entries)`);
    }

    let mergedTitle: TitleIR | null = null;
    const parseErrors: ParseError[] = [];
    const seenSectionNumbers = new Set<string>();
    let hasDuplicateSectionCollision = false;

    for (const entry of xmlEntries) {
      const result = parseUslmToIr(entry.xml, entry.xmlPath);
      parseErrors.push(...result.parseErrors);
      if (!mergedTitle) {
        mergedTitle = {
          ...result.titleIr,
          chapters: [...result.titleIr.chapters],
          sections: [],
        };
      }

      for (const section of result.titleIr.sections) {
        if (seenSectionNumbers.has(section.sectionNumber)) {
          hasDuplicateSectionCollision = true;
          parseErrors.push({
            code: 'INVALID_XML',
            message: `Duplicate section number '${section.sectionNumber}' encountered across XML files`,
            xmlPath: entry.xmlPath,
            sectionHint: section.sectionNumber,
          });
          continue;
        }

        seenSectionNumbers.add(section.sectionNumber);
        mergedTitle.sections.push(section);
      }

      for (const chapter of result.titleIr.chapters) {
        if (!mergedTitle.chapters.some((existing) => existing.number === chapter.number && existing.heading === chapter.heading)) {
          mergedTitle.chapters.push(chapter);
        }
      }
    }

    if (!mergedTitle || mergedTitle.sections.length === 0) {
      throw new Error(`No writable sections found for title ${titleNumber}`);
    }

    await mkdir(outputDir, { recursive: true });
    const writeResult = await writeTitleOutput(outputDir, mergedTitle);
    const report = {
      title: titleNumber,
      source_url: resolveTitleUrl(titleNumber),
      sections_found: mergedTitle.sections.length,
      files_written: writeResult.filesWritten,
      parse_errors: [...parseErrors, ...writeResult.parseErrors],
    };

    process.stdout.write(`${JSON.stringify(report)}\n`);

    if (hasDuplicateSectionCollision) {
      return 1;
    }

    const titleMetadataWriteFailed = writeResult.parseErrors.some(
      (parseError) => parseError.code === 'OUTPUT_WRITE_FAILED' && parseError.sectionHint === '_title.md',
    );
    const sectionFilesWritten = writeResult.filesWritten - (titleMetadataWriteFailed ? 0 : 1);

    return sectionFilesWritten > 0 ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : 'Unknown failure'}\n`);
    return 1;
  }
}

function parseTransformArgs(args: string[]): { ok: true; value: { titleNumber: number; outputDir: string } } | { ok: false; error: string } {
  const titleIndex = args.indexOf('--title');
  const outputIndex = args.indexOf('--output');

  if (titleIndex === -1 || !args[titleIndex + 1]) {
    return { ok: false, error: 'Missing required --title flag' };
  }

  if (outputIndex === -1 || !args[outputIndex + 1]) {
    return { ok: false, error: 'Missing required --output flag' };
  }

  const titleNumber = Number(args[titleIndex + 1]);
  if (!Number.isInteger(titleNumber) || titleNumber < 1 || titleNumber > 54) {
    return { ok: false, error: '--title must be an integer between 1 and 54 (1 through 54)' };
  }

  return {
    ok: true,
    value: {
      titleNumber,
      outputDir: resolve(args[outputIndex + 1]),
    },
  };
}

async function validateOutputDirectory(outputDir: string): Promise<string | null> {
  try {
    const outputStat = await stat(outputDir);
    if (!outputStat.isDirectory()) {
      return '--output must point to a directory or a path that does not exist yet';
    }

    return null;
  } catch (error) {
    const normalizedError = error as NodeJS.ErrnoException;
    if (normalizedError.code === 'ENOENT') {
      return null;
    }

    return `failed to inspect --output path: ${normalizedError.message}`;
  }
}

function usage(error: string): void {
  process.stderr.write(`Usage: transform --title <number> --output <dir>\nUsage: backfill --phase <name> --target <dir>\nUsage: fetch (--status | --all | --source=<name>) [--congress=<n>] [--force]\nError: ${error}\n`);
}

function transformUsage(error: string): void {
  process.stderr.write(`Usage: transform --title <number> --output <dir>\nError: ${error}\n`);
}

function backfillUsage(error: string): void {
  process.stderr.write(`Usage: backfill --phase <name> --target <dir>\nError: ${error}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
