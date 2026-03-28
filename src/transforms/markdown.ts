import matter from 'gray-matter';
import type { ContentNode, NoteIR, SectionIR, TitleIR } from '../domain/model.js';

export function renderSectionMarkdown(section: SectionIR): string {
  const frontmatter: Record<string, string | number> = {
    title: section.titleNumber,
    section: section.sectionNumber,
    heading: section.heading,
    status: section.status,
    source: section.source,
  };

  if (section.enacted) frontmatter.enacted = section.enacted;
  if (section.publicLaw) frontmatter.public_law = section.publicLaw;
  if (section.lastAmended) frontmatter.last_amended = section.lastAmended;
  if (section.lastAmendedBy) frontmatter.last_amended_by = section.lastAmendedBy;

  const lines = [`# § ${section.sectionNumber}. ${section.heading}`.trim()];

  for (const node of section.content) {
    lines.push(renderContentNode(node));
  }

  if (section.editorialNotes && section.editorialNotes.length > 0) {
    lines.push('', '## Notes');
    for (const note of section.editorialNotes) {
      lines.push(`- ${renderNote(note)}`);
    }
  }

  return matter.stringify(lines.filter((line, index, arr) => !(line === '' && arr[index - 1] === '')).join('\n').trimEnd() + '\n', frontmatter);
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
  for (const section of titleIr.sections) {
    lines.push(`- § ${section.sectionNumber}. ${section.heading}`);
  }

  return matter.stringify(lines.join('\n').trimEnd() + '\n', frontmatter);
}

function renderContentNode(node: ContentNode, depth = 0): string {
  if (node.type === 'text') {
    return `${' '.repeat(depth)}${node.text}`.trimEnd();
  }

  if (node.type === 'subsection') {
    const heading = [node.label, node.heading].filter(Boolean).join(' ');
    const parts = [`## ${heading}`.trim()];
    if (node.text) {
      parts.push(node.text);
    }
    for (const child of node.children) {
      parts.push(renderContentNode(child, 0));
    }
    return parts.join('\n');
  }

  const indent = indentationForNode(node.type);
  const lines = [`${' '.repeat(indent)}${node.label} ${node.text ?? ''}`.trimEnd()];
  for (const child of node.children) {
    lines.push(renderContentNode(child, depth + 2));
  }
  return lines.join('\n');
}

function indentationForNode(type: Exclude<ContentNode['type'], 'text' | 'subsection'>): number {
  switch (type) {
    case 'paragraph':
      return 0;
    case 'subparagraph':
      return 2;
    case 'clause':
      return 4;
    case 'item':
      return 6;
  }
}

function renderNote(note: NoteIR): string {
  return note.text;
}
