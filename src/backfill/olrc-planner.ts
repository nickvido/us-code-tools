import type { BackfillFileWrite, HistoricalEvent } from './planner.js';

export interface OlrcVintageEntry {
  vintage: string;
  congress: number;
  lawNumber: string;
  year: number;
  /** ISO date string (YYYY-MM-DD) for the author date */
  releaseDate: string;
  /** If true, tag with congress/<N> (last release of that congress) */
  congressBoundary: boolean;
}

/**
 * Known OLRC release points sourced from
 * https://uscode.house.gov/download/priorreleasepoints.htm
 *
 * Each entry uses the actual OLRC release-point identifier (which may differ
 * from the public-law number the site advertises on the main download page).
 *
 * Vintages are keyed as `{congress}-{lawId}` where lawId matches the OLRC
 * path component (e.g. `113-296`, `117-81`, `115-442`).
 *
 * We pick ~2 snapshots per congress: one early and one end-of-congress.
 */
export const KNOWN_VINTAGES: OlrcVintageEntry[] = [
  // 113th Congress (2013–2015)
  { vintage: '113-21',  congress: 113, lawNumber: '21',  year: 2013, releaseDate: '2013-06-15', congressBoundary: false },
  { vintage: '113-296', congress: 113, lawNumber: '296', year: 2014, releaseDate: '2014-12-19', congressBoundary: true },

  // 114th Congress (2015–2017)
  { vintage: '114-38',  congress: 114, lawNumber: '38',  year: 2015, releaseDate: '2015-07-30', congressBoundary: false },
  { vintage: '114-329', congress: 114, lawNumber: '329', year: 2017, releaseDate: '2017-01-03', congressBoundary: true },

  // 115th Congress (2017–2019)
  { vintage: '115-51',  congress: 115, lawNumber: '51',  year: 2017, releaseDate: '2017-08-14', congressBoundary: false },
  { vintage: '115-442', congress: 115, lawNumber: '442', year: 2019, releaseDate: '2019-01-03', congressBoundary: true },

  // 116th Congress (2019–2021)
  { vintage: '116-91',  congress: 116, lawNumber: '91',  year: 2019, releaseDate: '2019-12-20', congressBoundary: false },
  { vintage: '116-344', congress: 116, lawNumber: '344', year: 2021, releaseDate: '2021-01-03', congressBoundary: true },

  // 117th Congress (2021–2023)
  { vintage: '117-81',  congress: 117, lawNumber: '81',  year: 2021, releaseDate: '2021-11-15', congressBoundary: false },
  { vintage: '117-262', congress: 117, lawNumber: '262', year: 2022, releaseDate: '2022-12-22', congressBoundary: true },

  // 118th Congress (2023–2025)
  { vintage: '118-82',  congress: 118, lawNumber: '82',  year: 2024, releaseDate: '2024-01-29', congressBoundary: false },
  { vintage: '118-158', congress: 118, lawNumber: '158', year: 2024, releaseDate: '2024-12-23', congressBoundary: true },

  // 119th Congress (2025–)
  { vintage: '119-73',  congress: 119, lawNumber: '73',  year: 2025, releaseDate: '2025-03-14', congressBoundary: false },
];

export interface OlrcBackfillPlan {
  vintages: OlrcVintageEntry[];
  tags: Map<string, string>; // tag name → vintage
}

export function resolveVintageEntry(vintage: string): OlrcVintageEntry | undefined {
  return KNOWN_VINTAGES.find((v) => v.vintage === vintage);
}

/**
 * Build the OLRC download URL for a given vintage and title.
 */
export function buildOlrcDownloadUrl(vintage: string, titlePadded: string): string {
  const entry = resolveVintageEntry(vintage);
  if (!entry) {
    // Fall back to parsing the vintage string
    const [congress, ...rest] = vintage.split('-');
    const lawNumber = rest.join('-');
    return `https://uscode.house.gov/download/releasepoints/us/pl/${congress}/${lawNumber}/xml_usc${titlePadded}@${vintage}.zip`;
  }
  return `https://uscode.house.gov/download/releasepoints/us/pl/${entry.congress}/${entry.lawNumber}/xml_usc${titlePadded}@${vintage}.zip`;
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
