import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function runBinary(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, { env: process.env });
  return stdout.trim();
}

export async function git(repoPath: string, args: string[]): Promise<string> {
  return runBinary('git', ['-C', repoPath, ...args]);
}

export async function ensureAttachedHead(repoPath: string): Promise<string> {
  try {
    return await git(repoPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  } catch {
    throw new Error('repo_dirty: target repository HEAD must be attached to a branch');
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
