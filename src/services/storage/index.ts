import type { AppConfig } from "../../config.js";
import { LocalStorageBackend } from "./local.js";

/**
 * Storage abstraction (spec §6.1). The key is simply the output filename —
 * the same string is the DB row's blob_key, filename, and the object key.
 * Bytes are always proxied through the app, never redirected.
 */
export interface StorageBackend {
  /** Persist bytes; returns the canonical URL/URI (file:// locally, blob URL on Azure). */
  save(key: string, data: Buffer, contentType: string): Promise<string>;
  openStream(key: string): AsyncIterable<Buffer>;
  getBytes(key: string): Promise<Buffer | null>;
  /** No-op if the object is missing. */
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/**
 * Select and construct the backend. Called eagerly at startup (spec §9.1) so a
 * misconfigured Azure backend crashes the process immediately instead of
 * failing the first render. The Azure SDK is loaded dynamically so local-dev
 * runs never touch it.
 */
export async function createStorageBackend(config: AppConfig): Promise<StorageBackend> {
  if (config.storageBackend === "azure") {
    const { createAzureBlobBackend } = await import("./azureBlob.js");
    return createAzureBlobBackend(config);
  }
  return new LocalStorageBackend(config.localStorageDir);
}
