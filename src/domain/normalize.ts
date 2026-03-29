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
