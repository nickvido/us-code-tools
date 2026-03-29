import { XMLParser } from 'fast-xml-parser';
import type { ContentNode, HierarchyIR, NoteIR, ParseError, ParsedTitleResult, SectionIR, StatutoryNoteIR, TitleIR } from '../domain/model.js';
import { asArray, normalizeWhitespace, sectionFileSafeId } from '../domain/normalize.js';

const MAX_NORMALIZED_FIELD_LENGTH = 1_048_576;
const HIERARCHY_TAGS = ['subtitle', 'part', 'subpart', 'chapter', 'subchapter'] as const;

type HierarchyTag = typeof HIERARCHY_TAGS[number];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  allowBooleanAttributes: false,
  removeNSPrefix: true,
});

export function parseUslmToIr(xml: string, xmlPath?: string): ParsedTitleResult {
  const parseErrors: ParseError[] = [];

  let document: { uslm?: { title?: XmlNode }; uscDoc?: { meta?: XmlNode; main?: { title?: XmlNode } } };
  try {
    document = parser.parse(stripBom(xml)) as { uslm?: { title?: XmlNode }; uscDoc?: { meta?: XmlNode; main?: { title?: XmlNode } } };
  } catch (error) {
    return {
      titleIr: emptyTitleIr(),
      parseErrors: [{
        code: 'INVALID_XML',
        message: error instanceof Error ? error.message : 'Failed to parse XML',
        xmlPath,
      }],
    };
  }

  const titleNode = document.uscDoc?.main?.title ?? document.uslm?.title;
  if (!titleNode) {
    return {
      titleIr: emptyTitleIr(),
      parseErrors: [{ code: 'INVALID_XML', message: 'Missing <title> root element', xmlPath }],
    };
  }

  const titleNumber = parseTitleNumber(readCanonicalNumText(parseErrors, titleNode.num, xmlPath, 'title number'));
  const heading = readNormalizedText(parseErrors, titleNode.heading, xmlPath, 'title heading');
  const positiveLaw = readPositiveLaw(document.uscDoc?.meta);

  const titleIr: TitleIR = {
    titleNumber,
    heading,
    positiveLaw,
    chapters: collectChapterMetadata(titleNode, parseErrors, xmlPath),
    sections: [],
    sourceUrlTemplate: `https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title${titleNumber}-section{section}`,
  };

  let uncodifiedSectionIndex = 0;

  for (const { node: sectionNode, hierarchy } of collectSectionNodes(titleNode)) {
    const sectionNumber = readCanonicalNumText(parseErrors, sectionNode.num, xmlPath, 'section number');
    const sectionHint = readNormalizedText(parseErrors, sectionNode.heading, xmlPath, 'section heading');
    const fallbackSectionNumber = sectionNumber || `uncodified-${++uncodifiedSectionIndex}`;

    const sectionParseErrors: ParseError[] = [];
    const parsedSection = parseSection(titleNumber, sectionNode, hierarchy, sectionParseErrors, xmlPath, fallbackSectionNumber);
    if (sectionParseErrors.length > 0) {
      for (const error of sectionParseErrors) {
        parseErrors.push({
          ...error,
          xmlPath: error.xmlPath ?? xmlPath,
          sectionHint: error.sectionHint ?? sectionNumber,
        });
      }
      continue;
    }

    titleIr.sections.push(parsedSection);
  }

  return { titleIr, parseErrors };
}

