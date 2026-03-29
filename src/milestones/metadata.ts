import { readFile } from 'node:fs/promises';
import type { AnnualSnapshotRow, LegalMilestonesMetadata, PlanError, PresidentTermRow } from './types.js';

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function pushError(errors: PlanError[], code: string, message: string): void {
  errors.push({ code, message });
}

function normalizePlTag(releasePoint: string, congress: number): string | null {
  const match = /^PL (\d+)-(\d+)$/.exec(releasePoint);
  if (!match) {
    return null;
  }
  if (Number(match[1]) !== congress) {
    return null;
  }
  return `pl/${match[1]}-${match[2]}`;
}

function validateAnnualRow(row: unknown, index: number, errors: PlanError[]): row is AnnualSnapshotRow {
  if (!row || typeof row !== 'object') {
    pushError(errors, 'metadata_invalid', `annual_snapshots[${index}] must be an object`);
    return false;
  }

  const candidate = row as Record<string, unknown>;
  const counts = candidate.release_notes && typeof candidate.release_notes === 'object'
    ? (candidate.release_notes as Record<string, unknown>).summary_counts as Record<string, unknown> | undefined
    : undefined;

  const valid =
    /^annual\/\d{4}$/.test(String(candidate.annual_tag ?? '')) &&
    isIsoDate(candidate.snapshot_date) &&
    isNonEmptyString(candidate.release_point) &&
    isNonEmptyString(candidate.commit_selector) &&
    typeof candidate.congress === 'number' && Number.isInteger(candidate.congress) && candidate.congress > 0 &&
    /^[a-z0-9-]+$/.test(String(candidate.president_term ?? '')) &&
    typeof candidate.is_congress_boundary === 'boolean' &&
    candidate.release_notes && typeof candidate.release_notes === 'object' &&
    (((candidate.release_notes as Record<string, unknown>).scope === 'annual') || ((candidate.release_notes as Record<string, unknown>).scope === 'congress')) &&
    Array.isArray((candidate.release_notes as Record<string, unknown>).notable_laws) &&
    counts !== undefined &&
    ['titles_changed', 'chapters_changed', 'sections_added', 'sections_amended', 'sections_repealed'].every((key) => typeof counts[key] === 'number' && Number.isInteger(counts[key]) && counts[key] >= 0) &&
    isNonEmptyString((candidate.release_notes as Record<string, unknown>).narrative);

  if (!valid) {
    pushError(errors, 'metadata_invalid', `annual_snapshots[${index}] is invalid`);
    return false;
  }

  return true;
}

function validatePresidentRow(row: unknown, index: number, errors: PlanError[]): row is PresidentTermRow {
  if (!row || typeof row !== 'object') {
    pushError(errors, 'metadata_invalid', `president_terms[${index}] must be an object`);
    return false;
  }

  const candidate = row as Record<string, unknown>;
  const valid =
    /^[a-z0-9-]+$/.test(String(candidate.slug ?? '')) &&
    isIsoDate(candidate.inauguration_date) &&
    isNonEmptyString(candidate.president_name);

  if (!valid) {
    pushError(errors, 'metadata_invalid', `president_terms[${index}] is invalid`);
    return false;
  }

  return true;
}

export async function loadMetadata(metadataPath: string): Promise<{ metadata: LegalMilestonesMetadata | null; errors: PlanError[] }> {
  const errors: PlanError[] = [];
  let raw: string;
  try {
    raw = await readFile(metadataPath, 'utf8');
  } catch (error) {
    return { metadata: null, errors: [{ code: 'metadata_invalid', message: error instanceof Error ? error.message : 'Unable to read metadata file' }] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { metadata: null, errors: [{ code: 'metadata_invalid', message: 'Metadata file is not valid JSON' }] };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { metadata: null, errors: [{ code: 'metadata_invalid', message: 'Metadata file must contain an object' }] };
  }

  const root = parsed as Record<string, unknown>;
  if (!Array.isArray(root.annual_snapshots) || !Array.isArray(root.president_terms)) {
    return { metadata: null, errors: [{ code: 'metadata_invalid', message: 'Metadata file must contain annual_snapshots[] and president_terms[] arrays' }] };
  }

  const annualRows = root.annual_snapshots.filter((row, index) => validateAnnualRow(row, index, errors)) as AnnualSnapshotRow[];
  const presidentRows = root.president_terms.filter((row, index) => validatePresidentRow(row, index, errors)) as PresidentTermRow[];

  const annualTags = new Set<string>();
  const snapshotDates = new Set<string>();
  const plTags = new Set<string>();
  const presidentSlugs = new Set<string>();
  const knownPresidentSlugs = new Set(presidentRows.map((row) => row.slug));
  let previousCongress = -1;
  const boundaryByCongress = new Set<number>();

  for (const row of annualRows) {
    if (annualTags.has(row.annual_tag)) {
      pushError(errors, 'metadata_invalid', `duplicate annual tag '${row.annual_tag}'`);
    }
    annualTags.add(row.annual_tag);

    if (snapshotDates.has(row.snapshot_date)) {
      pushError(errors, 'metadata_invalid', `duplicate snapshot date '${row.snapshot_date}'`);
    }
    snapshotDates.add(row.snapshot_date);

    if (!knownPresidentSlugs.has(row.president_term)) {
      pushError(errors, 'metadata_invalid', `unknown president term '${row.president_term}'`);
    }

    const plTag = normalizePlTag(row.release_point, row.congress);
    if (!plTag) {
      pushError(errors, 'metadata_invalid', `malformed release point '${row.release_point}'`);
    } else if (plTags.has(plTag)) {
      pushError(errors, 'metadata_invalid', `duplicate release point tag '${plTag}'`);
    } else {
      plTags.add(plTag);
    }

    const expectedScope = row.is_congress_boundary ? 'congress' : 'annual';
    if (row.release_notes.scope !== expectedScope) {
      pushError(errors, 'metadata_invalid', `row '${row.annual_tag}' has scope '${row.release_notes.scope}' but expected '${expectedScope}'`);
    }

    if (row.congress < previousCongress) {
      pushError(errors, 'metadata_invalid', 'congress numbers must not decrease across chronological annual rows');
    }
    previousCongress = row.congress;

    if (row.is_congress_boundary) {
      if (boundaryByCongress.has(row.congress)) {
        pushError(errors, 'metadata_invalid', `duplicate congress boundary for congress/${row.congress}`);
      }
      boundaryByCongress.add(row.congress);
    }
  }

  for (const row of presidentRows) {
    if (presidentSlugs.has(row.slug)) {
      pushError(errors, 'metadata_invalid', `duplicate president slug '${row.slug}'`);
    }
    presidentSlugs.add(row.slug);
  }

  annualRows.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date) || a.annual_tag.localeCompare(b.annual_tag));
  presidentRows.sort((a, b) => a.inauguration_date.localeCompare(b.inauguration_date) || a.slug.localeCompare(b.slug));

  if (errors.length > 0) {
    return { metadata: null, errors };
  }

  return { metadata: { annual_snapshots: annualRows, president_terms: presidentRows }, errors: [] };
}

export function normalizeReleasePointTag(releasePoint: string, congress: number): string {
  const normalized = normalizePlTag(releasePoint, congress);
  if (!normalized) {
    throw new Error(`metadata_invalid: malformed release point '${releasePoint}'`);
  }
  return normalized;
}
