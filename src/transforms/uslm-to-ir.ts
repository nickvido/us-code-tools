import { XMLParser } from 'fast-xml-parser';
import type { ContentNode, HierarchyIR, NoteIR, ParseError, ParsedTitleResult, SectionIR, StatutoryNoteIR, TitleIR } from '../domain/model.js';
import { asArray, normalizeWhitespace, resolveKnownTitleHeading, sectionFileSafeId, titleDirectoryName } from '../domain/normalize.js';

const MAX_NORMALIZED_FIELD_LENGTH = 1_048_576;
const HIERARCHY_TAGS = ['subtitle', 'part', 'subpart', 'chapter', 'subchapter'] as const;
const SECTION_BODY_TAGS = ['subsection', 'paragraph', 'subparagraph', 'clause', 'subclause', 'item', 'subitem'] as const;

type HierarchyTag = typeof HIERARCHY_TAGS[number];
type SectionBodyTag = typeof SECTION_BODY_TAGS[number];

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

const preserveOrderParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  allowBooleanAttributes: false,
  removeNSPrefix: true,
  preserveOrder: true,
});

export function parseUslmToIr(xml: string, xmlPath?: string): ParsedTitleResult {
  const parseErrors: ParseError[] = [];
  const strippedXml = stripBom(xml);

  let document: { uslm?: { title?: XmlNode }; uscDoc?: { meta?: XmlNode; main?: { title?: XmlNode } } };
  let orderedDocument: OrderedEntry[];
  try {
    document = parser.parse(strippedXml) as { uslm?: { title?: XmlNode }; uscDoc?: { meta?: XmlNode; main?: { title?: XmlNode } } };
    orderedDocument = preserveOrderParser.parse(strippedXml) as OrderedEntry[];
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
  const orderedTitleNode = findOrderedTitleNode(orderedDocument);
  if (!titleNode || !orderedTitleNode) {
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
  const orderedSections = collectOrderedSectionNodes(orderedTitleNode);

  for (const [sectionIndex, { node: sectionNode, hierarchy }] of collectSectionNodes(titleNode).entries()) {
     const orderedSectionNode = orderedSections[sectionIndex];
    const sectionNumber = readCanonicalNumText(parseErrors, sectionNode.num, xmlPath, 'section number');
    const sectionHint = readNormalizedText(parseErrors, sectionNode.heading, xmlPath, 'section heading');
    const fallbackSectionNumber = sectionNumber || `uncodified-${++uncodifiedSectionIndex}`;

    const sectionParseErrors: ParseError[] = [];
    const parsedSection = parseSection(
      titleNumber,
      sectionNode,
      orderedSectionNode?.children,
      hierarchy,
      sectionParseErrors,
      xmlPath,
      fallbackSectionNumber,
    );
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
  subitem?: XmlNode | XmlNode[];
  'cross-reference'?: XmlNode | XmlNode[];
}

type XmlValue = string | number | boolean | XmlNode | Array<string | number | boolean | XmlNode>;

type OrderedEntryValue = string | number | boolean | OrderedEntry[];

type OrderedEntry = {
  ':@'?: Record<string, string>;
  [key: string]: OrderedEntryValue | Record<string, string> | undefined;
};

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

function findOrderedTitleNode(document: OrderedEntry[]): OrderedEntry[] | undefined {
  return findOrderedPath(document, ['uscDoc', 'main', 'title']) ?? findOrderedPath(document, ['uslm', 'title']);
}

function findOrderedPath(nodes: OrderedEntry[] | undefined, path: string[]): OrderedEntry[] | undefined {
  let current = nodes;

  for (const segment of path) {
    const entry = current?.find((node) => orderedEntryTag(node) === segment);
    const value = entry?.[segment];
    if (!Array.isArray(value)) {
      return undefined;
    }
    current = value;
  }

  return current;
}

function collectOrderedSectionNodes(titleNode: OrderedEntry[]): Array<{ children: OrderedEntry[]; hierarchy: HierarchyIR }> {
  const sections: Array<{ children: OrderedEntry[]; hierarchy: HierarchyIR }> = [];
  collectOrderedSectionNodesRecursive(titleNode, {}, sections);
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

function collectOrderedSectionNodesRecursive(
  nodes: OrderedEntry[],
  hierarchy: HierarchyIR,
  sections: Array<{ children: OrderedEntry[]; hierarchy: HierarchyIR }>,
): void {
  for (const entry of nodes) {
    const tag = orderedEntryTag(entry);
    if (!tag) {
      continue;
    }

    const value = entry[tag];
    if (!Array.isArray(value)) {
      continue;
    }

    if (HIERARCHY_TAGS.includes(tag as HierarchyTag)) {
      const number = readOrderedCanonicalNumEntry(orderedFindFirst(value, 'num'));
      const nextHierarchy = number ? { ...hierarchy, [tag]: cleanDecoratedNumText(number) } : { ...hierarchy };
      collectOrderedSectionNodesRecursive(value, nextHierarchy, sections);
      continue;
    }

    if (tag === 'section') {
      sections.push({ children: value, hierarchy });
      collectOrderedSectionNodesRecursive(value, hierarchy, sections);
      continue;
    }

    collectOrderedSectionNodesRecursive(value, hierarchy, sections);
  }
}

function parseSection(
  titleNumber: number,
  sectionNode: XmlNode,
  orderedSectionNode: OrderedEntry[] | undefined,
  hierarchy: HierarchyIR,
  parseErrors: ParseError[],
  xmlPath: string | undefined,
  fallbackSectionNumber?: string,
): SectionIR {
  const sectionNumber = readCanonicalNumText(parseErrors, sectionNode.num, xmlPath, 'section number') || fallbackSectionNumber || '';
  const source = optionalText(parseErrors, sectionNode.source, xmlPath, 'section source') ?? defaultSectionSource(titleNumber, sectionNumber);
  const parsedNotes = parseNotes(sectionNode, orderedSectionNode, parseErrors, xmlPath, sectionNumber);

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
    content: parseContent(sectionNode, orderedSectionNode, parseErrors, xmlPath, sectionNumber),
  };
}

function parseContent(
  node: XmlNode,
  orderedNode: OrderedEntry[] | undefined,
  parseErrors: ParseError[],
  xmlPath: string | undefined,
  sectionHint: string,
): ContentNode[] {
  if (orderedNode) {
    return parseContentOrdered(orderedNode, parseErrors, xmlPath, sectionHint);
  }

  const contentRoot = node.content ?? node;
  const content: ContentNode[] = [];

  for (const textNode of [...asArray(contentRoot.chapeau), ...asArray(contentRoot.continuation)]) {
    const text = readNodeText(parseErrors, textNode, xmlPath, sectionHint, 'section text');
    if (text) content.push({ type: 'text', text });
  }

  for (const tag of SECTION_BODY_TAGS) {
    content.push(...asArray(contentRoot[tag]).map((child) => parseLabeledNode(tag, child, parseErrors, xmlPath, sectionHint)));
  }

  if (content.length === 0) {
    const text = optionalText(parseErrors, contentRoot.p ?? contentRoot.text ?? contentRoot, xmlPath, 'section text', sectionHint);
    if (text) {
      content.push({ type: 'text', text });
    }
  }

  return content.filter((entry) => !(entry.type === 'text' && !entry.text));
}

function parseContentOrdered(
  orderedNode: OrderedEntry[],
  parseErrors: ParseError[],
  xmlPath: string | undefined,
  sectionHint: string,
): ContentNode[] {
  const contentEntry = orderedFindFirst(orderedNode, 'content');
  const contentRoot = contentEntry ? orderedChildArray(contentEntry, 'content') : orderedNode;

  return parseOrderedContentChildren(contentRoot, parseErrors, xmlPath, sectionHint);
}

function parseOrderedContentChildren(
  children: OrderedEntry[],
  parseErrors: ParseError[],
  xmlPath: string | undefined,
  sectionHint: string,
): ContentNode[] {
  const content: ContentNode[] = [];
  let inlineText: string | undefined;

  for (const entry of children) {
    const tag = orderedEntryTag(entry);
    if (!tag) {
      continue;
    }

    if (tag === 'chapeau' || tag === 'continuation') {
      const text = readOrderedNodeText(parseErrors, orderedChildArray(entry, tag), xmlPath, sectionHint, 'section text');
      if (text) {
        content.push({ type: 'text', text });
      }
      continue;
    }

    if (SECTION_BODY_TAGS.includes(tag as SectionBodyTag)) {
      content.push(parseLabeledNodeOrdered(tag as SectionBodyTag, entry, parseErrors, xmlPath, sectionHint));
      continue;
    }

    if (!inlineText && (tag === 'p' || tag === 'text' || tag === 'content')) {
      inlineText = readOrderedNodeText(parseErrors, orderedChildArray(entry, tag), xmlPath, sectionHint, 'section text');
    }
  }

  if (content.length === 0 && inlineText) {
    content.push({ type: 'text', text: inlineText });
  }

  return content.filter((entry) => !(entry.type === 'text' && !entry.text));
}

function parseLabeledNode(
  type: SectionBodyTag,
  node: XmlNode,
  parseErrors: ParseError[],
  xmlPath: string | undefined,
  sectionHint: string,
): ContentNode {
  const children: ContentNode[] = [];
  const inlineParts: string[] = [];

  for (const chapeauNode of asArray(node.chapeau)) {
    const text = readNodeText(parseErrors, chapeauNode, xmlPath, sectionHint, `${type} text`);
    if (text) inlineParts.push(text);
  }

  const inlineText = optionalText(parseErrors, node.content ?? node.text ?? node.p, xmlPath, `${type} text`, sectionHint);
  if (inlineText) {
    inlineParts.push(inlineText);
  }

  for (const tag of SECTION_BODY_TAGS) {
    children.push(...asArray(node[tag]).map((child) => parseLabeledNode(tag, child, parseErrors, xmlPath, sectionHint)));
  }

  for (const continuationNode of asArray(node.continuation)) {
    const text = readNodeText(parseErrors, continuationNode, xmlPath, sectionHint, `${type} text`);
    if (text) children.push({ type: 'text', text });
  }

  return {
    type,
    label: readCanonicalNumText(parseErrors, node.num, xmlPath, `${type} label`, sectionHint),
    heading: optionalText(parseErrors, node.heading, xmlPath, `${type} heading`, sectionHint),
    text: inlineParts.length > 0 ? inlineParts.join(' ') : undefined,
    children: children.filter((entry) => !(entry.type === 'text' && !entry.text)),
  };
}

function parseLabeledNodeOrdered(
  type: SectionBodyTag,
  entry: OrderedEntry,
  parseErrors: ParseError[],
  xmlPath: string | undefined,
  sectionHint: string,
): ContentNode {
  const children: ContentNode[] = [];
  const inlineParts: string[] = [];
  const nodeChildren = orderedChildArray(entry, type);
  let sawNestedChild = false;

  for (const child of nodeChildren) {
    const tag = orderedEntryTag(child);
    if (!tag) {
      continue;
    }

    if (tag === 'chapeau') {
      const text = readOrderedNodeText(parseErrors, orderedChildArray(child, tag), xmlPath, sectionHint, `${type} text`);
      if (text) {
        inlineParts.push(text);
      }
      continue;
    }

    if (SECTION_BODY_TAGS.includes(tag as SectionBodyTag)) {
      sawNestedChild = true;
      children.push(parseLabeledNodeOrdered(tag as SectionBodyTag, child, parseErrors, xmlPath, sectionHint));
      continue;
    }

    if (tag === 'continuation') {
      const text = readOrderedNodeText(parseErrors, orderedChildArray(child, tag), xmlPath, sectionHint, `${type} text`);
      if (text) {
        if (sawNestedChild) {
          children.push({ type: 'text', text });
        } else {
          inlineParts.push(text);
        }
      }
      continue;
    }

    if (tag === 'content' || tag === 'text' || tag === 'p') {
      const text = readOrderedNodeText(parseErrors, orderedChildArray(child, tag), xmlPath, sectionHint, `${type} text`);
      if (text) {
        inlineParts.push(text);
      }
    }
  }

  return {
    type,
    label: readOrderedCanonicalNumEntry(orderedFindFirst(nodeChildren, 'num')),
    heading: readOrderedOptionalText(parseErrors, orderedChildArrayFromChildren(nodeChildren, 'heading'), xmlPath, `${type} heading`, sectionHint),
    text: inlineParts.length > 0 ? inlineParts.join(' ') : undefined,
    children: children.filter((child) => !(child.type === 'text' && !child.text)),
  };
}

function parseNotes(
  sectionNode: XmlNode,
  orderedSectionNode: OrderedEntry[] | undefined,
  parseErrors: ParseError[],
  xmlPath: string | undefined,
  sectionHint: string,
): { sourceCredit?: string; statutoryNotes: StatutoryNoteIR[]; editorialNotes: NoteIR[] } {
  if (orderedSectionNode) {
    return parseNotesOrdered(orderedSectionNode, parseErrors, xmlPath, sectionHint);
  }

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
    const noteType = normalizeWhitespace(readRawText(notesNode['@_type'])) || undefined;

    for (const noteNode of asArray(notesNode.note)) {
      const text = readNodeText(parseErrors, noteNode, xmlPath, sectionHint, 'statutory note');
      if (!text) continue;
      statutoryNotes.push({
        heading: optionalText(parseErrors, noteNode.heading, xmlPath, 'statutory note heading', sectionHint),
        noteType,
        topic: normalizeWhitespace(readRawText(noteNode['@_topic'] ?? noteNode.type)) || undefined,
        text,
      });
    }
  }

  return { sourceCredit, statutoryNotes, editorialNotes };
}

function parseNotesOrdered(
  orderedSectionNode: OrderedEntry[],
  parseErrors: ParseError[],
  xmlPath: string | undefined,
  sectionHint: string,
): { sourceCredit?: string; statutoryNotes: StatutoryNoteIR[]; editorialNotes: NoteIR[] } {
  let sourceCredit = readOrderedSourceText(
    parseErrors,
    orderedChildArrayFromChildren(orderedSectionNode, 'sourceCredit'),
    xmlPath,
    'section source credit',
    sectionHint,
  );
  const statutoryNotes: StatutoryNoteIR[] = [];
  const editorialNotes: NoteIR[] = [];

  for (const noteEntry of orderedFindAll(orderedSectionNode, 'note')) {
    const text = readOrderedNodeText(parseErrors, orderedChildArray(noteEntry, 'note'), xmlPath, sectionHint, 'section note');
    if (!text) {
      continue;
    }

    const kind = normalizeOrderedWhitespace(readOrderedRawText(orderedChildArrayFromChildren(orderedChildArray(noteEntry, 'note'), 'type')));
    if (kind === 'source-credit') {
      sourceCredit ??= text;
      continue;
    }

    editorialNotes.push({
      kind: kind === 'editorial' || kind === 'cross-reference' ? kind : 'misc',
      text,
    });
  }

  for (const notesEntry of orderedFindAll(orderedSectionNode, 'notes')) {
    const noteType = normalizeOrderedWhitespace(orderedAttributes(notesEntry)?.['@_type']) || undefined;
    const notesChildren = orderedChildArray(notesEntry, 'notes');

    for (const noteEntry of orderedFindAll(notesChildren, 'note')) {
      const noteChildren = orderedChildArray(noteEntry, 'note');
      const bodyChildren = noteChildren.filter((child) => orderedEntryTag(child) !== 'heading');
      const text = readOrderedNodeText(parseErrors, bodyChildren, xmlPath, sectionHint, 'statutory note');
      if (!text) {
        continue;
      }

      statutoryNotes.push({
        heading: readOrderedOptionalText(parseErrors, orderedChildArrayFromChildren(noteChildren, 'heading'), xmlPath, 'statutory note heading', sectionHint),
        noteType,
        topic: normalizeOrderedWhitespace(orderedAttributes(noteEntry)?.['@_topic'] ?? readOrderedRawText(orderedChildArrayFromChildren(noteChildren, 'type'))) || undefined,
        text,
      });
    }
  }

  return { sourceCredit, statutoryNotes, editorialNotes };
}

function orderedEntryTag(entry: OrderedEntry): string | undefined {
  return Object.keys(entry).find((key) => key !== ':@');
}

function orderedAttributes(entry: OrderedEntry): Record<string, string> | undefined {
  return entry[':@'];
}

function orderedChildArray(entry: OrderedEntry, tag: string): OrderedEntry[] {
  const value = entry[tag];
  return Array.isArray(value) ? value : [];
}

function orderedFindFirst(children: OrderedEntry[], tag: string): OrderedEntry | undefined {
  return children.find((entry) => orderedEntryTag(entry) === tag);
}

function orderedFindAll(children: OrderedEntry[], tag: string): OrderedEntry[] {
  return children.filter((entry) => orderedEntryTag(entry) === tag);
}

function orderedChildArrayFromChildren(children: OrderedEntry[], tag: string): OrderedEntry[] | undefined {
  const entry = orderedFindFirst(children, tag);
  return entry ? orderedChildArray(entry, tag) : undefined;
}

function normalizeOrderedWhitespace(value: string | undefined): string {
  return (value ?? '').replace(/[\t\n\r\f\v ]+/gu, ' ').trim();
}

function readOrderedCanonicalNumEntry(entry: OrderedEntry | undefined): string {
  if (!entry) {
    return '';
  }

  const tag = orderedEntryTag(entry);
  if (!tag) {
    return '';
  }

  const valueAttribute = normalizeOrderedWhitespace(orderedAttributes(entry)?.['@_value']);
  if (valueAttribute) {
    return valueAttribute;
  }

  return cleanDecoratedNumText(normalizeOrderedWhitespace(readOrderedRawText(orderedChildArray(entry, tag))));
}

function readOrderedOptionalText(
  parseErrors: ParseError[],
  children: OrderedEntry[] | undefined,
  xmlPath: string | undefined,
  fieldName: string,
  sectionHint?: string,
): string | undefined {
  if (!children) {
    return undefined;
  }

  const text = readOrderedNodeText(parseErrors, children, xmlPath, sectionHint, fieldName);
  return text || undefined;
}

function readOrderedSourceText(
  parseErrors: ParseError[],
  children: OrderedEntry[] | undefined,
  xmlPath: string | undefined,
  fieldName: string,
  sectionHint?: string,
): string | undefined {
  if (!children) {
    return undefined;
  }

  const text = enforceNormalizedFieldLimit(
    parseErrors,
    normalizeOrderedWhitespace(readOrderedRawText(children)).replace(/(?<!§)§ /gu, '§ '),
    xmlPath,
    fieldName,
    sectionHint,
  );
  return text || undefined;
}

function readOrderedNodeText(
  parseErrors: ParseError[],
  children: OrderedEntry[] | undefined,
  xmlPath: string | undefined,
  sectionHint: string | undefined,
  fieldName: string,
): string {
  return enforceNormalizedFieldLimit(parseErrors, normalizeWhitespace(readOrderedRawText(children)), xmlPath, fieldName, sectionHint);
}

function readOrderedRawText(children: OrderedEntry[] | undefined): string {
  if (!children) {
    return '';
  }

  const parts: string[] = [];

  for (const entry of children) {
    const tag = orderedEntryTag(entry);
    if (!tag) {
      continue;
    }

    const value = entry[tag];
    if (tag === '#text') {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        parts.push(String(value));
      }
      continue;
    }

    if (!Array.isArray(value)) {
      continue;
    }

    const href = normalizeOrderedWhitespace(orderedAttributes(entry)?.['@_href']);
    const text = readOrderedRawText(value);
    if (!href) {
      parts.push(text);
      continue;
    }

    const label = normalizeOrderedWhitespace(text) || href;
    const markdownHref = hrefToMarkdownLink(href);
    parts.push(markdownHref ? `[${label}](${markdownHref})` : label);
  }

  return parts.join('');
}

function readRawText(value: XmlValue | undefined): string {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return normalizeWhitespace(value.map((entry) => readRawText(entry)).filter(Boolean).join(' '));
  }

  const node = value;
  const href = normalizeWhitespace(node['@_href']);
  const combined = normalizeWhitespace(readNodeTextInDocumentOrder(node));
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

function readNodeTextInDocumentOrder(node: XmlNode): string {
  const parts: string[] = [];

  for (const [key, entry] of Object.entries(node)) {
    if (key.startsWith('@_')) {
      continue;
    }

    if (entry === undefined || entry === null) {
      continue;
    }

    if (Array.isArray(entry)) {
      for (const child of entry) {
        const childText = readRawText(child);
        if (childText) {
          parts.push(childText);
        }
      }
      continue;
    }

    const childText = readRawText(entry as XmlValue);
    if (childText) {
      parts.push(childText);
    }
  }

  return parts.join(' ');
}

function hrefToMarkdownLink(href: string): string | null {
  const uscMatch = href.match(/^\/us\/usc\/t(\d+)\/s(.+)$/u);
  if (!uscMatch) {
    return null;
  }

  const titleNumber = Number.parseInt(uscMatch[1] ?? '0', 10);
  if (!Number.isFinite(titleNumber) || titleNumber <= 0) {
    return null;
  }

  const sectionTail = normalizeWhitespace(uscMatch[2]);
  if (!sectionTail) {
    return null;
  }

  // Collapse slash-separated subsection identifiers (e.g., "125/d" → "125d")
  // so that ref links match the canonical filenames generated from @value attributes
  const collapsedSection = sectionTail.replaceAll('/', '');
  const titleDirectory = titleDirectoryName({
    titleNumber,
    heading: resolveKnownTitleHeading(titleNumber),
  });
  return `../${titleDirectory}/section-${sectionFileSafeId(collapsedSection)}.md`;
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
