import { XMLParser } from 'fast-xml-parser';
import type { ContentNode, NoteIR, ParseError, ParsedTitleResult, SectionIR, TitleIR } from '../domain/model.js';
import { asArray, normalizeWhitespace } from '../domain/normalize.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  allowBooleanAttributes: false,
});

export function parseUslmToIr(xml: string, xmlPath?: string): ParsedTitleResult {
  const parseErrors: ParseError[] = [];
  const document = parser.parse(stripBom(xml)) as { uslm?: { title?: XmlNode } };
  const titleNode = document.uslm?.title;

  if (!titleNode) {
    return {
      titleIr: emptyTitleIr(),
      parseErrors: [{ code: 'INVALID_XML', message: 'Missing <title> root element', xmlPath }],
    };
  }

  const titleNumber = Number(normalizeWhitespace(readText(titleNode.num))) || 0;
  const heading = normalizeWhitespace(readText(titleNode.heading));
  const titleIr: TitleIR = {
    titleNumber,
    heading,
    positiveLaw: null,
    chapters: asArray(titleNode.chapter).map((chapter) => ({
      number: normalizeWhitespace(readText(chapter.num)),
      heading: normalizeWhitespace(readText(chapter.heading)),
    })),
    sections: [],
    sourceUrlTemplate: `https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title${titleNumber}-section{section}`,
  };

  for (const sectionNode of collectSectionNodes(titleNode)) {
    const sectionNumber = normalizeWhitespace(readText(sectionNode.num));
    if (!sectionNumber) {
      parseErrors.push({
        code: 'MISSING_SECTION_NUMBER',
        message: 'Section omitted because identifier is missing',
        xmlPath,
        sectionHint: normalizeWhitespace(readText(sectionNode.heading)),
      });
      continue;
    }

    titleIr.sections.push(parseSection(titleNumber, sectionNode));
  }

  return { titleIr, parseErrors };
}

interface XmlNode {
  num?: XmlValue;
  heading?: XmlValue;
  status?: XmlValue;
  source?: XmlValue;
  enacted?: XmlValue;
  'public-law'?: XmlValue;
  'last-amended'?: XmlValue;
  'last-amended-by'?: XmlValue;
  text?: XmlValue;
  xref?: XmlValue;
  type?: XmlValue;
  chapter?: XmlNode | XmlNode[];
  section?: XmlNode | XmlNode[];
  subsection?: XmlNode | XmlNode[];
  paragraph?: XmlNode | XmlNode[];
  subparagraph?: XmlNode | XmlNode[];
  clause?: XmlNode | XmlNode[];
  item?: XmlNode | XmlNode[];
  note?: XmlNode | XmlNode[];
  'cross-reference'?: XmlNode | XmlNode[];
}

type XmlValue = string | number | boolean | XmlNode | Array<string | number | boolean | XmlNode>;

function collectSectionNodes(titleNode: XmlNode): XmlNode[] {
  return [
    ...asArray(titleNode.section),
    ...asArray(titleNode.chapter).flatMap((chapter) => asArray(chapter.section)),
  ];
}

function parseSection(titleNumber: number, sectionNode: XmlNode): SectionIR {
  const sectionNumber = normalizeWhitespace(readText(sectionNode.num));
  const source = normalizeWhitespace(readText(sectionNode.source)) || defaultSectionSource(titleNumber, sectionNumber);

  return {
    titleNumber,
    sectionNumber,
    heading: normalizeWhitespace(readText(sectionNode.heading)),
    status: normalizeStatus(readText(sectionNode.status)),
    source,
    enacted: optionalText(sectionNode.enacted),
    publicLaw: optionalText(sectionNode['public-law']),
    lastAmended: optionalText(sectionNode['last-amended']),
    lastAmendedBy: optionalText(sectionNode['last-amended-by']),
    editorialNotes: parseNotes(sectionNode),
    content: parseContent(sectionNode),
  };
}

function parseContent(node: XmlNode): ContentNode[] {
  const content: ContentNode[] = [];
  content.push(...asArray(node.subsection).map((child) => parseLabeledNode('subsection', child)));
  content.push(...asArray(node.paragraph).map((child) => parseLabeledNode('paragraph', child)));
  content.push(...asArray(node['cross-reference']).map((child) => ({ type: 'text', text: normalizeWhitespace(readText(child.text) || readText(child)) } as const)));
  return content.filter((entry) => !(entry.type === 'text' && !entry.text));
}

function parseLabeledNode(type: 'subsection' | 'paragraph' | 'subparagraph' | 'clause' | 'item', node: XmlNode): ContentNode {
  const children: ContentNode[] = [];
  children.push(...asArray(node.subsection).map((child) => parseLabeledNode('subsection', child)));
  children.push(...asArray(node.paragraph).map((child) => parseLabeledNode('paragraph', child)));
  children.push(...asArray(node.subparagraph).map((child) => parseLabeledNode('subparagraph', child)));
  children.push(...asArray(node.clause).map((child) => parseLabeledNode('clause', child)));
  children.push(...asArray(node.item).map((child) => parseLabeledNode('item', child)));
  children.push(...asArray(node.note).map((child) => ({ type: 'text', text: normalizeWhitespace(readText(child.text)) } as const)));
  children.push(...asArray(node['cross-reference']).map((child) => ({ type: 'text', text: normalizeWhitespace(readText(child.text) || readText(child)) } as const)));

  return {
    type,
    label: normalizeWhitespace(readText(node.num)),
    heading: optionalText(node.heading),
    text: optionalText(node.text),
    children: children.filter((entry) => !(entry.type === 'text' && !entry.text)),
  };
}

function parseNotes(sectionNode: XmlNode): NoteIR[] {
  const notes: NoteIR[] = [];
  for (const noteNode of asArray(sectionNode.note)) {
    const text = normalizeWhitespace(readText(noteNode.text));
    if (text) {
      notes.push({ kind: normalizeNoteKind(readText(noteNode.type)), text });
    }
  }
  for (const crossReference of asArray(sectionNode['cross-reference'])) {
    const text = normalizeWhitespace(readText(crossReference.text) || readText(crossReference));
    if (text) {
      notes.push({ kind: 'cross-reference', text });
    }
  }
  return notes;
}

function readText(value: XmlValue | undefined): string {
  if (value === undefined) {
    return '';
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => readText(entry)).join(' ');
  }

  const node = value as XmlNode;
  const pieces = [
    node.text,
    node.xref,
    node.heading,
    node.num,
  ].map((entry) => readText(entry)).filter(Boolean);

  return pieces.join(' ');
}

function optionalText(value: XmlValue | undefined): string | undefined {
  const text = normalizeWhitespace(readText(value));
  return text || undefined;
}

function normalizeStatus(value: string): SectionIR['status'] {
  const normalized = normalizeWhitespace(value);
  if (normalized === 'repealed' || normalized === 'transferred' || normalized === 'omitted') {
    return normalized;
  }
  return 'in-force';
}

function normalizeNoteKind(value: string): NoteIR['kind'] {
  const normalized = normalizeWhitespace(value);
  if (normalized === 'editorial' || normalized === 'cross-reference' || normalized === 'source-credit') {
    return normalized;
  }
  return 'misc';
}

function defaultSectionSource(titleNumber: number, sectionNumber: string): string {
  return `https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title${titleNumber}-section${sectionNumber}`;
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
