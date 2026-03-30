import matter from 'gray-matter';
import { relative } from 'node:path';
import type { ContentNode, NoteIR, SectionIR, StatutoryNoteIR, TitleIR } from '../domain/model.js';
import {
  buildCanonicalSectionUrl,
  embeddedSectionAnchor,
  sectionFileSafeId,
  titleDirectoryName,
} from '../domain/normalize.js';

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

  const body = stripCanonicalRefFragments(
    renderSectionBody(section, {
      sectionHeadingLevel: 1,
      statutoryNotesLevel: 2,
      statutoryNoteItemLevel: 3,
      editorialNotesLevel: 2,
      structuredSubsectionHeadings: false,
      emphasizeStructuredHeadings: false,
    }),
  );

  return matter.stringify(body, frontmatter);
}

export function renderChapterMarkdown(
  titleIr: TitleIR,
  chapter: string,
  sections: SectionIR[],
  options: { sectionTargetsByRef?: ReadonlyMap<string, string> } = {},
): string {
  const heading = titleIr.chapters.find((entry) => entry.number === chapter)?.heading ?? `Chapter ${chapter}`;
  const frontmatter = {
    title: titleIr.titleNumber,
    chapter,
    heading,
    section_count: sections.length,
    source: titleIr.sourceUrlTemplate,
  };

  return matter.stringify(renderEmbeddedSections(titleIr, sections, options.sectionTargetsByRef), frontmatter);
}

export function renderUncategorizedMarkdown(
  titleIr: TitleIR,
  sections: SectionIR[],
  options: { sectionTargetsByRef?: ReadonlyMap<string, string> } = {},
): string {
  const frontmatter = {
    title: titleIr.titleNumber,
    heading: 'Uncategorized',
    section_count: sections.length,
    source: titleIr.sourceUrlTemplate,
  };

  return matter.stringify(renderEmbeddedSections(titleIr, sections, options.sectionTargetsByRef), frontmatter);
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

  return matter.stringify(compactLines(lines), frontmatter);
}

function renderEmbeddedSections(
  titleIr: TitleIR,
  sections: SectionIR[],
  sectionTargetsByRef?: ReadonlyMap<string, string>,
): string {
  const bodies = sections.map((section) => {
    const anchor = embeddedSectionAnchor(section.sectionNumber);
    const body = renderSectionBody(section, {
      sectionHeadingLevel: 2,
      statutoryNotesLevel: 3,
      statutoryNoteItemLevel: 4,
      editorialNotesLevel: 3,
      anchor,
      structuredSubsectionHeadings: true,
      emphasizeStructuredHeadings: true,
    });

    return rewriteChapterModeLinks(body, titleIr, sectionTargetsByRef);
  });

  return `${bodies.join('\n\n').trimEnd()}\n`;
}

function renderSectionBody(
  section: SectionIR,
  options: {
    sectionHeadingLevel: number;
    statutoryNotesLevel: number;
    statutoryNoteItemLevel: number;
    editorialNotesLevel: number;
    anchor?: string;
    structuredSubsectionHeadings: boolean;
    emphasizeStructuredHeadings: boolean;
  },
): string {
  const lines: string[] = [];

  lines.push(renderSectionHeading(section, options.sectionHeadingLevel, options.anchor));

  const contentLines = renderContentNodes(section.content, {
    structuredSubsectionHeadings: options.structuredSubsectionHeadings,
    emphasizeStructuredHeadings: options.emphasizeStructuredHeadings,
  });
  if (contentLines.length > 0) {
    if (isLabeledLine(contentLines[0] ?? '')) {
      lines.push(...contentLines);
    } else {
      lines.push('', ...contentLines);
    }
  }

  if (section.statutoryNotes && section.statutoryNotes.length > 0) {
    lines.push('', `${'#'.repeat(options.statutoryNotesLevel)} Statutory Notes`);
    for (const note of section.statutoryNotes) {
      lines.push('', ...renderStatutoryNote(note, options.statutoryNoteItemLevel));
    }
  }

  if (section.editorialNotes && section.editorialNotes.length > 0) {
    lines.push('', `${'#'.repeat(options.editorialNotesLevel)} Notes`);
    for (const note of section.editorialNotes) {
      lines.push(`- ${renderNote(note)}`);
    }
  }

  return compactLines(lines);
}

