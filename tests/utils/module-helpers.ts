import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export type AnyFn = (...args: unknown[]) => unknown;

export async function safeImport(modulePath: string): Promise<Record<string, unknown>> {
  try {
    return (await import(modulePath)) as Record<string, unknown>;
  } catch (error) {
    return { __importError: error as Error } as Record<string, unknown>;
  }
}

export function ensureModuleLoaded(modulePath: string, moduleExports: Record<string, unknown>): void {
  if ((moduleExports as { __importError?: Error }).__importError) {
    throw new Error(`Module missing: ${modulePath}`);
  }
}

export function pickCallable(moduleExports: Record<string, unknown>, names: string[]): AnyFn {
  if ((moduleExports as { __importError?: Error }).__importError) {
    const err = (moduleExports as { __importError?: Error }).__importError;
    throw new Error(`Cannot read from module due import error: ${err?.message ?? 'unknown'}`);
  }

  for (const name of names) {
    const value = moduleExports[name];
    if (typeof value === 'function') {
      return value as AnyFn;
    }
  }

  if (typeof moduleExports.default === 'function') {
    return moduleExports.default as AnyFn;
  }

  if (moduleExports.default && typeof moduleExports.default === 'object') {
    for (const key of names) {
      const nested = (moduleExports.default as Record<string, unknown>)[key];
      if (typeof nested === 'function') {
        return nested as AnyFn;
      }
    }
  }

  throw new Error(`No callable export found; expected one of: ${names.join(', ')}`);
}

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
