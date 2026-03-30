import matter from 'gray-matter';
import { relative } from 'node:path';
import type { ContentNode, NoteIR, SectionIR, StatutoryNoteIR, TitleIR } from '../domain/model.js';
import { sectionFileSafeId, sortSections, titleDirectoryName } from '../domain/normalize.js';

export function sectionRelativeMarkdownLink(
  from: { titleNumber: number; heading?: string | null },
  to: { titleNumber: number; heading?: string | null; sectionNumber: string },
): string {
  const fromDirectory = titleDirectoryName({ titleNumber: from.titleNumber, heading: from.heading });
  const targetPath = `${titleDirectoryName({ titleNumber: to.titleNumber, heading: to.heading })}/section-${sectionFileSafeId(to.sectionNumber)}.md`;

  return relative(fromDirectory, targetPath);
}

export function renderSectionMarkdown(section: SectionIR): string {
  const frontmatter: Record<string, string | number> = {};

  if (section.titleNumber !== undefined) frontmatter.title = section.titleNumber;
  if (section.sectionNumber) frontmatter.section = section.sectionNumber;
  if (section.heading) frontmatter.heading = section.heading;
  if (section.status) frontmatter.status = section.status;
  if (section.source) frontmatter.source = section.source;
  if (section.hierarchy?.subtitle) frontmatter.subtitle = section.hierarchy.subtitle;
  if (section.hierarchy?.part) frontmatter.part = section.hierarchy.part;
  if (section.hierarchy?.subpart) frontmatter.subpart = section.hierarchy.subpart;
  if (section.hierarchy?.chapter) frontmatter.chapter = section.hierarchy.chapter;
  if (section.hierarchy?.subchapter) frontmatter.subchapter = section.hierarchy.subchapter;
  if (section.enacted) frontmatter.enacted = section.enacted;
  if (section.publicLaw) frontmatter.public_law = section.publicLaw;
  if (section.lastAmended) frontmatter.last_amended = section.lastAmended;
  if (section.lastAmendedBy) frontmatter.last_amended_by = section.lastAmendedBy;
  if (section.sourceCredit) frontmatter.source_credit = section.sourceCredit;

  const lines = [`# § ${section.sectionNumber}. ${section.heading}`.trim()];

  const duplicateTextTracker = buildDuplicateTextTracker(section.content);

  for (const node of section.content) {
    const rendered = renderContentNode(node, 0, duplicateTextTracker);
    if (rendered) {
      lines.push(rendered);
    }
  }

  if (section.statutoryNotes && section.statutoryNotes.length > 0) {
    lines.push('', '## Statutory Notes');
    for (const note of section.statutoryNotes) {
      lines.push(renderStatutoryNote(note));
    }
  }

  if (section.editorialNotes && section.editorialNotes.length > 0) {
    lines.push('', '## Notes');
    for (const note of section.editorialNotes) {
      lines.push(`- ${renderNote(note)}`);
    }
  }

  return matter.stringify(compactLines(lines), frontmatter);
}

export function renderChapterMarkdown(
  titleIr: TitleIR,
  chapter: string,
  sections: SectionIR[],
  options: { sectionTargetsByNumber?: ReadonlyMap<string, string> } = {},
): string {
  const heading = titleIr.chapters.find((entry) => entry.number === chapter)?.heading ?? `Chapter ${chapter}`;
  const frontmatter = {
    title: titleIr.titleNumber,
    chapter,
    heading,
    section_count: sections.length,
    source: titleIr.sourceUrlTemplate,
  };

  return matter.stringify(renderEmbeddedSections(sections, options.sectionTargetsByNumber), frontmatter);
}

export function renderUncategorizedMarkdown(
  titleIr: TitleIR,
  sections: SectionIR[],
  options: { sectionTargetsByNumber?: ReadonlyMap<string, string> } = {},
): string {
  const frontmatter = {
    title: titleIr.titleNumber,
    heading: 'Uncategorized',
    section_count: sections.length,
    source: titleIr.sourceUrlTemplate,
  };

  return matter.stringify(renderEmbeddedSections(sections, options.sectionTargetsByNumber), frontmatter);
}

export function renderTitleMarkdown(titleIr: TitleIR): string {
  const frontmatter: Record<string, string | number | boolean> = {
    title: titleIr.titleNumber,
    heading: titleIr.heading,
    positive_law: titleIr.positiveLaw ?? false,
    sections: titleIr.sections.length,
  };

  if (titleIr.chapters.length > 0) {
    frontmatter.chapters = titleIr.chapters.length;
  }

  const lines = [`# Title ${titleIr.titleNumber}. ${titleIr.heading}`];

  if (titleIr.chapters.length > 0) {
    lines.push('', '## Chapters');
    for (const chapter of titleIr.chapters) {
      lines.push(`- ${chapter.number} — ${chapter.heading}`);
    }
  }

  lines.push('', '## Sections');
  for (const section of sortSections(titleIr.sections)) {
    lines.push(`- § ${section.sectionNumber}. ${section.heading}`);
  }

  return matter.stringify(compactLines(lines), frontmatter);
}

