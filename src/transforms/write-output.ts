import { join, resolve } from 'node:path';
import type { ParseError, SectionIR, TitleIR, TransformGroupBy, TransformWarning } from '../domain/model.js';
import { chapterOutputFilename, compareChapterIdentifiers, sectionFileSafeId, sortSections, titleDirectoryName } from '../domain/normalize.js';
import { atomicWriteFile, assertSafeOutputPath } from '../utils/fs.js';
import { renderChapterMarkdown, renderSectionMarkdown, renderTitleMarkdown, renderUncategorizedMarkdown } from './markdown.js';

export function titleFileDirectoryPath(titleNumber: number, titleHeading?: string | null): string {
  return join('uscode', titleDirectoryName({ titleNumber, heading: titleHeading }));
}

export function sectionFilePath(titleNumber: number, sectionId: string, titleHeading?: string | null): string {
  return join(titleFileDirectoryPath(titleNumber, titleHeading), `section-${sectionFileSafeId(sectionId)}.md`);
}

export async function writeTitleOutput(
  outputRoot: string,
  titleIr: TitleIR,
  options: { groupBy?: TransformGroupBy } = {},
): Promise<{ filesWritten: number; parseErrors: ParseError[]; warnings: TransformWarning[] }> {
  const parseErrors: ParseError[] = [];
  const warnings: TransformWarning[] = [];
  let filesWritten = 0;
  const sortedSections = sortSections(titleIr.sections);
  const groupBy = options.groupBy ?? 'section';
  const titleDirectoryPath = resolve(outputRoot, titleFileDirectoryPath(titleIr.titleNumber, titleIr.heading));

  if (groupBy === 'chapter') {
    const writeResult = await writeChapterOutput(outputRoot, titleIr, sortedSections, titleDirectoryPath);
    filesWritten += writeResult.filesWritten;
    parseErrors.push(...writeResult.parseErrors);
    warnings.push(...writeResult.warnings);
  } else {
    for (const section of sortedSections) {
      try {
        filesWritten += await writeSection(outputRoot, section, titleIr.heading);
      } catch (error) {
        parseErrors.push({
          code: 'OUTPUT_WRITE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to write section output',
          sectionHint: section.sectionNumber,
        });
      }
    }
  }

  const titlePath = resolve(titleDirectoryPath, '_title.md');

  try {
    await assertSafeOutputPath(outputRoot, titlePath);
    await atomicWriteFile(titlePath, renderTitleMarkdown({ ...titleIr, sections: sortedSections }));
    filesWritten += 1;
  } catch (error) {
    parseErrors.push({
      code: 'OUTPUT_WRITE_FAILED',
      message: error instanceof Error ? error.message : 'Failed to write title metadata output',
      sectionHint: '_title.md',
    });
  }

  return { filesWritten, parseErrors, warnings };
}

async function writeChapterOutput(
  outputRoot: string,
  titleIr: TitleIR,
  sortedSections: SectionIR[],
  titleDirectoryPath: string,
): Promise<{ filesWritten: number; parseErrors: ParseError[]; warnings: TransformWarning[] }> {
  const parseErrors: ParseError[] = [];
  const warnings: TransformWarning[] = [];
  let filesWritten = 0;
  const chapterBuckets = new Map<string, SectionIR[]>();
  const uncategorizedSections: SectionIR[] = [];

  for (const section of sortedSections) {
    const chapter = section.hierarchy?.chapter;
    if (!chapter) {
      uncategorizedSections.push(section);
      warnings.push({
        code: 'UNCATEGORIZED_SECTION',
        message: `Section ${section.sectionNumber} has no hierarchy.chapter and was written to _uncategorized.md`,
        sectionHint: section.sectionNumber,
      });
      continue;
    }

    const bucket = chapterBuckets.get(chapter) ?? [];
    bucket.push(section);
    chapterBuckets.set(chapter, bucket);
  }

  const orderedChapters = [...chapterBuckets.keys()].sort(compareChapterIdentifiers);
  const chapterFilenames = new Map<string, string>();

  for (const chapter of orderedChapters) {
    const outputFilename = chapterOutputFilename(chapter);
    const existingChapter = chapterFilenames.get(outputFilename);
    if (existingChapter !== undefined && existingChapter !== chapter) {
      parseErrors.push({
        code: 'OUTPUT_WRITE_FAILED',
        message: `Distinct chapter buckets normalize to the same output filename: ${existingChapter} and ${chapter} -> ${outputFilename}`,
        sectionHint: `chapter:${chapter}`,
      });
      return { filesWritten, parseErrors, warnings };
    }

    chapterFilenames.set(outputFilename, chapter);
  }

  for (const chapter of orderedChapters) {
    const sections = chapterBuckets.get(chapter) ?? [];
    const outputFilename = chapterOutputFilename(chapter);
    const absolutePath = resolve(titleDirectoryPath, outputFilename);

    try {
      await assertSafeOutputPath(outputRoot, absolutePath);
      await atomicWriteFile(absolutePath, renderChapterMarkdown(titleIr, chapter, sections));
      filesWritten += 1;
    } catch (error) {
      parseErrors.push({
        code: 'OUTPUT_WRITE_FAILED',
        message: error instanceof Error ? error.message : `Failed to write chapter output for ${chapter}`,
        sectionHint: `chapter:${chapter}`,
      });
    }
  }

  if (uncategorizedSections.length > 0) {
    const absolutePath = resolve(titleDirectoryPath, '_uncategorized.md');
    try {
      await assertSafeOutputPath(outputRoot, absolutePath);
      await atomicWriteFile(absolutePath, renderUncategorizedMarkdown(titleIr, uncategorizedSections));
      filesWritten += 1;
    } catch (error) {
      parseErrors.push({
        code: 'OUTPUT_WRITE_FAILED',
        message: error instanceof Error ? error.message : 'Failed to write uncategorized output',
        sectionHint: '_uncategorized.md',
      });
    }
  }

  return { filesWritten, parseErrors, warnings };
}

async function writeSection(outputRoot: string, section: SectionIR, titleHeading?: string | null): Promise<number> {
  const absolutePath = resolve(outputRoot, sectionFilePath(section.titleNumber, section.sectionNumber, titleHeading));
  await assertSafeOutputPath(outputRoot, absolutePath);
  await atomicWriteFile(absolutePath, renderSectionMarkdown(section));
  return 1;
}
