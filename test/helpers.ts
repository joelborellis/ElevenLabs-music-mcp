import type { AppConfig } from "../src/config.js";

export function makeTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    appName: "keepsong-mcp-test",
    appVersion: "0.0.0",
    environment: "development",
    openaiApiKey: "test-openai-key",
    elevenLabsApiKey: "test-elevenlabs-key",
    finetunesCacheTtlSeconds: 300,
    storageBackend: "local",
    localStorageDir: "output/music",
    azureStorageAccountUrl: undefined,
    azureStorageConnectionString: undefined,
    azureStorageContainer: "music",
    databaseUrl: "./data/renders.db",
    transport: "http",
    port: 3000,
    mcpPath: "/mcp",
    authEnabled: false,
    entraTenantId: undefined,
    entraAudience: undefined,
    ...overrides,
  };
}