interface XmlNode {
  '@_value'?: string;
  '@_href'?: string;
  '@_identifier'?: string;
  '@_role'?: string;
  '@_topic'?: string;
  '@_type'?: string;
  '#text'?: string;
  num?: XmlValue;
  heading?: XmlValue;
  status?: XmlValue;
  source?: XmlValue;
  enacted?: XmlValue;
  'public-law'?: XmlValue;
  'last-amended'?: XmlValue;
  'last-amended-by'?: XmlValue;
  text?: XmlValue;
  p?: XmlValue;
  content?: XmlNode;
  xref?: XmlValue;
  type?: XmlValue;
  property?: XmlNode | XmlNode[];
  subtitle?: XmlNode | XmlNode[];
  part?: XmlNode | XmlNode[];
  subpart?: XmlNode | XmlNode[];
  chapter?: XmlNode | XmlNode[];
  subchapter?: XmlNode | XmlNode[];
  section?: XmlNode | XmlNode[];
  subsection?: XmlNode | XmlNode[];
  paragraph?: XmlNode | XmlNode[];
  subparagraph?: XmlNode | XmlNode[];
  clause?: XmlNode | XmlNode[];
  item?: XmlNode | XmlNode[];
  note?: XmlNode | XmlNode[];
  notes?: XmlNode | XmlNode[];
  sourceCredit?: XmlValue;
  ref?: XmlNode | XmlNode[];
  date?: XmlNode | XmlNode[];
  quotedContent?: XmlNode | XmlNode[];
  inline?: XmlNode | XmlNode[];
  continuation?: XmlNode | XmlNode[];
  chapeau?: XmlNode | XmlNode[];
  subclause?: XmlNode | XmlNode[];
  'cross-reference'?: XmlNode | XmlNode[];
}

type XmlValue = string | number | boolean | XmlNode | Array<string | number | boolean | XmlNode>;

function collectChapterMetadata(titleNode: XmlNode, parseErrors: ParseError[], xmlPath?: string): TitleIR['chapters'] {
  const chapters: TitleIR['chapters'] = [];

  walkHierarchy(titleNode, {}, (node) => {
    if (node.chapter) {
      for (const chapter of asArray(node.chapter)) {
        const number = readCanonicalNumText(parseErrors, chapter.num, xmlPath, 'chapter number');
        const heading = readNormalizedText(parseErrors, chapter.heading, xmlPath, 'chapter heading');
        if (number && !chapters.some((entry) => entry.number === number && entry.heading === heading)) {
          chapters.push({ number, heading });
        }
      }
    }
  });

  return chapters;
}

function collectSectionNodes(titleNode: XmlNode): Array<{ node: XmlNode; hierarchy: HierarchyIR }> {
  const sections: Array<{ node: XmlNode; hierarchy: HierarchyIR }> = [];
  collectSectionNodesRecursive(titleNode, {}, sections);
  return sections;
}

function walkHierarchy(node: XmlNode, hierarchy: HierarchyIR, visit: (node: XmlNode, hierarchy: HierarchyIR) => void): void {
  visit(node, hierarchy);

  for (const tag of HIERARCHY_TAGS) {
    for (const child of asArray(node[tag])) {
      const number = normalizeWhitespace(readRawText(child.num));
      const nextHierarchy = number ? { ...hierarchy, [tag]: cleanDecoratedNumText(number) } : { ...hierarchy };
      walkHierarchy(child, nextHierarchy, visit);
    }
  }
}

function collectSectionNodesRecursive(
  node: XmlNode,
  hierarchy: HierarchyIR,
  sections: Array<{ node: XmlNode; hierarchy: HierarchyIR }>,
): void {
  for (const tag of HIERARCHY_TAGS) {
    for (const child of asArray(node[tag])) {
      const number = normalizeWhitespace(readRawText(child.num));
      const nextHierarchy = number ? { ...hierarchy, [tag]: cleanDecoratedNumText(number) } : { ...hierarchy };
      collectSectionNodesRecursive(child, nextHierarchy, sections);
    }
  }

  for (const section of asArray(node.section)) {
    sections.push({ node: section, hierarchy });
    collectSectionNodesRecursive(section, hierarchy, sections);
  }

  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('@_') || key === 'section' || HIERARCHY_TAGS.includes(key as HierarchyTag)) {
      continue;
    }

    for (const child of asArray(value as XmlNode | XmlNode[] | undefined)) {
      if (typeof child === 'object' && child !== null) {
        collectSectionNodesRecursive(child as XmlNode, hierarchy, sections);
      }
    }
  }
}

