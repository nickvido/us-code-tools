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

describe('issue 21 manifest compatibility', () => {
  it('normalizes pre-feature OLRC manifests to an empty historical-vintages map without migration', async () => {
    const tempDataDir = mkdtempSync(join(tmpdir(), 'us-code-tools-issue21-manifest-'));
    const manifestPath = resolve(tempDataDir, 'manifest.json');
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          version: 1,
          updated_at: '2026-03-29T23:00:00.000Z',
          sources: {
            olrc: {
              selected_vintage: '119-73',
              titles: {
                '1': {
                  title: 1,
                  vintage: '119-73',
                  status: 'downloaded',
                  zip_path: 'data/cache/olrc/vintages/119-73/title-01/xml_usc01@119-73.zip',
                },
              },
            },
          },
        },
        null,
        2,
      ),
    );

    try {
      const mod = await importFresh(resolve(process.cwd(), 'src', 'utils', 'manifest.ts'));
      const readManifest = pickCallable(mod, ['readManifest']);

      const manifest = await readManifest(tempDataDir) as {
        sources?: {
          olrc?: {
            selected_vintage?: string | null;
            titles?: Record<string, unknown>;
            vintages?: Record<string, unknown>;
            available_vintages?: unknown;
          };
        };
      };

      expect(manifest.sources?.olrc?.selected_vintage).toBe('119-73');
      expect(manifest.sources?.olrc?.titles).toHaveProperty('1');
      expect(manifest.sources?.olrc?.vintages).toEqual({});
      expect(manifest.sources?.olrc?.available_vintages ?? null).toBeNull();
    } finally {
      rmSync(tempDataDir, { recursive: true, force: true });
    }
  });
});
