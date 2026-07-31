import {
  BlobServiceClient,
  RestError,
  type ContainerClient,
} from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import type { AppConfig } from "../../config.js";
import { ConfigurationError } from "../../config.js";
import type { StorageBackend } from "./index.js";

class AzureBlobBackend implements StorageBackend {
  constructor(private readonly container: ContainerClient) {}

  async save(key: string, data: Buffer, contentType: string): Promise<string> {
    const blob = this.container.getBlockBlobClient(key);
    // upload() overwrites by default, matching the Python backend's overwrite=True.
    await blob.upload(data, data.length, {
      blobHTTPHeaders: { blobContentType: contentType },
    });
    return blob.url;
  }

  async *openStream(key: string): AsyncIterable<Buffer> {
    const blob = this.container.getBlockBlobClient(key);
    const response = await blob.download();
    const body = response.readableStreamBody;
    if (!body) return;
    for await (const chunk of body) {
      yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    }
  }

  async getBytes(key: string): Promise<Buffer | null> {
    const blob = this.container.getBlockBlobClient(key);
    try {
      return await blob.downloadToBuffer();
    } catch (err) {
      if (err instanceof RestError && err.statusCode === 404) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.container.getBlockBlobClient(key).deleteIfExists();
  }

  async exists(key: string): Promise<boolean> {
    return this.container.getBlockBlobClient(key).exists();
  }
}

/**
 * Auth precedence (spec §6.1): connection string first (dev, no az login),
 * else account URL + managed identity (DefaultAzureCredential) for production.
 * The container is created on first use, idempotently.
 */
export async function createAzureBlobBackend(config: AppConfig): Promise<StorageBackend> {
  let service: BlobServiceClient;
  if (config.azureStorageConnectionString) {
    service = BlobServiceClient.fromConnectionString(config.azureStorageConnectionString);
  } else if (config.azureStorageAccountUrl) {
    service = new BlobServiceClient(config.azureStorageAccountUrl, new DefaultAzureCredential());
  } else {
    throw new ConfigurationError(
      "Azure storage requires AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT_URL.",
    );
  }
  const container = service.getContainerClient(config.azureStorageContainer);
  await container.createIfNotExists();
  return new AzureBlobBackend(container);
}
