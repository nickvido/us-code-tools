export function renderCongressOrdinal(congress: number): string {
  const remainder100 = congress % 100;
  if (remainder100 >= 11 && remainder100 <= 13) {
    return `${congress}th`;
  }

  const remainder10 = congress % 10;
  if (remainder10 === 1) return `${congress}st`;
  if (remainder10 === 2) return `${congress}nd`;
  if (remainder10 === 3) return `${congress}rd`;
  return `${congress}th`;
}

export function getCongressYearRange(congress: number): { startYear: number; endYear: number } {
  const startYear = ((congress - 1) * 2) + 1789;
  return { startYear, endYear: startYear + 1 };
}

export function renderCongressTitle(congress: number): string {
  const { startYear, endYear } = getCongressYearRange(congress);
  return `${renderCongressOrdinal(congress)} Congress (${startYear}–${endYear})`;
}
