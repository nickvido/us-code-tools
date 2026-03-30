export function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

export function normalizeWhitespace(value: string | undefined): string {
  return (value ?? '').replace(/\s+/gu, ' ').trim();
}

export function padTitleNumber(titleNumber: number): string {
  return String(titleNumber).padStart(2, '0');
}

export function slugifyTitleHeading(heading: string | undefined | null): string | null {
  const normalized = normalizeWhitespace(heading ?? undefined);
  if (!normalized) {
    return null;
  }

  const slug = normalized
    .toLowerCase()
    .replace(/['"“”‘’]/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');

  return slug || null;
}

export const SUPPORTED_APPENDIX_TITLE_NUMBERS = [5, 11, 18, 28, 50] as const;
export type SupportedAppendixTitleNumber = typeof SUPPORTED_APPENDIX_TITLE_NUMBERS[number];

export type TransformTitleSelector =
  | { kind: 'numeric'; value: number }
  | { kind: 'appendix'; value: SupportedAppendixTitleNumber; suffix: 'A' };

export interface NormalizedTitleTarget {
  selector: TransformTitleSelector;
  reportId: string;
  cacheKey: string;
  fixtureEnvKey: string;
  sourceXmlStem: string;
  outputDirectoryName: string;
  sourceUrlId: string;
  isReservedEmptyCandidate: boolean;
}

const APPENDIX_SELECTOR_SET = new Set<string>(SUPPORTED_APPENDIX_TITLE_NUMBERS.map((value) => `${value}A`));
const SUPPORTED_APPENDIX_SELECTOR_TEXT = SUPPORTED_APPENDIX_TITLE_NUMBERS.map((value) => `${value}A`).join(', ');

const KNOWN_TITLE_HEADINGS: Readonly<Record<number, string>> = {
  1: 'General Provisions',
  2: 'The Congress',
  3: 'The President',
  4: 'Flag and Seal, Seat of Government, and the States',
  5: 'Government Organization and Employees',
  6: 'Domestic Security',
  7: 'Agriculture',
  8: 'Aliens and Nationality',
  9: 'Arbitration',
  10: 'Armed Forces',
  11: 'Bankruptcy',
  12: 'Banks and Banking',
  13: 'Census',
  14: 'Coast Guard',
  15: 'Commerce and Trade',
  16: 'Conservation',
  17: 'Copyrights',
  18: 'Crimes and Criminal Procedure',
  19: 'Customs Duties',
  20: 'Education',
  21: 'Food and Drugs',
  22: 'Foreign Relations and Intercourse',
  23: 'Highways',
  24: 'Hospitals and Asylums',
  25: 'Indians',
  26: 'Internal Revenue Code',
  27: 'Intoxicating Liquors',
  28: 'Judiciary and Judicial Procedure',
  29: 'Labor',
  30: 'Mineral Lands and Mining',
  31: 'Money and Finance',
  32: 'National Guard',
  33: 'Navigation and Navigable Waters',
  34: 'Crime Control and Law Enforcement',
  35: 'Patents',
  36: 'Patriotic and National Observances, Ceremonies, and Organizations',
  37: 'Pay and Allowances of the Uniformed Services',
  38: 'Veterans Benefits',
  39: 'Postal Service',
  40: 'Public Buildings, Property, and Works',
  41: 'Public Contracts',
  42: 'The Public Health and Welfare',
  43: 'Public Lands',
  44: 'Public Printing and Documents',
  45: 'Railroads',
  46: 'Shipping',
  47: 'Telecommunications',
  48: 'Territories and Insular Possessions',
  49: 'Transportation',
  50: 'War and National Defense',
  51: 'National and Commercial Space Programs',
  52: 'Voting and Elections',
  54: 'National Park Service and Related Programs',
};

export function resolveKnownTitleHeading(titleNumber: number): string | undefined {
  return KNOWN_TITLE_HEADINGS[titleNumber];
}

export function titleDirectoryName(input: { titleNumber: number; heading?: string | null }): string {
  const baseName = `title-${padTitleNumber(input.titleNumber)}`;
  const headingSlug = slugifyTitleHeading(input.heading);

  return headingSlug ? `${baseName}-${headingSlug}` : baseName;
}

export function normalizeTitleSelector(rawSelector: string): NormalizedTitleTarget {
  const normalized = normalizeWhitespace(rawSelector).toUpperCase();
  if (!normalized) {
    throw new Error(`--title must be a numeric title between 1 and 54 (1 and 54 inclusive) or one of the appendix selectors: ${SUPPORTED_APPENDIX_SELECTOR_TEXT}`);
  }

  if (/^\d+A$/u.test(normalized)) {
    if (!APPENDIX_SELECTOR_SET.has(normalized)) {
      throw new Error(`Unsupported appendix selector '${rawSelector}'. Accepted appendix selectors: ${SUPPORTED_APPENDIX_SELECTOR_TEXT}`);
    }

    const numericValue = Number.parseInt(normalized.slice(0, -1), 10) as SupportedAppendixTitleNumber;
    const paddedValue = padTitleNumber(numericValue);

    return {
      selector: { kind: 'appendix', value: numericValue, suffix: 'A' },
      reportId: `${numericValue}A`,
      cacheKey: `${paddedValue}A`,
      fixtureEnvKey: `${paddedValue}A`,
      sourceXmlStem: `usc${paddedValue}A`,
      outputDirectoryName: `title-${paddedValue.toLowerCase()}a-appendix`,
      sourceUrlId: `${paddedValue}A`,
      isReservedEmptyCandidate: false,
    };
  }

  if (!/^\d+$/u.test(normalized)) {
    throw new Error(`--title must be a numeric title between 1 and 54 (1 and 54 inclusive) or one of the appendix selectors: ${SUPPORTED_APPENDIX_SELECTOR_TEXT}`);
  }

  const numericValue = Number.parseInt(normalized, 10);
  if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > 54) {
    throw new Error(`--title must be a numeric title between 1 and 54 (1 and 54 inclusive) or one of the appendix selectors: ${SUPPORTED_APPENDIX_SELECTOR_TEXT}`);
  }

  const paddedValue = padTitleNumber(numericValue);
  return {
    selector: { kind: 'numeric', value: numericValue },
    reportId: String(numericValue),
    cacheKey: paddedValue,
    fixtureEnvKey: paddedValue,
    sourceXmlStem: `usc${paddedValue}`,
    outputDirectoryName: `title-${paddedValue}`,
    sourceUrlId: paddedValue,
    isReservedEmptyCandidate: numericValue === 53,
  };
}

