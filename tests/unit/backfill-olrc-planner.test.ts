import { describe, expect, it } from 'vitest';
import { buildOlrcBackfillPlan, buildOlrcCommitMessage, KNOWN_VINTAGES, resolveVintageEntry } from '../../src/backfill/olrc-planner.js';

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
    const plan = buildOlrcBackfillPlan(['119-73', '113-4']);
    expect(plan.vintages).toHaveLength(2);
    expect(plan.vintages[0]!.vintage).toBe('113-4');
    expect(plan.vintages[1]!.vintage).toBe('119-73');
  });

  it('assigns annual tags for each vintage', () => {
    const plan = buildOlrcBackfillPlan(['113-4', '119-73']);
    expect(plan.tags.get('annual/2013')).toBe('113-4');
    expect(plan.tags.get('annual/2025')).toBe('119-73');
  });

  it('assigns congress boundary tags', () => {
    const plan = buildOlrcBackfillPlan(['114-38', '115-97']);
    expect(plan.tags.get('congress/114')).toBe('114-38');
    expect(plan.tags.get('congress/115')).toBe('115-97');
  });

  it('does not assign congress tags for non-boundary vintages', () => {
    const plan = buildOlrcBackfillPlan(['113-4']);
    expect(plan.tags.has('congress/113')).toBe(false);
  });

  it('throws for unknown vintage ids', () => {
    expect(() => buildOlrcBackfillPlan(['999-1'])).toThrow(/Unknown vintage/);
  });

  it('builds a well-formed commit message', () => {
    const entry = resolveVintageEntry('118-200')!;
    const msg = buildOlrcCommitMessage(entry);
    expect(msg).toContain('Public Law 118-200');
    expect(msg).toContain('2024');
  });

  it('KNOWN_VINTAGES are in chronological order', () => {
    for (let i = 1; i < KNOWN_VINTAGES.length; i++) {
      expect(KNOWN_VINTAGES[i]!.releaseDate >= KNOWN_VINTAGES[i - 1]!.releaseDate).toBe(true);
    }
  });
});