function renderEmbeddedSections(sections: SectionIR[], sectionTargetsByNumber?: ReadonlyMap<string, string>): string {
  const bodies = sections.map((section) => {
    const body = matter(renderSectionMarkdown(section)).content.trim();
    return rewriteChapterModeLinks(body, sectionTargetsByNumber);
  });
  return `${bodies.join('\n\n').trimEnd()}\n`;
}

function rewriteChapterModeLinks(markdown: string, sectionTargetsByNumber?: ReadonlyMap<string, string>): string {
  if (!sectionTargetsByNumber || sectionTargetsByNumber.size === 0) {
    return markdown;
  }

  return markdown.replace(/\]\((?:\.\/)?section-([^)]+?)\.md\)/gu, (_match, safeId: string) => {
    const sectionNumber = readSectionNumberFromSafeId(safeId);
    const target = sectionTargetsByNumber.get(sectionNumber);
    if (!target) {
      return `](./section-${safeId}.md)`;
    }

    return `](./${target})`;
  });
}

function readSectionNumberFromSafeId(safeId: string): string {
  return safeId.replace(/^0+(?=\d)/u, '');
}

function renderContentNode(node: ContentNode, indent: number, duplicateTextTracker: Map<string, number>): string {
  const runtimeNode = readRuntimeNode(node);
  const nodeType = runtimeNode.type ?? runtimeNode.kind;
  const children = runtimeNode.children ?? [];
  const text = runtimeNode.text ?? '';
  const label = runtimeNode.label ?? '';
  const heading = runtimeNode.heading;

  if (nodeType === 'text') {
    const key = text.trim();
    const remaining = duplicateTextTracker.get(key) ?? 0;
    if (remaining > 1) {
      duplicateTextTracker.set(key, remaining - 1);
      return '';
    }

    if (remaining === 1) {
      duplicateTextTracker.delete(key);
    }

    return `${' '.repeat(indent)}${text.trimEnd()}`.trimEnd();
  }

  if (nodeType === 'subsection') {
    const headingLine = ['##', formatLabel(label), heading, text].filter(Boolean).join(' ');
    const lines = [headingLine.trimEnd()];
    for (const child of children) {
      const rendered = renderContentNode(child, 0, duplicateTextTracker);
      if (rendered) {
        lines.push(rendered);
      }
    }
    return lines.join('\n');
  }

  const labelLine = [formatLabel(label), heading, text].filter(Boolean).join(' ').trim();
  const lines = [labelLine ? `${' '.repeat(indent)}${labelLine}`.trimEnd() : `${' '.repeat(indent)}${text.trimEnd()}`.trimEnd()].filter(Boolean);
  for (const child of children) {
    const rendered = renderContentNode(child, indent + 2, duplicateTextTracker);
    if (rendered) {
      lines.push(rendered);
    }
  }
  return lines.join('\n');
}

function buildDuplicateTextTracker(nodes: ContentNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  collectTextNodeCounts(nodes, counts);
  for (const [key, value] of counts.entries()) {
    if (value < 2) {
      counts.delete(key);
    }
  }
  return counts;
}

function collectTextNodeCounts(nodes: ContentNode[], counts: Map<string, number>): void {
  if (!Array.isArray(nodes)) {
    return;
  }

  for (const node of nodes) {
    const runtimeNode = readRuntimeNode(node);
    const nodeType = runtimeNode.type ?? runtimeNode.kind;
    if (nodeType === 'text') {
      const key = (runtimeNode.text ?? '').trim();
      if (key) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      continue;
    }

    collectTextNodeCounts(runtimeNode.children ?? [], counts);
  }
}

function readRuntimeNode(node: ContentNode): {
  type?: string;
  kind?: string;
  text?: string;
  label?: string;
  heading?: string;
  children?: ContentNode[];
} {
  const value = Object(node) as Record<string, unknown>;
  return {
    type: typeof value.type === 'string' ? value.type : undefined,
    kind: typeof value.kind === 'string' ? value.kind : undefined,
    text: typeof value.text === 'string' ? value.text : undefined,
    label: typeof value.label === 'string' ? value.label : undefined,
    heading: typeof value.heading === 'string' ? value.heading : undefined,
    children: Array.isArray(value.children) ? (value.children as ContentNode[]) : undefined,
  };
}

function formatLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) {
    return trimmed;
  }

  return trimmed.startsWith('(') ? trimmed : `(${trimmed})`;
}

function renderStatutoryNote(note: StatutoryNoteIR): string {
  const parts = [] as string[];
  if (note.heading) parts.push(`### ${note.heading}`);
  parts.push(note.text);
  return parts.join('\n');
}

function renderNote(note: NoteIR): string {
  return note.text;
}

function compactLines(lines: string[]): string {
  return lines.filter((line, index, arr) => !(line === '' && arr[index - 1] === '')).join('\n').trimEnd() + '\n';
}
