import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync, spawn } from 'node:child_process';

const VINTAGE = '119-73';
const FIXTURES = [
  {
    title: '4',
    outputPath: [
      'uscode',
      'title-04-flag-and-seal-seat-of-government-and-the-states',
      'chapter-001-the-flag.md',
    ],
    expectedPath: ['tests', 'golden', 'title-04-chapter-001-the-flag.expected.md'],
  },
  {
    title: '18',
    outputPath: [
      'uscode',
      'title-18-crimes-and-criminal-procedure',
      'chapter-044-firearms.md',
    ],
    expectedPath: ['tests', 'golden', 'title-18-chapter-044-firearms.expected.md'],
  },
] as const;

async function runBackfill(repoRoot: string, outputDir: string) {
  const distEntry = resolve(repoRoot, 'dist', 'index.js');

  return await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [distEntry, 'backfill', '--phase', 'olrc', '--target', outputDir, '--vintages', VINTAGE],
      {
        cwd: repoRoot,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', rejectPromise);
    child.on('close', (status) => {
      resolvePromise({ status, stdout, stderr });
    });
  });
}

describe('golden chapter markdown output', () => {
  const repoRoot = process.cwd();
  const sandboxRoot = mkdtempSync(join(tmpdir(), 'us-code-tools-golden-'));
  const outputRoot = resolve(sandboxRoot, 'out');

  beforeAll(async () => {
    execSync('npm run build', { cwd: repoRoot, stdio: 'ignore' });
    const result = await runBackfill(repoRoot, outputRoot);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  }, 300_000);

  afterAll(() => {
    rmSync(sandboxRoot, { recursive: true, force: true });
  });

  it.each(FIXTURES)('matches current chapter markdown for title $title', ({ outputPath, expectedPath }) => {
    const actualMarkdown = readFileSync(resolve(outputRoot, ...outputPath), 'utf8');
    const expectedMarkdown = readFileSync(resolve(repoRoot, ...expectedPath), 'utf8');

    expect(actualMarkdown).toBe(expectedMarkdown);
  });
});
