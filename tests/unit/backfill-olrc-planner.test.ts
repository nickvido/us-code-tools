import { describe, expect, it } from 'vitest';
import { buildOlrcBackfillPlan, buildOlrcCommitMessage, buildOlrcDownloadUrl, KNOWN_VINTAGES, resolveVintageEntry } from '../../src/backfill/olrc-planner.js';

describe('OLRC backfill planner', () => {
  it('resolves known vintages by id', () => {
    const entry = resolveVintageEntry('119-73');
    expect(entry).toBeDefined();
    expect(entry!.year).toBe(2025);
    expect(entry!.congress).toBe(119);
  });

  it('returns undefined for unknown vintages', () => {
    expect(resolveVintageEntry('999-1')).toBeUndefined();
  });

  it('builds a plan sorted by release date', () => {
    const plan = buildOlrcBackfillPlan(['119-73', '113-21']);
    expect(plan.vintages).toHaveLength(2);
    expect(plan.vintages[0]!.vintage).toBe('113-21');
    expect(plan.vintages[1]!.vintage).toBe('119-73');
  });

  it('assigns annual tags for each vintage', () => {
    const plan = buildOlrcBackfillPlan(['113-21', '119-73']);
    expect(plan.tags.get('annual/2013')).toBe('113-21');
    expect(plan.tags.get('annual/2025')).toBe('119-73');
  });

  it('assigns congress boundary tags', () => {
    const plan = buildOlrcBackfillPlan(['113-296', '114-329']);
    expect(plan.tags.get('congress/113')).toBe('113-296');
    expect(plan.tags.get('congress/114')).toBe('114-329');
  });

  it('does not assign congress tags for non-boundary vintages', () => {
    const plan = buildOlrcBackfillPlan(['113-21']);
    expect(plan.tags.has('congress/113')).toBe(false);
  });

  it('throws for unknown vintage ids', () => {
    expect(() => buildOlrcBackfillPlan(['999-1'])).toThrow(/Unknown vintage/);
  });

  it('builds a well-formed commit message', () => {
    const entry = resolveVintageEntry('118-158')!;
    const msg = buildOlrcCommitMessage(entry);
    expect(msg).toContain('Public Law 118-158');
    expect(msg).toContain('2024');
  });

  it('KNOWN_VINTAGES are in chronological order', () => {
    for (let i = 1; i < KNOWN_VINTAGES.length; i++) {
      expect(KNOWN_VINTAGES[i]!.releaseDate >= KNOWN_VINTAGES[i - 1]!.releaseDate).toBe(true);
    }
  });

  it('builds correct OLRC download URLs', () => {
    const url = buildOlrcDownloadUrl('113-296', '01');
    expect(url).toBe('https://uscode.house.gov/download/releasepoints/us/pl/113/296/xml_usc01@113-296.zip');
  });
});
