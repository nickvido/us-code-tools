import { resolve } from 'node:path';
import type { ParseError, SectionIR, TitleIR } from '../domain/model.js';
import { padTitleNumber, sectionFileSafeId } from '../domain/normalize.js';
import { atomicWriteFile, assertSafeOutputPath } from '../utils/fs.js';
import { renderSectionMarkdown, renderTitleMarkdown } from './markdown.js';

export function sectionFilePath(titleNumber: number, sectionId: string): string {
  return resolve('uscode', `title-${padTitleNumber(titleNumber)}`, `section-${sectionFileSafeId(sectionId)}.md`);
}

export async function writeTitleOutput(outputRoot: string, titleIr: TitleIR): Promise<{ filesWritten: number; parseErrors: ParseError[] }> {
  const parseErrors: ParseError[] = [];
  let filesWritten = 0;

  for (const section of titleIr.sections) {
    try {
      filesWritten += await writeSection(outputRoot, section);
    } catch (error) {
      parseErrors.push({
        code: 'OUTPUT_WRITE_FAILED',
        message: error instanceof Error ? error.message : 'Failed to write section output',
        sectionHint: section.sectionNumber,
      });
    }
  }

  const titlePath = resolve(outputRoot, 'uscode', `title-${padTitleNumber(titleIr.titleNumber)}`, '_title.md');

  try {
    await assertSafeOutputPath(outputRoot, titlePath);
    await atomicWriteFile(titlePath, renderTitleMarkdown(titleIr));
    filesWritten += 1;
  } catch (error) {
    parseErrors.push({
      code: 'OUTPUT_WRITE_FAILED',
      message: error instanceof Error ? error.message : 'Failed to write title metadata output',
      sectionHint: '_title.md',
    });
  }

  return { filesWritten, parseErrors };
}

async function writeSection(outputRoot: string, section: SectionIR): Promise<number> {
  const absolutePath = resolve(outputRoot, 'uscode', `title-${padTitleNumber(section.titleNumber)}`, `section-${sectionFileSafeId(section.sectionNumber)}.md`);
  await assertSafeOutputPath(outputRoot, absolutePath);
  await atomicWriteFile(absolutePath, renderSectionMarkdown(section));
  return 1;
}
