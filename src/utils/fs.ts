import { mkdir, rename, writeFile, lstat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function assertSafeOutputPath(outputRoot: string, targetPath: string): Promise<void> {
  const resolvedRoot = resolve(outputRoot);
  const resolvedTarget = resolve(targetPath);

  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Refusing to write outside output root: ${resolvedTarget}`);
  }

  let cursor = dirname(resolvedTarget);
  while (cursor.startsWith(resolvedRoot) && cursor !== resolvedRoot) {
    try {
      const stats = await lstat(cursor);
      if (stats.isSymbolicLink()) {
        throw new Error(`Refusing symlinked output directory: ${cursor}`);
      }
    } catch {
      // Missing segments are fine; they will be created.
    }
    cursor = dirname(cursor);
  }
}

export async function atomicWriteFile(targetPath: string, content: string): Promise<void> {
  const directory = dirname(targetPath);
  await mkdir(directory, { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, content, 'utf8');
  await rename(tempPath, targetPath);
}
