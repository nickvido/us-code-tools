import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { HistoricalEvent } from './planner.js';

const execFileAsync = promisify(execFile);

export interface GitCommitEnvInput {
  ratified: string;
  authorName: string;
  authorEmail: string;
}

function assertIsoDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
}

export function buildGitCommitEnv(input: GitCommitEnvInput): Record<string, string> {
  assertIsoDate(input.ratified);
  return {
    GIT_AUTHOR_NAME: input.authorName,
    GIT_AUTHOR_EMAIL: input.authorEmail,
    GIT_AUTHOR_DATE: `${input.ratified}T00:00:00+0000`,
    GIT_COMMITTER_DATE: `${input.ratified}T00:00:00+0000`,
  };
}

function isoDateToUnixSeconds(value: string): number {
  assertIsoDate(value);
  return Math.floor(new Date(`${value}T00:00:00.000Z`).getTime() / 1000);
}

export async function git(repoPath: string, args: string[], env?: Record<string, string>): Promise<string> {
  const result = await execFileAsync('git', ['-C', repoPath, ...args], {
    env: {
      ...process.env,
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? 'us-code-tools',
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? 'sync@us-code-tools.local',
      ...env,
    },
  });

  return result.stdout.trim();
}

export async function commitHistoricalEvent(repoPath: string, branch: string, event: HistoricalEvent): Promise<void> {
  const parent = await git(repoPath, ['rev-parse', '--verify', 'HEAD']).catch(() => '');
  const committerName = process.env.GIT_COMMITTER_NAME ?? 'us-code-tools';
  const committerEmail = process.env.GIT_COMMITTER_EMAIL ?? 'sync@us-code-tools.local';
  const timestamp = isoDateToUnixSeconds(event.ratified);

  const lines: string[] = [
    `commit refs/heads/${branch}`,
    `author ${event.authorName} <${event.authorEmail}> ${timestamp} +0000`,
    `committer ${committerName} <${committerEmail}> ${timestamp} +0000`,
    `data ${Buffer.byteLength(event.commitMessage, 'utf8')}`,
    event.commitMessage,
  ];

  if (parent) {
    lines.push(`from ${parent}`);
  }

  for (const write of event.writes) {
    lines.push(`M 100644 inline ${write.path}`);
    lines.push(`data ${Buffer.byteLength(write.content, 'utf8')}`);
    lines.push(write.content);
  }

  lines.push('');

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn('git', ['-C', repoPath, 'fast-import', '--quiet'], {
      env: {
        ...process.env,
        GIT_COMMITTER_NAME: committerName,
        GIT_COMMITTER_EMAIL: committerEmail,
      },
      stdio: ['pipe', 'ignore', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(stderr.trim() || `git fast-import exited with code ${code ?? 'unknown'}`));
    });
    child.stdin.end(`${lines.join('\n')}\n`);
  });

  await git(repoPath, ['reset', '--hard', 'HEAD']);
}
