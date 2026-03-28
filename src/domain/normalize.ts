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

export function sectionFileSafeId(sectionNumber: string): string {
  return sectionNumber.replaceAll('/', '-');
}