function renderSectionHeading(section: SectionIR, level: number, anchor?: string): string {
  const prefix = '#'.repeat(level);
  const heading = section.heading ? `${prefix} § ${section.sectionNumber}. ${section.heading}` : `${prefix} § ${section.sectionNumber}.`;
  return anchor ? `${heading} {#${anchor}}` : heading;
}

function rewriteChapterModeLinks(
  markdown: string,
  titleIr: TitleIR,
  sectionTargetsByRef?: ReadonlyMap<string, string>,
): string {
  return markdown.replace(/\[([^\]]+)\]\(((?:\.\.\/title-[^/]+\/|\.\/)?section-([^)#]+?)\.md(?:#ref=([^)]*?))?)\)/gu, (_match, linkText: string, href: string, safeId: string, encodedCanonicalRef?: string) => {
    const canonicalRef = readCanonicalReference(encodedCanonicalRef);
    const referencedTitleNumber = canonicalRef?.titleNumber
      ?? readReferencedTitleNumberFromHref(href)
      ?? readReferencedTitleNumberFromLinkText(linkText)
      ?? titleIr.titleNumber;
    const sectionNumber = canonicalRef?.sectionNumber ?? readReferencedSectionNumber(linkText, safeId);
    const target = sectionTargetsByRef?.get(buildSectionTargetKey(referencedTitleNumber, sectionNumber));
    if (target) {
      return `[${linkText}](${target})`;
    }

    return `[${linkText}](${buildCanonicalSectionUrl(referencedTitleNumber, sectionNumber)})`;
  });
}

function buildSectionTargetKey(titleNumber: number, sectionNumber: string): string {
  return `${titleNumber}:${sectionNumber}`;
}

function readReferencedTitleNumberFromHref(href: string): number | undefined {
  const match = href.match(/^\.\.\/title-(\d+)-[^/]+\/section-[^/]+\.md$/u);
  if (!match) {
    return undefined;
  }

  const titleNumber = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(titleNumber) ? titleNumber : undefined;
}

function readReferencedTitleNumberFromLinkText(linkText: string): number | undefined {
  const match = linkText.match(/\bsection\s+.+?\s+of\s+title\s+(\d+)\b/iu);
  if (!match) {
    return undefined;
  }

  const titleNumber = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(titleNumber) ? titleNumber : undefined;
}

function readReferencedSectionNumber(linkText: string, safeId: string): string {
  return readReferencedSectionNumberFromLinkText(linkText) ?? readSectionNumberFromSafeId(safeId);
}

function readCanonicalReference(encodedCanonicalRef: string | undefined): { titleNumber: number; sectionNumber: string } | undefined {
  if (!encodedCanonicalRef) {
    return undefined;
  }

  const decoded = decodeURIComponent(encodedCanonicalRef);
  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex <= 0) {
    return undefined;
  }

  const titleNumber = Number.parseInt(decoded.slice(0, separatorIndex), 10);
  const sectionNumber = decoded.slice(separatorIndex + 1).trim();
  if (!Number.isFinite(titleNumber) || titleNumber <= 0 || !sectionNumber) {
    return undefined;
  }

  return { titleNumber, sectionNumber };
}

function readReferencedSectionNumberFromLinkText(linkText: string): string | undefined {
  const titledMatch = linkText.match(/\bsection\s+(.+?)\s+of\s+title\s+\d+\b/iu);
  if (titledMatch) {
    const sectionNumber = (titledMatch[1] ?? '').trim();
    return sectionNumber || undefined;
  }

  const bareMatch = linkText.match(/^section\s+(.+)$/iu);
  if (!bareMatch) {
    return undefined;
  }

  const sectionNumber = (bareMatch[1] ?? '').trim();
  return sectionNumber || undefined;
}

function readSectionNumberFromSafeId(safeId: string): string {
  return safeId.replace(/^0+(?=\d)/u, '');
}

function renderContentNodes(
  nodes: ContentNode[],
  options: { structuredSubsectionHeadings: boolean; emphasizeStructuredHeadings: boolean },
): string[] {
  const lines: string[] = [];
  const duplicateTextTracker = buildDuplicateTextTracker(nodes);

  for (const node of nodes) {
    const renderedLines = renderContentNodeLines(node, 0, duplicateTextTracker, options);
    if (renderedLines.length === 0) {
      continue;
    }

    if (lines.length > 0 && shouldSeparateWithBlankLine(lines, renderedLines)) {
      lines.push('');
    }

    lines.push(...renderedLines);
  }

  return lines;
}

