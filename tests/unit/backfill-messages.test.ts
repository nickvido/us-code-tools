import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { safeImport, ensureModuleLoaded } from '../utils/module-helpers.js';

function pickFormatter(mod: Record<string, unknown>): (input: unknown) => string {
  for (const name of ['renderConstitutionCommitMessage', 'formatConstitutionCommitMessage', 'constitutionCommitMessage']) {
    if (typeof mod[name] === 'function') {
      return mod[name] as (input: unknown) => string;
    }
  }

  if (mod.default && typeof mod.default === 'object') {
    const nested = mod.default as Record<string, unknown>;
    for (const name of ['renderConstitutionCommitMessage', 'formatConstitutionCommitMessage', 'constitutionCommitMessage']) {
      if (typeof nested[name] === 'function') {
        return nested[name] as (input: unknown) => string;
      }
    }
  }

  throw new Error('Could not find constitution commit formatter');
}

function pickAmendmentFormatter(mod: Record<string, unknown>): (input: unknown) => string {
  for (const name of ['renderAmendmentCommitMessage', 'formatAmendmentCommitMessage', 'amendmentCommitMessage']) {
    if (typeof mod[name] === 'function') {
      return mod[name] as (input: unknown) => string;
    }
  }

  if (mod.default && typeof mod.default === 'object') {
    const nested = mod.default as Record<string, unknown>;
    for (const name of ['renderAmendmentCommitMessage', 'formatAmendmentCommitMessage', 'amendmentCommitMessage']) {
      if (typeof nested[name] === 'function') {
        return nested[name] as (input: unknown) => string;
      }
    }
  }

  throw new Error('Could not find amendment commit formatter');
}

describe('Constitution commit message formatting', () => {
  it('formats Constitution commit message exactly as required', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'backfill', 'messages.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);

    const formatConstitutionCommitMessage = pickFormatter(mod);
    const message = formatConstitutionCommitMessage({
      signed: '1787-09-17',
      proposedBy: 'Constitutional Convention',
      ratified: '1788-06-21',
      ratifiedDetail: '9th state: New Hampshire',
      source: 'https://constitution.congress.gov/constitution/',
    });

    expect(message).toContain('Constitution of the United States');
    expect(message).toContain('Signed: 1787-09-17 by Constitutional Convention');
    expect(message).toContain('Ratified: 1788-06-21 (9th state: New Hampshire)');
    expect(message).toContain('Source: https://constitution.congress.gov/constitution/');
    expect(message).toMatchSnapshot();
  });

  it('formats Amendment XIV commit message with proposed and ratified metadata', async () => {
    const modulePath = resolve(process.cwd(), 'src', 'backfill', 'messages.ts');
    const mod = await safeImport(modulePath);
    ensureModuleLoaded(modulePath, mod);

    const formatAmendmentCommitMessage = pickAmendmentFormatter(mod);
    const message = formatAmendmentCommitMessage({
      number: 14,
      romanNumeral: 'XIV',
      heading: 'Citizenship, equal protection, due process',
      proposed: '1866-06-13',
      proposingBody: '39th Congress',
      ratified: '1868-07-09',
      source: 'https://constitution.congress.gov/browse/amendment-14/',
    });

    expect(message).toContain('Amendment XIV: Citizenship, equal protection, due process');
    expect(message).toContain('Proposed: 1866-06-13 by 39th Congress');
    expect(message).toContain('Ratified: 1868-07-09');
    expect(message).toContain('Source: https://constitution.congress.gov/browse/amendment-14/');
    expect(message).toMatchSnapshot();
  });
});