function parseSection(
  titleNumber: number,
  sectionNode: XmlNode,
  hierarchy: HierarchyIR,
  parseErrors: ParseError[],
  xmlPath: string | undefined,
  fallbackSectionNumber?: string,
): SectionIR {
  const sectionNumber = readCanonicalNumText(parseErrors, sectionNode.num, xmlPath, 'section number') || fallbackSectionNumber || '';
  const source = optionalText(parseErrors, sectionNode.source, xmlPath, 'section source') ?? defaultSectionSource(titleNumber, sectionNumber);
  const parsedNotes = parseNotes(sectionNode, parseErrors, xmlPath, sectionNumber);

  const identifier = normalizeWhitespace(sectionNode['@_identifier']);
  const isCodifiedSection = identifier.startsWith(`/us/usc/t${titleNumber}/s`)
    || sectionNode.source !== undefined
    || sectionNode.enacted !== undefined
    || sectionNode['public-law'] !== undefined
    || sectionNode['last-amended'] !== undefined
    || sectionNode['last-amended-by'] !== undefined;

  return {
    titleNumber,
    sectionNumber,
    heading: readNormalizedText(parseErrors, sectionNode.heading, xmlPath, 'section heading'),
    status: normalizeStatus(readRawText(sectionNode.status)),
    source,
    identifier,
    isCodifiedSection,
    enacted: optionalText(parseErrors, sectionNode.enacted, xmlPath, 'section enacted'),
    publicLaw: optionalText(parseErrors, sectionNode['public-law'], xmlPath, 'section public law'),
    lastAmended: optionalText(parseErrors, sectionNode['last-amended'], xmlPath, 'section last amended'),
    lastAmendedBy: optionalText(parseErrors, sectionNode['last-amended-by'], xmlPath, 'section last amended by'),
    sourceCredit: parsedNotes.sourceCredit,
    sourceCredits: parsedNotes.sourceCredit ? [parsedNotes.sourceCredit] : [],
    hierarchy: Object.keys(hierarchy).length > 0 ? hierarchy : undefined,
    statutoryNotes: parsedNotes.statutoryNotes,
    editorialNotes: parsedNotes.editorialNotes,
    content: parseContent(sectionNode, parseErrors, xmlPath, sectionNumber),
  };
}

function parseContent(node: XmlNode, parseErrors: ParseError[], xmlPath: string | undefined, sectionHint: string): ContentNode[] {
  const contentRoot = node.content ?? node;
  const content: ContentNode[] = [];

  for (const textNode of [...asArray(contentRoot.chapeau), ...asArray(contentRoot.continuation)]) {
    const text = readNodeText(parseErrors, textNode, xmlPath, sectionHint, 'section text');
    if (text) content.push({ type: 'text', text });
  }

  content.push(...asArray(contentRoot.subsection).map((child) => parseLabeledNode('subsection', child, parseErrors, xmlPath, sectionHint)));
  content.push(...asArray(contentRoot.paragraph).map((child) => parseLabeledNode('paragraph', child, parseErrors, xmlPath, sectionHint)));

  if (content.length === 0) {
    const text = optionalText(parseErrors, contentRoot.p ?? contentRoot.text ?? contentRoot, xmlPath, 'section text', sectionHint);
    if (text) {
      content.push({ type: 'text', text });
    }
  }

  return content.filter((entry) => !(entry.type === 'text' && !entry.text));
}

function parseLabeledNode(
  type: 'subsection' | 'paragraph' | 'subparagraph' | 'clause' | 'item',
  node: XmlNode,
  parseErrors: ParseError[],
  xmlPath: string | undefined,
  sectionHint: string,
): ContentNode {
  const children: ContentNode[] = [];

  for (const textNode of [...asArray(node.chapeau), ...asArray(node.continuation)]) {
    const text = readNodeText(parseErrors, textNode, xmlPath, sectionHint, `${type} text`);
    if (text) children.push({ type: 'text', text });
  }

  children.push(...asArray(node.subsection).map((child) => parseLabeledNode('subsection', child, parseErrors, xmlPath, sectionHint)));
  children.push(...asArray(node.paragraph).map((child) => parseLabeledNode('paragraph', child, parseErrors, xmlPath, sectionHint)));
  children.push(...asArray(node.subparagraph).map((child) => parseLabeledNode('subparagraph', child, parseErrors, xmlPath, sectionHint)));
  children.push(...asArray(node.clause).map((child) => parseLabeledNode('clause', child, parseErrors, xmlPath, sectionHint)));
  children.push(...asArray(node.subclause).map((child) => parseLabeledNode('item', child, parseErrors, xmlPath, sectionHint)));
  children.push(...asArray(node.item).map((child) => parseLabeledNode('item', child, parseErrors, xmlPath, sectionHint)));

  const inlineText = optionalText(parseErrors, node.content ?? node.text ?? node.p, xmlPath, `${type} text`, sectionHint);

  return {
    type,
    label: readCanonicalNumText(parseErrors, node.num, xmlPath, `${type} label`, sectionHint),
    heading: optionalText(parseErrors, node.heading, xmlPath, `${type} heading`, sectionHint),
    text: inlineText,
    children: children.filter((entry) => !(entry.type === 'text' && !entry.text)),
  };
}

