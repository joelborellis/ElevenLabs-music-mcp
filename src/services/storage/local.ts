import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { StorageBackend } from "./index.js";

const STREAM_CHUNK_BYTES = 8192;

export class LocalStorageBackend implements StorageBackend {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    // Resolved relative to the project root (cwd), matching the Python app.
    this.baseDir = path.resolve(baseDir);
  }

  /** Keys may contain '/' for subdirectories but must stay under baseDir. */
  private resolveKey(key: string): string {
    const full = path.resolve(this.baseDir, key);
    if (full !== this.baseDir && !full.startsWith(this.baseDir + path.sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return full;
  }

  async save(key: string, data: Buffer, _contentType: string): Promise<string> {
    const full = this.resolveKey(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
    return pathToFileURL(full).href;
  }

  async *openStream(key: string): AsyncIterable<Buffer> {
    const stream = createReadStream(this.resolveKey(key), {
      highWaterMark: STREAM_CHUNK_BYTES,
    });
    for await (const chunk of stream) {
      yield chunk as Buffer;
    }
  }

  async getBytes(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolveKey(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }
}
