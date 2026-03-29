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