function parseNotes(
  sectionNode: XmlNode,
  parseErrors: ParseError[],
  xmlPath: string | undefined,
  sectionHint: string,
): { sourceCredit?: string; statutoryNotes: StatutoryNoteIR[]; editorialNotes: NoteIR[] } {
  let sourceCredit = optionalText(parseErrors, sectionNode.sourceCredit, xmlPath, 'section source credit', sectionHint);
  const statutoryNotes: StatutoryNoteIR[] = [];
  const editorialNotes: NoteIR[] = [];

  for (const noteNode of asArray(sectionNode.note)) {
    const text = optionalText(parseErrors, noteNode.text ?? noteNode, xmlPath, 'section note', sectionHint);
    if (!text) continue;

    const kind = normalizeWhitespace(readRawText(noteNode.type));
    if (kind === 'source-credit') {
      sourceCredit ??= text;
      continue;
    }

    editorialNotes.push({
      kind: kind === 'editorial' || kind === 'cross-reference' ? kind : 'misc',
      text,
    });
  }

  for (const notesNode of asArray(sectionNode.notes)) {
    for (const noteNode of asArray(notesNode.note)) {
      const text = readNodeText(parseErrors, noteNode, xmlPath, sectionHint, 'statutory note');
      if (!text) continue;
      statutoryNotes.push({
        heading: optionalText(parseErrors, noteNode.heading, xmlPath, 'statutory note heading', sectionHint),
        topic: normalizeWhitespace(readRawText(noteNode['@_topic'] ?? noteNode.type)) || undefined,
        text,
      });
    }
  }

  return { sourceCredit, statutoryNotes, editorialNotes };
}

function readRawText(value: XmlValue | undefined): string {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => readRawText(entry)).join(' ');
  }

  const node = value;
  const href = normalizeWhitespace(node['@_href']);
  const ownText = [node['#text'], node.text, node.p, node.content, node.heading, node.num, node.chapeau, node.continuation, node.quotedContent, node.inline]
    .map((entry) => readRawText(entry))
    .filter(Boolean)
    .join(' ');

  const childText = Object.entries(node)
    .filter(([key]) => !key.startsWith('@_') && !['#text', 'text', 'p', 'content', 'heading', 'num', 'chapeau', 'continuation', 'quotedContent', 'inline'].includes(key))
    .map(([, entry]) => readRawText(entry as XmlValue))
    .filter(Boolean)
    .join(' ');

  const combined = normalizeWhitespace([ownText, childText].filter(Boolean).join(' '));
  if (!href) {
    return combined;
  }

  const label = combined || href;
  const markdownHref = hrefToMarkdownLink(href);
  if (!markdownHref) {
    return label;
  }

  return `[${label}](${markdownHref})`;
}

function hrefToMarkdownLink(href: string): string | null {
  const uscMatch = href.match(/^\/us\/usc\/t(\d+)\/s([^/]+)$/u);
  if (!uscMatch) {
    return null;
  }

  const titleNumber = Number.parseInt(uscMatch[1] ?? '0', 10);
  if (!Number.isFinite(titleNumber) || titleNumber <= 0) {
    return null;
  }

  const sectionNumber = normalizeWhitespace(uscMatch[2]);
  if (!sectionNumber) {
    return null;
  }

  const title = String(titleNumber).padStart(2, '0');
  return `../title-${title}/section-${sectionFileSafeId(sectionNumber)}.md`;
}