export function allTransformTitleTargets(): NormalizedTitleTarget[] {
  const numericTargets = Array.from({ length: 54 }, (_, index) => normalizeTitleSelector(String(index + 1)));
  const appendixTargets = SUPPORTED_APPENDIX_TITLE_NUMBERS.map((value) => normalizeTitleSelector(`${value}A`));
  return [...numericTargets, ...appendixTargets];
}

export interface SplitSectionNumber {
  numeric: number;
  suffix: string;
}

export function splitSectionNumber(sectionNumber: string): SplitSectionNumber {
  const normalized = sectionNumber.trim().replaceAll('/', '-');
  const match = normalized.match(/^(\d+)(.*)$/u);
  if (!match) {
    return { numeric: 0, suffix: normalized };
  }

  return {
    numeric: Number.parseInt(match[1] ?? '0', 10),
    suffix: match[2] ?? '',
  };
}

export function compareSectionNumbers(left: string, right: string): number {
  const leftParts = splitSectionNumber(left);
  const rightParts = splitSectionNumber(right);

  if (leftParts.numeric !== rightParts.numeric) {
    return leftParts.numeric - rightParts.numeric;
  }

  if (leftParts.suffix < rightParts.suffix) return -1;
  if (leftParts.suffix > rightParts.suffix) return 1;
  return 0;
}

export function sectionFileSafeId(sectionNumber: string): string {
  const { numeric, suffix } = splitSectionNumber(sectionNumber);
  return `${String(numeric).padStart(5, '0')}${suffix.replaceAll('/', '-')}`;
}

export function embeddedSectionAnchor(sectionNumber: string): string {
  const normalized = normalizeWhitespace(sectionNumber)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');

  return `section-${normalized || 'unknown'}`;
}

export function buildCanonicalSectionUrl(titleNumber: number, sectionNumber: string): string {
  return `https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title${titleNumber}-section${sectionNumber}`;
}

export function sortSections<T extends { sectionNumber: string }>(sections: T[]): T[] {
  return [...sections].sort((left, right) => compareSectionNumbers(left.sectionNumber, right.sectionNumber));
}

export function chapterFileSafeId(chapter: string): string {
  const trimmed = chapter.trim();
  if (/^\d+$/u.test(trimmed)) {
    return trimmed.padStart(3, '0');
  }

  const normalized = trimmed
    .replace(/[^A-Za-z0-9]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
    .toLowerCase();

  return normalized || 'unnamed';
}

export function normalizeDescriptiveSlug(input: string | undefined): string {
  const normalized = normalizeWhitespace(input);
  if (!normalized) {
    return '';
  }

  return normalized
    .toLowerCase()
    .replace(/['"“”‘’]/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');
}

export function descriptiveChapterOutputFilename(chapter: string, heading?: string): string {
  const safeChapterId = chapterFileSafeId(chapter);
  const headingSlug = normalizeDescriptiveSlug(heading);
  return headingSlug ? `chapter-${safeChapterId}-${headingSlug}.md` : `chapter-${safeChapterId}.md`;
}

export function chapterOutputFilename(chapter: string, heading?: string): string {
  return descriptiveChapterOutputFilename(chapter, heading);
}

export function compareChapterIdentifiers(left: string, right: string): number {
  const leftTrimmed = left.trim();
  const rightTrimmed = right.trim();
  const leftIsNumeric = /^\d+$/u.test(leftTrimmed);
  const rightIsNumeric = /^\d+$/u.test(rightTrimmed);

  if (leftIsNumeric && rightIsNumeric) {
    return Number.parseInt(leftTrimmed, 10) - Number.parseInt(rightTrimmed, 10);
  }

  if (leftIsNumeric !== rightIsNumeric) {
    return leftIsNumeric ? -1 : 1;
  }

  const leftSafeId = chapterFileSafeId(leftTrimmed);
  const rightSafeId = chapterFileSafeId(rightTrimmed);

  if (leftSafeId < rightSafeId) return -1;
  if (leftSafeId > rightSafeId) return 1;
  if (leftTrimmed < rightTrimmed) return -1;
  if (leftTrimmed > rightTrimmed) return 1;
  return 0;
}
