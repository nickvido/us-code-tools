import { XMLParser } from 'fast-xml-parser';

export type GovInfoBulkCollection = 'BILLSTATUS' | 'BILLS' | 'BILLSUM' | 'PLAW';

export interface GovInfoBulkListingEntry {
  name: string;
  href: string;
  url: string;
  kind: 'directory' | 'file';
}

const GOVINFO_BULK_ORIGIN = 'https://www.govinfo.gov';
const GOVINFO_BULK_PREFIX = '/bulkdata/';
const LISTING_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: true,
});

export const GOVINFO_BULK_COLLECTIONS: GovInfoBulkCollection[] = ['BILLSTATUS', 'BILLS', 'BILLSUM', 'PLAW'];

export function isGovInfoBulkCollection(value: string): value is GovInfoBulkCollection {
  return GOVINFO_BULK_COLLECTIONS.includes(value as GovInfoBulkCollection);
}

export function parseGovInfoBulkListing(xml: string, baseUrl: string): GovInfoBulkListingEntry[] {
  const trimmed = xml.trimStart();
  if (trimmed.startsWith('<!DOCTYPE html') || trimmed.startsWith('<html') || trimmed.startsWith('<HTML')) {
    throw new Error('invalid_listing_payload: GovInfo bulk listing returned HTML instead of XML');
  }

  let parsed: unknown;
  try {
    parsed = LISTING_PARSER.parse(xml);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown XML parse error';
    throw new Error(`invalid_listing_payload: ${message}`);
  }

  const document = findEntriesRoot(parsed);
  const rawEntries = collectRawEntries(document);
  const entries: GovInfoBulkListingEntry[] = [];

  for (const entry of rawEntries) {
    const href = readStringField(entry, ['href', 'link', 'url']);
    if (href === null) {
      continue;
    }

    const url = resolveGovInfoBulkUrl(baseUrl, href);
    const name = normalizeListingName(readStringField(entry, ['name', 'label', 'title']), url, href);
    entries.push({
      name,
      href,
      url: url.toString(),
      kind: classifyListingEntry({ name, href, url: url.toString() }, entry),
    });
  }

  return dedupeEntries(entries);
}

export function classifyListingEntry(entry: Pick<GovInfoBulkListingEntry, 'name' | 'href' | 'url'>, rawEntry?: Record<string, unknown>): 'directory' | 'file' {
  if (rawEntry?.folder === true || rawEntry?.folder === 'true') {
    return 'directory';
  }
  if (entry.href.endsWith('/') || entry.name.endsWith('/') || new URL(entry.url).pathname.endsWith('/')) {
    return 'directory';
  }
  return 'file';
}

export function resolveGovInfoBulkUrl(baseUrl: string, href: string): URL {
  const resolved = new URL(href, baseUrl);
  if (!isAllowedGovInfoBulkUrl(resolved)) {
    throw new Error(`invalid_listing_url: disallowed GovInfo bulk URL '${resolved.toString()}'`);
  }
  return resolved;
}

export function isAllowedGovInfoBulkUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.origin === GOVINFO_BULK_ORIGIN && url.pathname.startsWith(GOVINFO_BULK_PREFIX);
}

function findEntriesRoot(parsed: unknown): unknown {
  if (!isRecord(parsed)) {
    throw new Error('invalid_listing_payload: listing XML did not parse into an object');
  }

  // GovInfo XML: <data><files><file>...</file></files></data>
  const data = parsed.data;
  if (isRecord(data) && data.files) {
    return data.files;
  }

  return parsed.directory ?? parsed.listing ?? parsed.files ?? parsed;
}

function collectRawEntries(root: unknown): Array<Record<string, unknown>> {
  if (!isRecord(root)) {
    return [];
  }

  const directCandidates = [root.entry, root.item, root.directory, root.file, root.entries, root.items];
  for (const candidate of directCandidates) {
    const normalized = normalizeCandidateEntries(candidate);
    if (normalized.length > 0) {
      return normalized;
    }
  }

  const recursive: Array<Record<string, unknown>> = [];
  for (const value of Object.values(root)) {
    recursive.push(...normalizeCandidateEntries(value));
  }
  return recursive;
}

function normalizeCandidateEntries(candidate: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(candidate)) {
    return candidate.filter(isRecord);
  }
  return isRecord(candidate) ? [candidate] : [];
}

function readStringField(entry: Record<string, unknown>, fields: string[]): string | null {
  for (const field of fields) {
    const value = entry[field];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === 'number') {
      return String(value);
    }
  }
  return null;
}

function normalizeListingName(name: string | null, url: URL, href: string): string {
  if (name !== null) {
    return name.endsWith('/') || href.endsWith('/') ? name.replace(/\/+$/, '') : name;
  }

  const pathname = url.pathname.replace(/\/+$/, '');
  const lastSegment = pathname.split('/').filter((segment) => segment.length > 0).at(-1);
  return lastSegment ?? pathname;
}

function dedupeEntries(entries: GovInfoBulkListingEntry[]): GovInfoBulkListingEntry[] {
  const seen = new Set<string>();
  const deduped: GovInfoBulkListingEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.url)) {
      continue;
    }
    seen.add(entry.url);
    deduped.push(entry);
  }
  return deduped;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
