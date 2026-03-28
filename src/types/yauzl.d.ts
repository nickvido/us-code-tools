declare module 'yauzl' {
  import type { Readable } from 'node:stream';

  export interface Entry {
    fileName: string;
  }

  export interface ZipFile {
    readEntry(): void;
    close(): void;
    on(event: 'entry', listener: (entry: Entry) => void): this;
    once(event: 'end' | 'error', listener: (error?: Error) => void): this;
    openReadStream(entry: Entry, callback: (error: Error | null, stream?: Readable) => void): void;
  }

  export function open(path: string, options: { lazyEntries: boolean }, callback: (error: Error | null, zipFile?: ZipFile) => void): void;
  export function fromBuffer(buffer: Buffer, options: { lazyEntries: boolean }, callback: (error: Error | null, zipFile?: ZipFile) => void): void;

  const yauzl: {
    open: typeof open;
    fromBuffer: typeof fromBuffer;
  };

  export default yauzl;
}
