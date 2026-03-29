import matter from 'gray-matter';
import type { ContentNode, NoteIR, SectionIR, StatutoryNoteIR, TitleIR } from '../domain/model.js';
import { sortSections } from '../domain/normalize.js';

export function renderSectionMarkdown(section: SectionIR): string {
  const frontmatter: Record<string, string | number> = {
    title: section.titleNumber,
    section: section.sectionNumber,
    heading: section.heading,
    status: section.status,
    source: section.source,
  };

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

function renderContentNode(node: ContentNode, indent: number, duplicateTextTracker: Map<string, number>): string {
  if (node.type === 'text') {
    const key = node.text.trim();
    const remaining = duplicateTextTracker.get(key) ?? 0;
    if (remaining > 1) {
      duplicateTextTracker.set(key, remaining - 1);
      return '';
    }

    if (remaining === 1) {
      duplicateTextTracker.delete(key);
    }

    return `${' '.repeat(indent)}${node.text.trimEnd()}`.trimEnd();
  }

  if (node.type === 'subsection') {
    const headingLine = ['##', formatLabel(node.label), node.heading, node.text].filter(Boolean).join(' ');
    const lines = [headingLine.trimEnd()];
    for (const child of node.children) {
      const rendered = renderContentNode(child, 0, duplicateTextTracker);
      if (rendered) {
        lines.push(rendered);
      }
    }
    return lines.join('\n');
  }

  const labelLine = [formatLabel(node.label), node.heading, node.text].filter(Boolean).join(' ');
  const lines = [`${' '.repeat(indent)}${labelLine}`.trimEnd()];
  for (const child of node.children) {
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
  for (const node of nodes) {
    if (node.type === 'text') {
      const key = node.text.trim();
      if (key) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      continue;
    }

    collectTextNodeCounts(node.children, counts);
  }
}

function formatLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) {
    return trimmed;
  }

  return trimmed.startsWith('(') ? trimmed : `(${trimmed})`;
}

function indentationForNode(type: Exclude<ContentNode['type'], 'text'>): number {
  switch (type) {
    case 'subsection':
    case 'paragraph':
      return 0;
    case 'subparagraph':
      return 2;
    case 'clause':
      return 4;
    case 'subclause':
      return 6;
    case 'item':
      return 8;
    case 'subitem':
      return 10;
  }
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
