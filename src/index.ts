#!/usr/bin/env node
import { mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ParseError, TitleIR, TransformGroupBy } from './domain/model.js';
import { allTransformTitleTargets, normalizeTitleSelector } from './domain/normalize.js';
import type { NormalizedTitleTarget } from './domain/normalize.js';

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [command, ...args] = argv;

  if (command === 'transform') {
    return runTransformCommand(args);
  }

  if (command === 'backfill') {
    return runBackfillCommand(args);
  }

  if (command === 'fetch') {
    const { runFetchCommand } = await import('./commands/fetch.js');
    return runFetchCommand(args);
  }

  if (command === 'milestones') {
    const { runMilestonesCommand } = await import('./commands/milestones.js');
    return runMilestonesCommand(args);
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
    const { runConstitutionBackfill } = await import('./backfill/orchestrator.js');
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

  const outputValidationError = await validateOutputDirectory(parsed.value.outputDir);
  if (outputValidationError) {
    transformUsage(outputValidationError);
    return 1;
  }

  try {
    await mkdir(parsed.value.outputDir, { recursive: true });

    if (parsed.value.scope === 'all') {
      const targets = [] as Array<Record<string, unknown>>;
      let shouldFail = false;

      for (const normalizedTarget of allTransformTitleTargets()) {
        const result = await transformSingleTitle(normalizedTarget, parsed.value.outputDir, parsed.value.groupBy);
        targets.push(result.report);
        shouldFail = shouldFail || (result.exitCode !== 0 && !normalizedTarget.isReservedEmptyCandidate);
      }

      process.stdout.write(`${JSON.stringify({ requested_scope: 'all', targets })}\n`);
      return shouldFail ? 1 : 0;
    }

    const result = await transformSingleTitle(parsed.value.target, parsed.value.outputDir, parsed.value.groupBy);
    process.stdout.write(`${JSON.stringify(result.report)}\n`);
    return result.exitCode;
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : 'Unknown failure'}\n`);
    return 1;
  }
}

async function transformSingleTitle(normalizedTarget: NormalizedTitleTarget, outputDir: string, groupBy: TransformGroupBy): Promise<{ report: Record<string, unknown>; exitCode: number }> {
  const { extractXmlEntriesFromZip, resolveCachedOlrcTitleZipPath, resolveTitleUrl } = await import('./sources/olrc.js');
  const { parseUslmToIr } = await import('./transforms/uslm-to-ir.js');
  const { writeTitleOutput } = await import('./transforms/write-output.js');

  const parseErrors: ParseError[] = [];

  try {
    const zipPath = await resolveCachedOlrcTitleZipPath(normalizedTarget);
    const xmlEntries = await extractXmlEntriesFromZip(zipPath);
    if (xmlEntries.length === 0) {
      throw new Error(`No writable sections found for title ${normalizedTarget.reportId}`);
    }

    let mergedTitle: TitleIR | null = null;
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
        if (section.isCodifiedSection === false) {
          continue;
        }

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
      throw new Error(`No writable sections found for title ${normalizedTarget.reportId}`);
    }

    const writeOptions = normalizedTarget.selector.kind === 'appendix'
      ? { groupBy, normalizedTarget }
      : { groupBy };
    const writeResult = await writeTitleOutput(outputDir, mergedTitle, writeOptions);
    const report = {
      title: normalizedTarget.reportId,
      source_url: resolveTitleUrl(normalizedTarget),
      sections_found: mergedTitle.sections.length,
      files_written: writeResult.filesWritten,
      parse_errors: [...parseErrors, ...writeResult.parseErrors],
      warnings: writeResult.warnings,
    };

    const hasOutputWriteFailure = writeResult.parseErrors.some((parseError) => parseError.code === 'OUTPUT_WRITE_FAILED');
    if (hasDuplicateSectionCollision || (hasOutputWriteFailure && groupBy === 'chapter')) {
      return { report, exitCode: 1 };
    }

    if (groupBy === 'section') {
      return { report, exitCode: writeResult.filesWritten > 0 ? 0 : 1 };
    }

    return { report, exitCode: writeResult.filesWritten > 1 ? 0 : 1 };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown failure';
    const report = {
      title: normalizedTarget.reportId,
      source_url: (await import('./sources/olrc.js')).resolveTitleUrl(normalizedTarget),
      sections_found: 0,
      files_written: 0,
      parse_errors: [{ code: 'INVALID_XML', message }],
      warnings: [],
    };
    return { report, exitCode: 1 };
  }
}

function parseTransformArgs(args: string[]):
  | { ok: true; value: { scope: 'single'; target: NormalizedTitleTarget; outputDir: string; groupBy: TransformGroupBy } }
  | { ok: true; value: { scope: 'all'; outputDir: string; groupBy: TransformGroupBy } }
  | { ok: false; error: string } {
  let title: string | null = null;
  let output: string | null = null;
  let groupBy: TransformGroupBy = 'section';
  let sawGroupBy = false;
  let sawAll = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === '--title') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        return { ok: false, error: 'Missing required --title flag' };
      }
      if (title !== null) {
        return { ok: false, error: 'Duplicate --title flag' };
      }
      if (sawAll) {
        return { ok: false, error: '--title and --all are mutually exclusive' };
      }
      title = value;
      index += 1;
      continue;
    }

    if (token === '--all') {
      if (sawAll) {
        return { ok: false, error: 'Duplicate --all flag' };
      }
      if (title !== null) {
        return { ok: false, error: '--title and --all are mutually exclusive' };
      }
      sawAll = true;
      continue;
    }

    if (token === '--output') {
      const value = args[index + 1];
      if (!value) {
        return { ok: false, error: 'Missing required --output flag' };
      }
      if (output !== null) {
        return { ok: false, error: 'Duplicate --output flag' };
      }
      output = value;
      index += 1;
      continue;
    }

    if (token === '--group-by') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        return { ok: false, error: 'Missing required value for --group-by (expected: chapter)' };
      }
      if (sawGroupBy) {
        return { ok: false, error: 'Duplicate --group-by flag' };
      }
      if (value !== 'chapter') {
        return { ok: false, error: `Unsupported --group-by '${value}'; expected 'chapter'` };
      }
      groupBy = 'chapter';
      sawGroupBy = true;
      index += 1;
      continue;
    }

    if (token.startsWith('--')) {
      return { ok: false, error: `Unknown flag '${token}'` };
    }

    return { ok: false, error: `Unknown argument '${token}'` };
  }

  if (output === null) {
    return { ok: false, error: 'Missing required --output flag' };
  }

  if (!sawAll && title === null) {
    return { ok: false, error: 'Missing required --title flag' };
  }

  if (sawAll) {
    return {
      ok: true,
      value: {
        scope: 'all',
        outputDir: resolve(output),
        groupBy,
      },
    };
  }

  try {
    return {
      ok: true,
      value: {
        scope: 'single',
        target: normalizeTitleSelector(title ?? ''),
        outputDir: resolve(output),
        groupBy,
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid --title selector' };
  }
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
  process.stderr.write(`Usage: transform (--title <selector> | --all) --output <dir> [--group-by chapter]\nUsage: backfill --phase <name> --target <dir>\nUsage: fetch (--status | --all | --source=<name>) [--congress=<n>] [--force]\nUsage: milestones plan --target <repo> --metadata <file>\nUsage: milestones apply --target <repo> --metadata <file>\nUsage: milestones release --target <repo> --metadata <file>\nError: ${error}\n`);
}

function transformUsage(error: string): void {
  process.stderr.write(`Usage: transform (--title <selector> | --all) --output <dir> [--group-by chapter]\nLegacy usage: transform --title <number> --output <dir> [--group-by chapter]\nAccepted appendix selectors: 5A, 11A, 18A, 28A, 50A\nError: ${error}\n`);
}

function backfillUsage(error: string): void {
  process.stderr.write(`Usage: backfill --phase <name> --target <dir>\nError: ${error}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
