import type { ConstitutionDataset } from './constitution/dataset.js';
import { renderConstitutionProvision } from './renderer.js';
import { renderAmendmentCommitMessage, renderConstitutionCommitMessage } from './messages.js';

export interface BackfillFileWrite {
  path: string;
  content: string;
}

export interface HistoricalEvent {
  sequence: number;
  slug: string;
  ratified: string;
  ratifiedDate: string;
  authorName: string;
  authorEmail: string;
  commitMessage: string;
  writes: BackfillFileWrite[];
}

export function buildConstitutionPlan(dataset: ConstitutionDataset): HistoricalEvent[] {
  const constitutionEvent: HistoricalEvent = {
    sequence: 1,
    slug: 'constitution',
    ratified: dataset.constitution.ratified,
    ratifiedDate: dataset.constitution.ratified,
    authorName: dataset.constitution.authorName,
    authorEmail: dataset.constitution.authorEmail,
    commitMessage: renderConstitutionCommitMessage({
      signed: dataset.constitution.signed,
      proposedBy: dataset.constitution.authorName,
      ratified: dataset.constitution.ratified,
      ratifiedDetail: dataset.constitution.ratifiedDetail,
      source: dataset.constitution.source,
    }),
    writes: dataset.constitution.articles.map((article) => ({
      path: `constitution/article-${article.romanNumeral}.md`,
      content: renderConstitutionProvision(article),
    })),
  };

  const amendmentEvents = dataset.amendments.map((amendment, index): HistoricalEvent => ({
    sequence: index + 2,
    slug: `amendment-${String(amendment.number).padStart(2, '0')}`,
    ratified: amendment.ratified,
    ratifiedDate: amendment.ratified,
    authorName: amendment.authorName,
    authorEmail: amendment.authorEmail,
    commitMessage: renderAmendmentCommitMessage({
      number: amendment.number,
      romanNumeral: amendment.romanNumeral,
      heading: amendment.heading,
      proposed: amendment.proposed,
      proposingBody: amendment.proposingBody,
      ratified: amendment.ratified,
      source: amendment.source,
    }),
    writes: [{
      path: `constitution/amendment-${String(amendment.number).padStart(2, '0')}.md`,
      content: renderConstitutionProvision(amendment),
    }],
  }));

  return [constitutionEvent, ...amendmentEvents];
}

export default buildConstitutionPlan;
