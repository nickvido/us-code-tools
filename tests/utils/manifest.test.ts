import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type CandidateModule = Record<string, unknown>;

function pickCallable(module: CandidateModule, candidates: string[]) {
  for (const name of candidates) {
    const value = module[name as keyof CandidateModule];
    if (typeof value === 'function') {
      return value as (...args: unknown[]) => Promise<unknown> | unknown;
    }
  }

  throw new Error(`No callable export found for: ${candidates.join(', ')}`);
}

async function importFresh(modulePath: string): Promise<CandidateModule> {
  return (await import(pathToFileURL(modulePath).href)) as CandidateModule;
}

describe('manifest persistence safety', () => {
  it('surfaces corrupted manifest JSON instead of silently replacing history with an empty manifest', async () => {
    const tempDataDir = mkdtempSync(join(tmpdir(), 'us-code-tools-manifest-'));
    const manifestPath = resolve(tempDataDir, 'manifest.json');
    writeFileSync(manifestPath, '{"sources": { invalid-json');

    try {
      const mod = await importFresh(resolve(process.cwd(), 'src', 'utils', 'manifest.ts'));
      const readManifest = pickCallable(mod, ['readManifest']);

      await expect(readManifest(tempDataDir)).rejects.toThrow(/manifest|json|parse|corrupt/i);
    } finally {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });
});