function readCanonicalNumText(parseErrors: ParseError[], value: XmlValue | undefined, xmlPath: string | undefined, fieldName: string, sectionHint?: string): string {
  if (!value || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value)) {
    return cleanDecoratedNumText(readNormalizedText(parseErrors, value, xmlPath, fieldName, sectionHint));
  }

  const normalizedValue = normalizeWhitespace(value['@_value'] ?? '');
  if (normalizedValue) {
    return enforceNormalizedFieldLimit(parseErrors, normalizedValue, xmlPath, fieldName, sectionHint);
  }

  return cleanDecoratedNumText(readNormalizedText(parseErrors, value, xmlPath, fieldName, sectionHint));
}

function cleanDecoratedNumText(value: string): string {
  return normalizeWhitespace(value)
    .replace(/^§\s*/u, '')
    .replace(/^Title\s+/iu, '')
    .replace(/^Subtitle\s+/iu, '')
    .replace(/^Subchapter\s+/iu, '')
    .replace(/^Subpart\s+/iu, '')
    .replace(/^Part\s+/iu, '')
    .replace(/^Chapter\s+/iu, '')
    .replace(/[.—]+$/u, '')
    .trim();
}

function readNormalizedText(parseErrors: ParseError[], value: XmlValue | undefined, xmlPath: string | undefined, fieldName: string, sectionHint?: string): string {
  return enforceNormalizedFieldLimit(parseErrors, normalizeWhitespace(readRawText(value)), xmlPath, fieldName, sectionHint);
}

function enforceNormalizedFieldLimit(parseErrors: ParseError[], text: string, xmlPath: string | undefined, fieldName: string, sectionHint?: string): string {
  if (text.length > MAX_NORMALIZED_FIELD_LENGTH) {
    parseErrors.push({
      code: 'UNSUPPORTED_STRUCTURE',
      message: `${fieldName} exceeds maximum normalized text length of ${MAX_NORMALIZED_FIELD_LENGTH} characters`,
      xmlPath,
      sectionHint,
    });
    return '';
  }

  return text;
}

function readNodeText(parseErrors: ParseError[], node: XmlNode, xmlPath: string | undefined, sectionHint: string, fieldName: string): string {
  return readNormalizedText(parseErrors, node, xmlPath, fieldName, sectionHint);
}

function optionalText(parseErrors: ParseError[], value: XmlValue | undefined, xmlPath: string | undefined, fieldName: string, sectionHint?: string): string | undefined {
  const text = readNormalizedText(parseErrors, value, xmlPath, fieldName, sectionHint);
  return text || undefined;
}

function normalizeStatus(value: string): SectionIR['status'] {
  const normalized = normalizeWhitespace(value);
  if (normalized === 'repealed' || normalized === 'transferred' || normalized === 'omitted') {
    return normalized;
  }
  return 'in-force';
}

function defaultSectionSource(titleNumber: number, sectionNumber: string): string {
  return `https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title${titleNumber}-section${sectionNumber}`;
}

function parseTitleNumber(value: string): number {
  const direct = Number(value);
  if (Number.isInteger(direct) && direct > 0) {
    return direct;
  }

  const match = value.match(/(\d+)/);
  return match ? Number.parseInt(match[1] ?? '0', 10) : 0;
}

function readPositiveLaw(metaNode: XmlNode | undefined): boolean | null {
  for (const property of asArray(metaNode?.property)) {
    const role = normalizeWhitespace(readRawText((property as XmlNode)['@_role']));
    if (role === 'is-positive-law') {
      const text = normalizeWhitespace(readRawText(property));
      if (text === 'yes') return true;
      if (text === 'no') return false;
    }
  }
  return null;
}

function emptyTitleIr(): TitleIR {
  return {
    titleNumber: 0,
    heading: '',
    positiveLaw: null,
    chapters: [],
    sections: [],
    sourceUrlTemplate: '',
  };
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
