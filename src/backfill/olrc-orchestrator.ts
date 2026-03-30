import { existsSync, readdirSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildOlrcBackfillPlan, buildOlrcCommitMessage, type OlrcBackfillPlan, type OlrcVintageEntry } from './olrc-planner.js';
import { git } from './git-adapter.js';

export interface OlrcBackfillSummary {
  phase: 'olrc';
  target: string;
  vintagesPlanned: number;
  vintagesApplied: number;
  vintagesSkipped: number;
  tags: string[];
  pushResult: 'pushed' | 'skipped-local-only';
}

/**
 * Resolve the cache directory for a given vintage.
 * Returns the path to the vintage's title directories under data/cache/olrc/vintages/<vintage>/
 */
function vintageCacheDir(projectRoot: string, vintage: string): string {
  return resolve(projectRoot, 'data', 'cache', 'olrc', 'vintages', vintage);
}

/**
 * Validate that all requested vintages have cached data before starting.
 */
function validateVintageCache(projectRoot: string, plan: OlrcBackfillPlan): void {
  const missing: string[] = [];
  for (const entry of plan.vintages) {
    const cacheDir = vintageCacheDir(projectRoot, entry.vintage);
    if (!existsSync(cacheDir)) {
      missing.push(entry.vintage);
    } else {
      // Check that at least some title directories exist
      const contents = readdirSync(cacheDir).filter((f) => f.startsWith('title-'));
      if (contents.length === 0) {
        missing.push(entry.vintage);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing cached data for vintages: ${missing.join(', ')}. ` +
      `Run 'fetch --source=olrc --vintage=<v>' for each missing vintage first.`
    );
  }
}

/**
 * Resolve the ZIP path for a specific title in a vintage cache.
 */
function resolveVintageZipPath(cacheDir: string, vintage: string, titlePadded: string): string | null {
  const titleDir = resolve(cacheDir, `title-${titlePadded}`);
  if (!existsSync(titleDir)) {
    return null;
  }
  // Look for the ZIP file matching the pattern
  const zipName = `xml_usc${titlePadded}@${vintage}.zip`;
  const zipPath = resolve(titleDir, zipName);
  if (existsSync(zipPath)) {
    return zipPath;
  }
  // Fallback: check for any zip in the directory
  const files = readdirSync(titleDir).filter((f) => f.endsWith('.zip'));
  return files.length > 0 ? resolve(titleDir, files[0]!) : null;
}

/**
 * Transform all titles for a given vintage using the existing transform pipeline.
 * Writes chapter-grouped markdown output to outputDir.
 */
async function transformVintage(
  projectRoot: string,
  vintage: string,
  outputDir: string,
): Promise<{ sectionsFound: number; filesWritten: number }> {
  const { allTransformTitleTargets } = await import('../domain/normalize.js');
  const { extractXmlEntriesFromZip } = await import('../sources/olrc.js');
  const { parseUslmToIr } = await import('../transforms/uslm-to-ir.js');
  const { writeTitleOutput } = await import('../transforms/write-output.js');

  await mkdir(outputDir, { recursive: true });

  const cacheDir = vintageCacheDir(projectRoot, vintage);
  let totalSections = 0;
  let totalFiles = 0;

  for (const target of allTransformTitleTargets()) {
    const zipPath = resolveVintageZipPath(cacheDir, vintage, target.cacheKey);
    if (!zipPath) {
      continue;
    }

    try {
      const xmlEntries = await extractXmlEntriesFromZip(zipPath);
      if (xmlEntries.length === 0) {
        continue;
      }

      let titleIr: import('../domain/model.js').TitleIR | null = null;

      for (const entry of xmlEntries) {
        const result = parseUslmToIr(entry.xml, entry.xmlPath);
        if (result.titleIr) {
          if (titleIr === null) {
            titleIr = result.titleIr;
          } else {
            titleIr.sections.push(...result.titleIr.sections);
          }
        }
      }

      if (titleIr && titleIr.sections.length > 0) {
        const writeResult = await writeTitleOutput(outputDir, titleIr, { groupBy: 'chapter', normalizedTarget: target });
        totalSections += titleIr.sections.length;
        totalFiles += writeResult.filesWritten;
      }
    } catch {
      // Skip titles that fail to parse — non-fatal for backfill
      continue;
    }
  }

  return { sectionsFound: totalSections, filesWritten: totalFiles };
}

/**
 * Create a backdated commit in the target repo for a single vintage.
 */
async function commitVintage(
  repoPath: string,
  branch: string,
  entry: OlrcVintageEntry,
): Promise<void> {
  // Stage all changes
  await git(repoPath, ['add', '-A']);

  // Check if there are actually changes to commit
  const status = await git(repoPath, ['status', '--porcelain']);
  if (status.trim() === '') {
    return; // Nothing changed
  }

  const commitMessage = buildOlrcCommitMessage(entry);
  const timestamp = `${entry.releaseDate}T12:00:00+0000`;

  await git(repoPath, [
    'commit',
    '-m', commitMessage,
    '--allow-empty',
  ], {
    GIT_AUTHOR_NAME: 'US Congress',
    GIT_AUTHOR_EMAIL: 'uscode@house.gov',
    GIT_AUTHOR_DATE: timestamp,
    GIT_COMMITTER_NAME: 'us-code-tools',
    GIT_COMMITTER_EMAIL: 'sync@us-code-tools.local',
    GIT_COMMITTER_DATE: timestamp,
  });
}

export interface OlrcBackfillDryRunSummary {
  phase: 'olrc';
  dryRun: true;
  vintagesPlanned: number;
  vintages: Array<{ vintage: string; year: number; congress: number; congressBoundary: boolean; cacheDir: string; titlesCached: number }>;
  tags: Array<{ tag: string; vintage: string }>;
  cacheValid: boolean;
  missingVintages: string[];
}

/**
 * Dry-run: validate caches and show the plan without writing anything.
 */
export function runOlrcBackfillDryRun(
  vintageIds: string[],
  projectRoot: string,
): OlrcBackfillDryRunSummary {
  const plan = buildOlrcBackfillPlan(vintageIds);
  const missingVintages: string[] = [];
  const vintageDetails = plan.vintages.map((entry) => {
    const cacheDir = vintageCacheDir(projectRoot, entry.vintage);
    let titlesCached = 0;
    if (existsSync(cacheDir)) {
      titlesCached = readdirSync(cacheDir).filter((f) => f.startsWith('title-')).length;
    } else {
      missingVintages.push(entry.vintage);
    }
    return {
      vintage: entry.vintage,
      year: entry.year,
      congress: entry.congress,
      congressBoundary: entry.congressBoundary,
      cacheDir,
      titlesCached,
    };
  });

  const tags = [...plan.tags.entries()].map(([tag, vintage]) => ({ tag, vintage }));

  return {
    phase: 'olrc',
    dryRun: true,
    vintagesPlanned: plan.vintages.length,
    vintages: vintageDetails,
    tags,
    cacheValid: missingVintages.length === 0,
    missingVintages,
  };
}

/**
 * Detect how many vintages from the plan are already committed in the target repo.
 * Matches by commit message prefix "Update US Code through Public Law {congress}-{lawNumber}".
 */
async function detectAppliedVintages(
  repoPath: string,
  plan: OlrcBackfillPlan,
): Promise<number> {
  const revList = await git(repoPath, ['rev-list', '--reverse', 'HEAD']).catch(() => '');
  const shas = revList.split('\n').map((l) => l.trim()).filter(Boolean);
  if (shas.length === 0) {
    return 0;
  }

  let matched = 0;
  for (let i = 0; i < Math.min(shas.length, plan.vintages.length); i++) {
    const raw = await git(repoPath, ['log', '--format=%s', '-1', shas[i]!]);
    const expectedPrefix = `Update US Code through Public Law ${plan.vintages[i]!.congress}-${plan.vintages[i]!.lawNumber}`;
    if (raw.trim() === expectedPrefix) {
      matched++;
    } else {
      break; // Non-matching commit breaks the prefix chain
    }
  }

  return matched;
}

/**
 * Run the full OLRC historical backfill.
 *
 * Resume-safe: detects already-applied vintages by matching commit messages
 * against the plan and skips them. Re-running after a crash picks up where
 * it left off.
 */
export async function runOlrcBackfill(
  target: string,
  vintageIds: string[],
  projectRoot: string,
): Promise<OlrcBackfillSummary> {
  const plan = buildOlrcBackfillPlan(vintageIds);

  // Validate all vintage caches exist before starting
  validateVintageCache(projectRoot, plan);

  // Ensure target is a git repo
  const repoPath = resolve(target);
  if (!existsSync(resolve(repoPath, '.git'))) {
    await mkdir(repoPath, { recursive: true });
    await git(repoPath, ['init']);
  }

  const branch = await git(repoPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => 'main');

  // Detect already-applied vintages for resume support
  const alreadyApplied = await detectAppliedVintages(repoPath, plan);
  if (alreadyApplied > 0) {
    process.stderr.write(`[backfill] Resuming: ${alreadyApplied} of ${plan.vintages.length} vintages already applied, skipping.\n`);
  }

  // If a previous run crashed mid-vintage, clean up dirty state
  const dirtyStatus = await git(repoPath, ['status', '--porcelain']).catch(() => '');
  if (dirtyStatus.trim() !== '') {
    process.stderr.write(`[backfill] Cleaning dirty working tree from interrupted run...\n`);
    await git(repoPath, ['checkout', '--', '.']).catch(() => '');
    await git(repoPath, ['clean', '-fd']).catch(() => '');
  }

  let vintagesApplied = 0;
  let vintagesFailed = 0;
  const appliedTags: string[] = [];

  for (let i = 0; i < plan.vintages.length; i++) {
    const entry = plan.vintages[i]!;

    // Skip already-applied vintages
    if (i < alreadyApplied) {
      process.stderr.write(`[backfill] Skipping vintage ${entry.vintage} (${entry.year}) — already committed.\n`);
      vintagesApplied++;
      // Still apply tags (idempotent)
      for (const [tagName, tagVintage] of plan.tags) {
        if (tagVintage === entry.vintage) {
          await git(repoPath, ['tag', '-d', tagName]).catch(() => '');
          await git(repoPath, ['tag', tagName]).catch(() => '');
          appliedTags.push(tagName);
        }
      }
      continue;
    }

    process.stderr.write(`[backfill] [${i + 1}/${plan.vintages.length}] Processing vintage ${entry.vintage} (${entry.year})...\n`);

    try {
      // Clear the uscode directory for a clean snapshot
      const uscodeDir = resolve(repoPath, 'uscode');
      if (existsSync(uscodeDir)) {
        await rm(uscodeDir, { recursive: true, force: true });
      }

      // Transform all titles for this vintage
      const result = await transformVintage(projectRoot, entry.vintage, repoPath);
      process.stderr.write(`[backfill]   ${result.sectionsFound} sections → ${result.filesWritten} files\n`);

      // Commit the snapshot
      await commitVintage(repoPath, branch, entry);
      vintagesApplied++;

      // Apply tags
      for (const [tagName, tagVintage] of plan.tags) {
        if (tagVintage === entry.vintage) {
          await git(repoPath, ['tag', '-d', tagName]).catch(() => '');
          await git(repoPath, ['tag', tagName]);
          appliedTags.push(tagName);
        }
      }

      process.stderr.write(`[backfill]   ✓ committed\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[backfill]   ✗ FAILED: ${message}\n`);
      process.stderr.write(`[backfill]   Cleaning up and continuing with next vintage...\n`);
      vintagesFailed++;

      // Clean up dirty state so the next vintage starts clean
      await git(repoPath, ['checkout', '--', '.']).catch(() => '');
      await git(repoPath, ['clean', '-fd']).catch(() => '');
    }
  }

  // Try to push if remote exists
  let pushResult: 'pushed' | 'skipped-local-only' = 'skipped-local-only';
  const remotes = (await git(repoPath, ['remote'])).split('\n').filter(Boolean);
  if (remotes.length > 0) {
    const remote = remotes.includes('origin') ? 'origin' : remotes[0];
    try {
      await git(repoPath, ['push', '--set-upstream', remote!, branch]);
      for (const tag of appliedTags) {
        await git(repoPath, ['push', remote!, `refs/tags/${tag}`]).catch(() => '');
      }
      pushResult = 'pushed';
    } catch {
      // Push failed — local-only
    }
  }

  return {
    phase: 'olrc',
    target: repoPath,
    vintagesPlanned: plan.vintages.length,
    vintagesApplied,
    vintagesSkipped: plan.vintages.length - vintagesApplied - vintagesFailed,
    tags: appliedTags,
    pushResult,
  };
}
