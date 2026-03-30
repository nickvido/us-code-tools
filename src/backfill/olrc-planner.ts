import type { BackfillFileWrite, HistoricalEvent } from './planner.js';

export interface OlrcVintageEntry {
  vintage: string;
  congress: number;
  lawNumber: number;
  year: number;
  /** ISO date string (YYYY-MM-DD) for the author date */
  releaseDate: string;
  /** If true, tag with congress/<N> (last release of that congress) */
  congressBoundary: boolean;
}

/**
 * Known OLRC annual release points with approximate dates.
 * Vintages are keyed as `{congress}-{law}`.
 */
export const KNOWN_VINTAGES: OlrcVintageEntry[] = [
  { vintage: '113-4',   congress: 113, lawNumber: 4,   year: 2013, releaseDate: '2013-06-01', congressBoundary: false },
  { vintage: '113-163', congress: 113, lawNumber: 163, year: 2014, releaseDate: '2014-06-01', congressBoundary: false },
  { vintage: '114-38',  congress: 114, lawNumber: 38,  year: 2015, releaseDate: '2015-12-01', congressBoundary: true },
  { vintage: '114-219', congress: 114, lawNumber: 219, year: 2016, releaseDate: '2016-12-01', congressBoundary: false },
  { vintage: '115-97',  congress: 115, lawNumber: 97,  year: 2017, releaseDate: '2017-12-22', congressBoundary: true },
  { vintage: '115-232', congress: 115, lawNumber: 232, year: 2018, releaseDate: '2018-08-13', congressBoundary: false },
  { vintage: '116-91',  congress: 116, lawNumber: 91,  year: 2019, releaseDate: '2019-12-20', congressBoundary: true },
  { vintage: '116-260', congress: 116, lawNumber: 260, year: 2020, releaseDate: '2020-12-27', congressBoundary: false },
  { vintage: '117-2',   congress: 117, lawNumber: 2,   year: 2021, releaseDate: '2021-03-11', congressBoundary: false },
  { vintage: '117-81',  congress: 117, lawNumber: 81,  year: 2021, releaseDate: '2021-11-15', congressBoundary: false },
  { vintage: '117-103', congress: 117, lawNumber: 103, year: 2022, releaseDate: '2022-03-15', congressBoundary: false },
  { vintage: '117-163', congress: 117, lawNumber: 163, year: 2022, releaseDate: '2022-08-09', congressBoundary: false },
  { vintage: '117-328', congress: 117, lawNumber: 328, year: 2023, releaseDate: '2023-01-03', congressBoundary: true },
  { vintage: '118-200', congress: 118, lawNumber: 200, year: 2024, releaseDate: '2024-12-23', congressBoundary: true },
  { vintage: '119-73',  congress: 119, lawNumber: 73,  year: 2025, releaseDate: '2025-03-14', congressBoundary: false },
];

export interface OlrcBackfillPlan {
  vintages: OlrcVintageEntry[];
  tags: Map<string, string>; // tag name → vintage
}

export function resolveVintageEntry(vintage: string): OlrcVintageEntry | undefined {
  return KNOWN_VINTAGES.find((v) => v.vintage === vintage);
}

export function buildOlrcBackfillPlan(vintageIds: string[]): OlrcBackfillPlan {
  const entries: OlrcVintageEntry[] = [];
  const tags = new Map<string, string>();

  for (const id of vintageIds) {
    const entry = resolveVintageEntry(id);
    if (!entry) {
      throw new Error(`Unknown vintage '${id}'; known vintages: ${KNOWN_VINTAGES.map((v) => v.vintage).join(', ')}`);
    }
    entries.push(entry);
  }

  // Sort by release date
  entries.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));

  // Assign tags
  for (const entry of entries) {
    tags.set(`annual/${entry.year}`, entry.vintage);
    if (entry.congressBoundary) {
      tags.set(`congress/${entry.congress}`, entry.vintage);
    }
  }

  return { vintages: entries, tags };
}

export function buildOlrcCommitMessage(entry: OlrcVintageEntry): string {
  return `Update US Code through Public Law ${entry.congress}-${entry.lawNumber}\n\nRelease point: ${entry.vintage}\nYear: ${entry.year}`;
}
