export function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

export function normalizeWhitespace(value: string | undefined): string {
  return (value ?? '').replace(/\s+/gu, ' ').trim()
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

  // Use codepoint comparison for deterministic ordering:
  // uppercase before lowercase (A < a), so 106A < 106a
  if (leftParts.suffix < rightParts.suffix) return -1;
  if (leftParts.suffix > rightParts.suffix) return 1;
  return 0;
}

export function sectionFileSafeId(sectionNumber: string): string {
  const { numeric, suffix } = splitSectionNumber(sectionNumber);
  return `${String(numeric).padStart(5, '0')}${suffix.replaceAll('/', '-')}`;
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

export function chapterOutputFilename(chapter: string): string {
  return `chapter-${chapterFileSafeId(chapter)}.md`;
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
