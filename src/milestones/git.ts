import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { constants as fsConstants } from 'node:fs';

const execFileAsync = promisify(execFile);
const resolvedBinaryCache = new Map<string, Promise<string>>();

async function resolveBinary(command: 'git' | 'gh'): Promise<string> {
  const cached = resolvedBinaryCache.get(command);
  if (cached) {
    return cached;
  }

  const resolution = (async () => {
    const pathValue = process.env.PATH ?? '';
    for (const segment of pathValue.split(delimiter).filter(Boolean)) {
      const candidate = isAbsolute(segment) ? join(segment, command) : join(process.cwd(), segment, command);
      try {
        await access(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }

    const code = command === 'git' ? 'git_cli_unavailable' : 'github_cli_unavailable';
    throw new Error(`${code}: ${command} CLI is not installed`);
  })();

  resolvedBinaryCache.set(command, resolution);
  return resolution;
}

async function runBinary(command: 'git' | 'gh', args: string[]): Promise<string> {
  const executable = await resolveBinary(command);
  const { stdout } = await execFileAsync(executable, args, { env: process.env });
  return stdout.trim();
}

export async function git(repoPath: string, args: string[]): Promise<string> {
  return runBinary('git', ['-C', repoPath, ...args]);
}

export async function resolveGitBinary(): Promise<string> {
  return resolveBinary('git');
}

export async function resolveGhBinary(): Promise<string> {
  return resolveBinary('gh');
}

export async function ensureAttachedHead(repoPath: string): Promise<string> {
  try {
    return await git(repoPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  } catch {
    throw new Error('detached_head: target repository HEAD must be attached to a branch');
  }
}

export async function ensureCleanWorkingTree(repoPath: string): Promise<void> {
  const status = await git(repoPath, ['status', '--porcelain']);
  const relevantChanges = status
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => !line.endsWith('.us-code-tools/') && !line.endsWith('.us-code-tools/milestones.json') && !line.endsWith('.us-code-tools/milestones.lock'));

  if (relevantChanges.length > 0) {
    throw new Error('repo_dirty: target repository working tree must be clean before milestones apply');
  }
}

export async function resolveCommitSelector(repoPath: string, selector: string): Promise<string> {
  const output = await git(repoPath, ['rev-parse', '--verify', '--quiet', `${selector}^{commit}`]).catch(() => '');
  const shas = output.split('\n').map((line) => line.trim()).filter(Boolean);
  if (shas.length !== 1) {
    throw new Error(`commit_selector_ambiguous: commit selector '${selector}' must resolve to exactly one commit`);
  }

  return shas[0];
}

export async function createAnnotatedTag(repoPath: string, tag: string, sha: string, _message: string): Promise<void> {
  const existingSha = await git(repoPath, ['rev-list', '-n', '1', tag]).catch(() => '');
  if (existingSha) {
    if (existingSha !== sha) {
      throw new Error(`tag_conflict: tag '${tag}' already points to ${existingSha}, expected ${sha}`);
    }
    return;
  }

  await git(repoPath, ['tag', tag, sha]);
}
