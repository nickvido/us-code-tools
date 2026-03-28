import { readFileSync } from 'node:fs';

(globalThis as typeof globalThis & { readFile?: (path: string, encoding: BufferEncoding) => string }).readFile = (
  path: string,
  encoding: BufferEncoding,
): string => readFileSync(path, encoding);
