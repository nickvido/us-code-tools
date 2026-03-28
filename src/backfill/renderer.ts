import matter from 'gray-matter';
import type { ConstitutionProvisionRecord } from './constitution/dataset.js';

export function renderConstitutionProvision(record: ConstitutionProvisionRecord | (Record<string, unknown> & { markdownBody?: string })): string {
  const data = {
    type: record.type,
    number: record.number,
    heading: record.heading,
    ratified: record.ratified,
    proposed: record.proposed,
    proposing_body: 'proposing_body' in record ? record.proposing_body : record.proposingBody,
    source: record.source,
  };

  return matter.stringify(String(record.markdownBody ?? '').trimEnd() + '\n', data, {
    language: 'yaml',
  });
}

export function renderProvisionMarkdown(record: ConstitutionProvisionRecord): string {
  return renderConstitutionProvision(record);
}

export default renderConstitutionProvision;
