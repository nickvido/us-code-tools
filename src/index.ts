#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getTitleZipPath, extractXmlEntriesFromZip, resolveTitleUrl } from './sources/olrc.js';
import type { ParseError, TitleIR } from './domain/model.js';
import { parseUslmToIr } from './transforms/uslm-to-ir.js';
import { writeTitleOutput } from './transforms/write-output.js';

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [command, ...args] = argv;

  if (command !== 'transform') {
    usage('Unknown command');
    return 1;
  }

  const parsed = parseArgs(args);
  if (!parsed.ok) {
    usage(parsed.error);
    return 1;
  }

  const { titleNumber, outputDir } = parsed.value;

  try {
    const zipPath = await getTitleZipPath(titleNumber, resolve(process.cwd(), '.cache'));
    const xmlEntries = await extractXmlEntriesFromZip(zipPath);
    if (xmlEntries.length === 0) {
      throw new Error(`failed to download title ${titleNumber} from ${resolveTitleUrl(titleNumber)} (no XML entries)`);
    }

    let mergedTitle: TitleIR | null = null;
    const parseErrors: ParseError[] = [];

    for (const entry of xmlEntries) {
      const result = parseUslmToIr(entry.xml, entry.xmlPath);
      parseErrors.push(...result.parseErrors);
      if (!mergedTitle) {
        mergedTitle = result.titleIr;
      } else {
        mergedTitle.sections.push(...result.titleIr.sections);
        for (const chapter of result.titleIr.chapters) {
          if (!mergedTitle.chapters.some((existing) => existing.number === chapter.number && existing.heading === chapter.heading)) {
            mergedTitle.chapters.push(chapter);
          }
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
    return writeResult.filesWritten > 1 ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : 'Unknown failure'}\n`);
    return 1;
  }
}

function parseArgs(args: string[]): { ok: true; value: { titleNumber: number; outputDir: string } } | { ok: false; error: string } {
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

function usage(error: string): void {
  process.stderr.write(`Usage: transform --title <number> --output <dir>\nError: ${error}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
