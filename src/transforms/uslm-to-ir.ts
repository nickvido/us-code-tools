import { XMLParser } from 'fast-xml-parser';
import type { ContentNode, NoteIR, ParseError, ParsedTitleResult, SectionIR, TitleIR } from '../domain/model.js';
import { asArray, normalizeWhitespace } from '../domain/normalize.js';

const MAX_NORMALIZED_FIELD_LENGTH = 1_048_576;

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

  let document: { uslm?: { title?: XmlNode }; uscDoc?: { main?: { title?: XmlNode } } };
  try {
    document = parser.parse(stripBom(xml)) as { uslm?: { title?: XmlNode }; uscDoc?: { main?: { title?: XmlNode } } };
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
  const titleIr: TitleIR = {
    titleNumber,
    heading,
    positiveLaw: null,
    chapters: asArray(titleNode.chapter).map((chapter) => ({
      number: readCanonicalNumText(parseErrors, chapter.num, xmlPath, 'chapter number'),
      heading: readNormalizedText(parseErrors, chapter.heading, xmlPath, 'chapter heading'),
    })),
    sections: [],
    sourceUrlTemplate: `https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title${titleNumber}-section{section}`,
  };

  for (const sectionNode of collectSectionNodes(titleNode)) {
    const sectionNumber = readCanonicalNumText(parseErrors, sectionNode.num, xmlPath, 'section number');
    const sectionHint = readNormalizedText(parseErrors, sectionNode.heading, xmlPath, 'section heading');

    if (!sectionNumber) {
      parseErrors.push({
        code: 'MISSING_SECTION_NUMBER',
        message: 'Section omitted because identifier is missing',
        xmlPath,
        sectionHint,
      });
      continue;
    }

    const sectionParseErrors: ParseError[] = [];
    const parsedSection = parseSection(titleNumber, sectionNode, sectionParseErrors, xmlPath);

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

function parseSection(
  titleNumber: number,
  sectionNode: XmlNode,
  parseErrors: ParseError[],
  xmlPath?: string,
): SectionIR {
  const sectionNumber = readCanonicalNumText(parseErrors, sectionNode.num, xmlPath, 'section number');
  const source = optionalText(parseErrors, sectionNode.source, xmlPath, 'section source')
    ?? defaultSectionSource(titleNumber, sectionNumber);
  const parsedNotes = parseNotes(sectionNode, parseErrors, xmlPath, sectionNumber);

  return {
    titleNumber,
    sectionNumber,
    heading: readNormalizedText(parseErrors, sectionNode.heading, xmlPath, 'section heading'),
    status: normalizeStatus(readRawText(sectionNode.status)),
    source,
    enacted: optionalText(parseErrors, sectionNode.enacted, xmlPath, 'section enacted'),
    publicLaw: optionalText(parseErrors, sectionNode['public-law'], xmlPath, 'section public law'),
    lastAmended: optionalText(parseErrors, sectionNode['last-amended'], xmlPath, 'section last amended'),
    lastAmendedBy: optionalText(parseErrors, sectionNode['last-amended-by'], xmlPath, 'section last amended by'),
    sourceCredits: parsedNotes.sourceCredits,
    editorialNotes: parsedNotes.editorialNotes,
    content: parseContent(sectionNode, parseErrors, xmlPath, sectionNumber),
  };
}

function parseContent(
  node: XmlNode,
  parseErrors: ParseError[],
  xmlPath: string | undefined,
  sectionHint: string,
): ContentNode[] {
  const contentRoot = node.content ?? node;
  const content: ContentNode[] = [];
  content.push(...asArray(contentRoot.subsection).map((child) => parseLabeledNode('subsection', child, parseErrors, xmlPath, sectionHint)));
  content.push(...asArray(contentRoot.paragraph).map((child) => parseLabeledNode('paragraph', child, parseErrors, xmlPath, sectionHint)));
  content.push(
    ...asArray(contentRoot['cross-reference']).map((child) => ({
      type: 'text',
      text: readNodeText(parseErrors, child, xmlPath, sectionHint, 'cross-reference'),
    } as const)),
  );
  if (content.length === 0) {
    const text = optionalText(parseErrors, contentRoot.p ?? contentRoot.text, xmlPath, 'section text', sectionHint);
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
  children.push(...asArray(node.subsection).map((child) => parseLabeledNode('subsection', child, parseErrors, xmlPath, sectionHint)));
  children.push(...asArray(node.paragraph).map((child) => parseLabeledNode('paragraph', child, parseErrors, xmlPath, sectionHint)));
  children.push(...asArray(node.subparagraph).map((child) => parseLabeledNode('subparagraph', child, parseErrors, xmlPath, sectionHint)));
  children.push(...asArray(node.clause).map((child) => parseLabeledNode('clause', child, parseErrors, xmlPath, sectionHint)));
  children.push(...asArray(node.item).map((child) => parseLabeledNode('item', child, parseErrors, xmlPath, sectionHint)));
  children.push(
    ...asArray(node.note).map((child) => ({
      type: 'text',
      text: optionalText(parseErrors, child.text, xmlPath, `${type} note`, sectionHint) ?? '',
    } as const)),
  );
  children.push(
    ...asArray(node['cross-reference']).map((child) => ({
      type: 'text',
      text: readNodeText(parseErrors, child, xmlPath, sectionHint, `${type} cross-reference`),
    } as const)),
  );

  return {
    type,
    label: readNormalizedText(parseErrors, node.num, xmlPath, `${type} label`, sectionHint),
    heading: optionalText(parseErrors, node.heading, xmlPath, `${type} heading`, sectionHint),
    text: optionalText(parseErrors, node.text, xmlPath, `${type} text`, sectionHint),
    children: children.filter((entry) => !(entry.type === 'text' && !entry.text)),
  };
}

function parseNotes(
  sectionNode: XmlNode,
  parseErrors: ParseError[],
  xmlPath: string | undefined,
  sectionHint: string,
): { sourceCredits: string[]; editorialNotes: NoteIR[] } {
  const sourceCredits: string[] = [];
  const editorialNotes: NoteIR[] = [];

  for (const noteNode of asArray(sectionNode.note)) {
    const text = optionalText(parseErrors, noteNode.text, xmlPath, 'section note', sectionHint);
    if (!text) {
      continue;
    }

    const kind = normalizeNoteKind(readRawText(noteNode.type));
    if (kind === 'source-credit') {
      sourceCredits.push(text);
      continue;
    }

    editorialNotes.push({ kind, text });
  }

  for (const crossReference of asArray(sectionNode['cross-reference'])) {
    const text = readNodeText(parseErrors, crossReference, xmlPath, sectionHint, 'section cross-reference');
    if (text) {
      editorialNotes.push({ kind: 'cross-reference', text });
    }
  }

  return { sourceCredits, editorialNotes };
}

function readRawText(value: XmlValue | undefined): string {
  if (value === undefined) {
    return '';
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => readRawText(entry)).join(' ');
  }

  const node = value;
  const pieces = [node['#text'], node.text, node.p, node.xref, node.heading, node.num, node.content]
    .map((entry) => readRawText(entry))
    .filter(Boolean);

  return pieces.join(' ');
}

function readCanonicalNumText(
  parseErrors: ParseError[],
  value: XmlValue | undefined,
  xmlPath: string | undefined,
  fieldName: string,
  sectionHint?: string,
): string {
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
    .replace(/^Chapter\s+/iu, '')
    .replace(/[.]+$/u, '')
    .replace(/[—]+$/u, '')
    .trim();
}

function readNormalizedText(
  parseErrors: ParseError[],
  value: XmlValue | undefined,
  xmlPath: string | undefined,
  fieldName: string,
  sectionHint?: string,
): string {
  return enforceNormalizedFieldLimit(
    parseErrors,
    normalizeWhitespace(readRawText(value)),
    xmlPath,
    fieldName,
    sectionHint,
  );
}

function enforceNormalizedFieldLimit(
  parseErrors: ParseError[],
  text: string,
  xmlPath: string | undefined,
  fieldName: string,
  sectionHint?: string,
): string {
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

function readNodeText(
  parseErrors: ParseError[],
  node: XmlNode,
  xmlPath: string | undefined,
  sectionHint: string,
  fieldName: string,
): string {
  return readNormalizedText(parseErrors, node.text ?? node, xmlPath, fieldName, sectionHint);
}

function optionalText(
  parseErrors: ParseError[],
  value: XmlValue | undefined,
  xmlPath: string | undefined,
  fieldName: string,
  sectionHint?: string,
): string | undefined {
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

function parseTitleNumber(value: string): number {
  const direct = Number(value);
  if (Number.isInteger(direct) && direct > 0) {
    return direct;
  }

  const match = value.match(/(\d+)/);
  return match ? Number.parseInt(match[1] ?? '0', 10) : 0;
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
