export function renderConstitutionCommitMessage(input: {
  signed: string;
  proposedBy?: string;
  ratified: string;
  ratifiedDetail: string;
  source: string;
}): string {
  const proposedBy = input.proposedBy ?? 'Constitutional Convention';
  return `Constitution of the United States\n\nSigned: ${input.signed} by ${proposedBy}\nRatified: ${input.ratified} (${input.ratifiedDetail})\n\nSource: ${input.source}`;
}

export function renderAmendmentCommitMessage(input: {
  number: number;
  romanNumeral: string;
  heading: string;
  proposed: string;
  proposingBody: string;
  ratified: string;
  source: string;
}): string {
  return `Amendment ${input.romanNumeral}: ${input.heading}\n\nProposed: ${input.proposed} by ${input.proposingBody}\nRatified: ${input.ratified}\n\nSource: ${input.source}`;
}

export default {
  renderConstitutionCommitMessage,
  renderAmendmentCommitMessage,
};