function shouldSeparateWithBlankLine(existingLines: string[], nextLines: string[]): boolean {
  const lastNonBlank = [...existingLines].reverse().find((line) => line !== '');
  const firstNonBlank = nextLines.find((line) => line !== '');
  if (!lastNonBlank || !firstNonBlank) {
    return false;
  }

  return !isLabeledLine(lastNonBlank) && isLabeledLine(firstNonBlank);
}

function isLabeledLine(line: string): boolean {
  return /^\s*\([^)]+\)/u.test(line);
}

function renderContentNodeLines(
  node: ContentNode,
  indent: number,
  duplicateTextTracker: Map<string, number>,
  options: { structuredSubsectionHeadings: boolean; emphasizeStructuredHeadings: boolean },
): string[] {
  const runtimeNode = readRuntimeNode(node);
  const nodeType = runtimeNode.type ?? runtimeNode.kind;
  const children = runtimeNode.children ?? [];
  const text = (runtimeNode.text ?? '').trim();
  const label = runtimeNode.label ?? '';
  const heading = (runtimeNode.heading ?? '').trim();

  if (nodeType === 'text') {
    const key = text;
    const remaining = duplicateTextTracker.get(key) ?? 0;
    if (remaining > 1) {
      duplicateTextTracker.set(key, remaining - 1);
      return [];
    }

    if (remaining === 1) {
      duplicateTextTracker.delete(key);
    }

    return key ? [`${' '.repeat(indent)}${key}`] : [];
  }

  const lines: string[] = [];
  const line = renderStructuredLine(nodeType, label, heading, text, indent, options);
  if (line) {
    lines.push(line);
  }

  const childIndent = nodeType === 'subsection' ? indent : indent + 2;
  for (const child of children) {
    lines.push(...renderContentNodeLines(child, childIndent, duplicateTextTracker, options));
  }

  return lines;
}

function renderStructuredLine(
  nodeType: string | undefined,
  label: string,
  heading: string,
  text: string,
  indent: number,
  options: { structuredSubsectionHeadings: boolean; emphasizeStructuredHeadings: boolean },
): string {
  if (nodeType === 'subsection' && options.structuredSubsectionHeadings) {
    return renderSubsectionHeading(label, heading, text);
  }

  return renderLabeledLine(label, heading, text, indent, options);
}

function renderSubsectionHeading(label: string, heading: string, text: string): string {
  const formattedLabel = formatLabel(label);
  const inlineText = [formattedLabel, heading, text].filter(Boolean).join(' ');
  return inlineText ? `## ${inlineText}` : '';
}

function renderLabeledLine(
  label: string,
  heading: string,
  text: string,
  indent: number,
  options: { structuredSubsectionHeadings: boolean; emphasizeStructuredHeadings: boolean },
): string {
  const formattedLabel = formatLabel(label);
  const headingText = heading
    ? (text ? `${formatHeading(heading, indent, options)}${options.emphasizeStructuredHeadings ? ' — ' : ' '}${text}` : formatHeading(heading, indent, options))
    : text;
  const parts = [formattedLabel, headingText].filter(Boolean);
  return parts.length > 0 ? `${' '.repeat(indent)}${parts.join(' ')}`.trimEnd() : '';
}

function formatHeading(
  heading: string,
  indent: number,
  options: { structuredSubsectionHeadings: boolean; emphasizeStructuredHeadings: boolean },
): string {
  if (!options.emphasizeStructuredHeadings) {
    return heading;
  }

  return indent === 0 ? `**${heading}**` : `*${heading}*`;
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

function renderStatutoryNote(note: StatutoryNoteIR, headingLevel: number): string[] {
  const lines: string[] = [];
  if (note.heading) {
    lines.push(`${'#'.repeat(headingLevel)} ${note.heading}`);
  }
  if (note.text) {
    lines.push(note.text);
  }
  return lines;
}

function renderNote(note: NoteIR): string {
  return note.text;
}

function stripCanonicalRefFragments(markdown: string): string {
  return markdown.replace(/(\]\((?:\.\.\/title-[^/]+\/|\.\/)?section-[^)#]+?\.md)#ref=[^)]+(\))/gu, '$1$2');
}

function compactLines(lines: string[]): string {
  return lines.filter((line, index, arr) => !(line === '' && arr[index - 1] === '')).join('\n').trimEnd() + '\n';
}
