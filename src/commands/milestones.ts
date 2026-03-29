import { resolve } from 'node:path';
import { applyMilestones } from '../milestones/apply.js';
import { loadMetadata } from '../milestones/metadata.js';
import { buildMilestonesPlan } from '../milestones/plan.js';
import { derivePresidentTags } from '../milestones/president-tags.js';
import { releaseMilestones } from '../milestones/releases.js';

interface ParsedMilestonesArgs {
  subcommand: 'plan' | 'apply' | 'release';
  target: string;
  metadata: string;
}

function usage(error: string): void {
  process.stderr.write(`Usage: milestones plan --target <repo> --metadata <file>\nUsage: milestones apply --target <repo> --metadata <file>\nUsage: milestones release --target <repo> --metadata <file>\nError: ${error}\n`);
}

export function parseMilestonesArgs(args: string[]): { ok: true; value: ParsedMilestonesArgs } | { ok: false; error: string } {
  const [subcommand, ...rest] = args;
  if (subcommand !== 'plan' && subcommand !== 'apply' && subcommand !== 'release') {
    return { ok: false, error: `Unknown milestones subcommand '${subcommand ?? ''}'` };
  }

  let target: string | null = null;
  let metadata: string | null = null;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === '--target') {
      const value = rest[index + 1];
      if (!value) return { ok: false, error: 'Missing required --target flag' };
      if (target !== null) return { ok: false, error: 'Duplicate --target flag' };
      target = resolve(value);
      index += 1;
      continue;
    }
    if (token === '--metadata') {
      const value = rest[index + 1];
      if (!value) return { ok: false, error: 'Missing required --metadata flag' };
      if (metadata !== null) return { ok: false, error: 'Duplicate --metadata flag' };
      metadata = resolve(value);
      index += 1;
      continue;
    }
    return { ok: false, error: `Unknown argument '${token}'` };
  }

  if (!target || !metadata) {
    return { ok: false, error: 'milestones requires both --target and --metadata' };
  }

  return { ok: true, value: { subcommand, target, metadata } };
}

export async function runMilestonesCommand(args: string[]): Promise<number> {
  const parsed = parseMilestonesArgs(args);
  if (!parsed.ok) {
    usage(parsed.error);
    return 1;
  }

  const { metadata, errors } = await loadMetadata(parsed.value.metadata);
  if (!metadata) {
    process.stderr.write(`${JSON.stringify({ errors })}\n`);
    return 1;
  }

  const built = await buildMilestonesPlan(parsed.value.target, metadata);
  const plan = built.plan;

  if (errors.length > 0) {
    plan.errors.push(...errors);
  }

  if (plan.errors.length > 0) {
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    return 1;
  }

  if (parsed.value.subcommand === 'plan') {
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    return 0;
  }

  const { presidentTags, skippedPresidentTags } = derivePresidentTags(built.annualRows, metadata.president_terms);

  try {
    if (parsed.value.subcommand === 'apply') {
      await applyMilestones(parsed.value.target, built.annualRows, presidentTags, skippedPresidentTags, plan.release_candidates, parsed.value.metadata);
      process.stdout.write(`${JSON.stringify(plan)}\n`);
      return 0;
    }

    await releaseMilestones(parsed.value.target, parsed.value.metadata, metadata, plan);
    process.stdout.write(`${JSON.stringify({ releases: plan.release_candidates.length })}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : 'Unknown failure'}\n`);
    return 1;
  }
}
