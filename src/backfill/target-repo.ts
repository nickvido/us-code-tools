import { mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { HistoricalEvent } from './planner.js';
import { git } from './git-adapter.js';

export interface PreparedTargetRepo {
  repoPath: string;
  branch: string;
  hasConfiguredPushRemote: boolean;
  matchingPrefixLength: number;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  const info = await stat(path);
  return info.isDirectory();
}

async function ensureGitRepo(targetPath: string): Promise<string> {
  const repoPath = resolve(targetPath);
  const exists = await pathExists(repoPath);

  if (!exists) {
    await mkdir(repoPath, { recursive: true });
    await git(repoPath, ['init']);
    return repoPath;
  }

  if (!(await isDirectory(repoPath))) {
    throw new Error('--target must point to a directory or a path that does not exist yet');
  }

  const gitDir = resolve(repoPath, '.git');
  if (await pathExists(gitDir)) {
    return repoPath;
  }

  const entries = await readdir(repoPath);
  if (entries.length > 0) {
    throw new Error('--target points to a populated non-git directory; refusing to initialize git over existing content');
  }

  await git(repoPath, ['init']);
  return repoPath;
}

async function ensureAttachedHead(repoPath: string): Promise<string> {
  try {
    return await git(repoPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  } catch {
    throw new Error('target repository HEAD must be attached to a branch');
  }
}

async function ensureCleanWorkingTree(repoPath: string): Promise<void> {
  const status = await git(repoPath, ['status', '--porcelain']);
  if (status.trim() !== '') {
    throw new Error('target repository working tree must be clean before backfill');
  }
}

function normalizeMessage(message: string): string {
  return message.replace(/\r\n/g, '\n').trim();
}

function toIsoDateFromUnixSeconds(value: number): string {
  return new Date(value * 1000).toISOString().slice(0, 10);
}

function parseCommitObject(raw: string): { authorName: string; authorEmail: string; ratified: string; message: string } {
  const [headerText, ...messageParts] = raw.split('\n\n');
  const headers = headerText.split('\n');
  const authorLine = headers.find((line) => line.startsWith('author '));
  if (!authorLine) {
    throw new Error('target repository history is not an empty history or contiguous Constitution prefix (non-prefix history)');
  }

  const match = /^author (.+) <([^>]+)> (-?\d+) [+-]\d{4}$/.exec(authorLine);
  if (!match) {
    throw new Error('target repository history is not an empty history or contiguous Constitution prefix (non-prefix history)');
  }

  return {
    authorName: match[1],
    authorEmail: match[2],
    ratified: toIsoDateFromUnixSeconds(Number(match[3])),
    message: messageParts.join('\n\n'),
  };
}

export async function detectMatchingPrefix(repoPath: string, plan: HistoricalEvent[]): Promise<number> {
  const revList = await git(repoPath, ['rev-list', '--reverse', 'HEAD']).catch(() => '');
  const shas = revList.split('\n').map((line) => line.trim()).filter(Boolean);
  if (shas.length === 0) {
    return 0;
  }

  if (shas.length > plan.length) {
    throw new Error('target repository history is not an empty history or contiguous Constitution prefix (non-prefix history)');
  }

  let prefixLength = 0;
  for (let index = 0; index < shas.length; index += 1) {
    const rawCommit = await git(repoPath, ['cat-file', '-p', shas[index]]);
    const commit = parseCommitObject(rawCommit);
    const event = plan[index];
    if (commit.authorName !== event.authorName || commit.authorEmail !== event.authorEmail || commit.ratified !== event.ratified || normalizeMessage(commit.message) !== normalizeMessage(event.commitMessage)) {
      throw new Error('target repository history is not an empty history or contiguous Constitution prefix (non-prefix history)');
    }
    prefixLength += 1;
  }

  return prefixLength;
}

export async function prepareTargetRepo(targetPath: string, plan: HistoricalEvent[]): Promise<PreparedTargetRepo> {
  const repoPath = await ensureGitRepo(targetPath);
  const branch = await ensureAttachedHead(repoPath);
  await ensureCleanWorkingTree(repoPath);
  const matchingPrefixLength = await detectMatchingPrefix(repoPath, plan);
  const hasConfiguredPushRemote = (await git(repoPath, ['remote'])).trim() !== '';
  return { repoPath, branch, hasConfiguredPushRemote, matchingPrefixLength };
}
