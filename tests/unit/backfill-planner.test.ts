import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { safeImport, ensureModuleLoaded } from '../utils/module-helpers.js';

function pickPlanBuilder(mod: Record<string, unknown>): (dataset: unknown) => Array<Record<string, unknown>> {
  for (const name of ['buildConstitutionPlan', 'buildPlan', 'createBackfillPlan', 'planConstitutionEvents', 'buildEventPlan']) {
    if (typeof mod[name] === 'function') {
      return mod[name] as (dataset: unknown) => Array<Record<string, unknown>>;
    }
  }

  if (typeof mod.default === 'function') {
    return mod.default as (dataset: unknown) => Array<Record<string, unknown>>;
  }

  if (mod.default && typeof mod.default === 'object') {
    const nested = mod.default as Record<string, unknown>;
    for (const name of ['buildConstitutionPlan', 'buildPlan', 'createBackfillPlan', 'planConstitutionEvents', 'buildEventPlan']) {
      if (typeof nested[name] === 'function') {
        return nested[name] as (dataset: unknown) => Array<Record<string, unknown>>;
      }
    }
  }

  throw new Error('Could not find planner builder function');
}

describe('Constitution backfill planner', () => {
  it('builds exactly 28 events in stable chronological order', async () => {
    const planMod = await safeImport(resolve(process.cwd(), 'src', 'backfill', 'planner.ts'));
    ensureModuleLoaded(resolve(process.cwd(), 'src', 'backfill', 'planner.ts'), planMod);
    const buildPlan = pickPlanBuilder(planMod);

    const datasetMod = await safeImport(resolve(process.cwd(), 'src', 'backfill', 'constitution', 'dataset.ts'));
    ensureModuleLoaded(resolve(process.cwd(), 'src', 'backfill/constitution/dataset.ts'), datasetMod);
    const candidate = (datasetMod as Record<string, unknown>);

    const dataset = (() => {
      const keys = ['constitutionDataset', 'constitutionData', 'dataset', 'CONSTITUTION_DATASET', 'data'];
      for (const key of keys) {
        const value = candidate[key];
        if (value && typeof value === 'object') {
          return value;
        }
      }
      if (candidate.default && typeof candidate.default === 'object') {
        return candidate.default;
      }
      throw new Error('Could not locate dataset export in planner test');
    })();

    const plan = buildPlan(dataset);
    expect(Array.isArray(plan)).toBe(true);
    expect(plan).toHaveLength(28);

    const ratifiedDates = plan.map((event) => String((event.ratifiedDate ?? event.ratified))); 
    for (let i = 1; i < ratifiedDates.length; i += 1) {
      expect(ratifiedDates[i] >= ratifiedDates[i - 1]).toBe(true);
    }

    const [first, ...rest] = plan;
    expect(first.slug).toBe('constitution');
    expect(first.ratified).toBe('1788-06-21');
    expect(first.authorName).toBe('Constitutional Convention');

    const firstTenAmendments = rest.slice(0, 10).map((entry) => String((entry.slug || '').replace('amendment-', '')));
    expect(firstTenAmendments).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']);
    expect(new Set(rest.slice(0, 10).map((entry) => entry.ratified)).size).toBe(1);
    expect(rest[0].ratified).toBe('1791-12-15');

    const final = plan.at(-1);
    expect(final?.slug).toBe('amendment-27');
    expect(final?.ratified ?? final?.ratifiedDate).toBe('1992-05-07');
    expect(final?.sequence ?? final?.index).toBe(28);
  });

  it('produces a resume-safe contiguous suffix from any prefix position', async () => {
    const planMod = await safeImport(resolve(process.cwd(), 'src', 'backfill', 'planner.ts'));
    ensureModuleLoaded(resolve(process.cwd(), 'src', 'backfill', 'planner.ts'), planMod);
    const buildPlan = pickPlanBuilder(planMod);

    const datasetMod = await safeImport(resolve(process.cwd(), 'src/backfill/constitution/dataset.ts'));
    ensureModuleLoaded(resolve(process.cwd(), 'src/backfill/constitution/dataset.ts'), datasetMod);

    const keys = ['constitutionDataset', 'constitutionData', 'dataset', 'CONSTITUTION_DATASET', 'data'];
    const candidate = Object.values(datasetMod).find(
      (value) =>
        Boolean(value) &&
        typeof value === 'object' &&
        Array.isArray((value as Record<string, unknown>).amendments) &&
        value !== null &&
        'amendments' in (value as Record<string, unknown>),
    ) as Record<string, unknown> | undefined;

    expect(candidate).toBeTruthy();
    const dataset = candidate as Record<string, unknown>;

    const plan = buildPlan(dataset);

    const prefixLength = 10;
    const remaining = plan.slice(prefixLength);
    expect(remaining).toHaveLength(18);
    expect(remaining[0].sequence ?? remaining[0].index).toBe(prefixLength + 1);
    expect(remaining[0].slug).toBe(`amendment-${String(prefixLength).padStart(2, '0')}`);

    expect(plan.every((entry) => Boolean(entry.slug))).toBe(true);
  });
});
