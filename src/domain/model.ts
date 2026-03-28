export type SectionStatus = 'in-force' | 'repealed' | 'transferred' | 'omitted';

export interface ParseError {
  code: 'MISSING_SECTION_NUMBER' | 'INVALID_XML' | 'UNSUPPORTED_STRUCTURE' | 'EMPTY_SECTION' | 'OUTPUT_WRITE_FAILED';
  message: string;
  xmlPath?: string;
  sectionHint?: string;
}

export interface ParseReport {
  sectionsFound: number;
  filesWritten: number;
  parseErrors: ParseError[];
}

export interface ChapterIR {
  number: string;
  heading: string;
}

export interface NoteIR {
  kind: 'editorial' | 'cross-reference' | 'source-credit' | 'misc';
  text: string;
}

interface BaseLabeledNode {
  type: 'subsection' | 'paragraph' | 'subparagraph' | 'clause' | 'item';
  label: string;
  heading?: string;
  text?: string;
  children: ContentNode[];
}

export interface SubsectionNode extends BaseLabeledNode { type: 'subsection'; }
export interface ParagraphNode extends BaseLabeledNode { type: 'paragraph'; }
export interface SubparagraphNode extends BaseLabeledNode { type: 'subparagraph'; }
export interface ClauseNode extends BaseLabeledNode { type: 'clause'; }
export interface ItemNode extends BaseLabeledNode { type: 'item'; }

export interface TextBlockNode {
  type: 'text';
  text: string;
}

export type ContentNode = SubsectionNode | ParagraphNode | SubparagraphNode | ClauseNode | ItemNode | TextBlockNode;

export interface SectionIR {
  titleNumber: number;
  sectionNumber: string;
  heading: string;
  status: SectionStatus;
  source: string;
  enacted?: string;
  publicLaw?: string;
  lastAmended?: string;
  lastAmendedBy?: string;
  sourceCredits?: string[];
  editorialNotes?: NoteIR[];
  content: ContentNode[];
}

export interface TitleIR {
  titleNumber: number;
  heading: string;
  positiveLaw: boolean | null;
  chapters: ChapterIR[];
  sections: SectionIR[];
  sourceUrlTemplate: string;
}

export interface ParsedTitleResult {
  titleIr: TitleIR;
  parseErrors: ParseError[];
}

export interface XmlEntry {
  xmlPath: string;
  xml: string;
}
