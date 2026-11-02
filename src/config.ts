import "dotenv/config";

export type Environment = "development" | "production";
export type StorageBackendKind = "local" | "azure";
export type TransportKind = "http" | "stdio";

export interface AppConfig {
  appName: string;
  appVersion: string;
  environment: Environment;

  // Startup-validated
  openaiApiKey: string;

  // Lazily validated (read by the owning service on first use)
  elevenLabsApiKey: string | undefined;
  finetunesCacheTtlSeconds: number; // 0 disables caching

  // Storage
  storageBackend: StorageBackendKind;
  localStorageDir: string;
  azureStorageAccountUrl: string | undefined;
  azureStorageConnectionString: string | undefined;
  azureStorageContainer: string;

  // Database
  databaseUrl: string;

  // MCP transport
  transport: TransportKind;
  port: number;
  mcpPath: string;

  // Entra ID auth
  authEnabled: boolean;
  entraTenantId: string | undefined;
  /** Accepted `aud` values: client id, api://<client-id>, and the Copilot SSO Application ID URI. */
  entraAudiences: string[];
  /** Delegated scope every token must carry in `scp`; undefined disables the check. */
  entraRequiredScope: string | undefined;

  // Exact origins allowed cross-origin (e.g. the Copilot widget host).
  corsAllowedOrigins: string[];

  // Copilot UI / media
  /** This server's public origin as Copilot and widgets see it (tunnel or Azure URL), no trailing slash. */
  publicBaseUrl: string;
  /** HMAC key for short-lived signed audio URLs; empty → per-process random key (dev only). */
  mediaSigningKey: string;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/** Comma-separated env value → trimmed, non-empty entries. */
function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Blank/unset → access_as_user (so a copied .env.example never silently drops
 * the check); "none" → no scope check.
 */
function parseScope(value: string | undefined): string | undefined {
  const scope = value?.trim();
  if (!scope) return "access_as_user";
  return scope.toLowerCase() === "none" ? undefined : scope;
}

export class ConfigurationError extends Error {}

/**
 * Parse env into a typed config. Pure aside from reading `env`; startup
 * invariants are enforced separately by validateStartupConfig so tests can
 * build configs freely.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const environment: Environment = env.ENVIRONMENT === "production" ? "production" : "development";
  const storageBackend: StorageBackendKind = env.STORAGE_BACKEND === "azure" ? "azure" : "local";
  const transport: TransportKind =
    env.MCP_TRANSPORT === "stdio" || process.argv.includes("--stdio") ? "stdio" : "http";

  const ttlRaw = env.FINETUNES_CACHE_TTL;
  const ttl = ttlRaw == null || ttlRaw === "" ? 300 : Number(ttlRaw);
  if (!Number.isFinite(ttl) || ttl < 0) {
    throw new ConfigurationError(`FINETUNES_CACHE_TTL must be a non-negative number, got "${ttlRaw}"`);
  }

  const port = Number(env.MCP_PORT || 3000);

  return {
    appName: env.APP_NAME ?? "keepsong-mcp",
    appVersion: env.APP_VERSION ?? "0.1.0",
    environment,
    openaiApiKey: env.OPENAI_API_KEY ?? "",
    elevenLabsApiKey: env.ELEVENLABS_API_KEY || undefined,
    finetunesCacheTtlSeconds: ttl,
    storageBackend,
    localStorageDir: env.LOCAL_STORAGE_DIR || "output/music",
    azureStorageAccountUrl: env.AZURE_STORAGE_ACCOUNT_URL || undefined,
    azureStorageConnectionString: env.AZURE_STORAGE_CONNECTION_STRING || undefined,
    azureStorageContainer: env.AZURE_STORAGE_CONTAINER || "music",
    databaseUrl: env.DATABASE_URL || "./data/renders.db",
    transport,
    port,
    mcpPath: env.MCP_PATH || "/mcp",
    // Auth defaults on in production, off in development; never applies to stdio.
    authEnabled: parseBool(env.AUTH_ENABLED, environment === "production"),
    entraTenantId: env.ENTRA_TENANT_ID || undefined,
    entraAudiences: parseList(env.ENTRA_AUDIENCE),
    entraRequiredScope: parseScope(env.ENTRA_REQUIRED_SCOPE),
    corsAllowedOrigins: parseList(env.CORS_ALLOWED_ORIGINS),
    publicBaseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
    mediaSigningKey: env.MEDIA_SIGNING_KEY || "",
  };
}

/**
 * Hard-fail-fast checks (spec §9.1): these crash the process at boot rather
 * than failing the first user-facing call. ELEVENLABS_API_KEY is deliberately
 * NOT checked here — it is lazily validated by the shared ElevenLabs client.
 */
export function validateStartupConfig(config: AppConfig): void {
  if (!config.openaiApiKey) {
    throw new ConfigurationError(
      "OPENAI_API_KEY is required at startup (prompt generation cannot function without it).",
    );
  }
  if (config.storageBackend === "azure") {
    if (!config.azureStorageAccountUrl && !config.azureStorageConnectionString) {
      throw new ConfigurationError(
        "STORAGE_BACKEND=azure requires AZURE_STORAGE_ACCOUNT_URL or AZURE_STORAGE_CONNECTION_STRING.",
      );
    }
  }
  if (config.transport === "http" && config.authEnabled) {
    if (!config.entraTenantId || config.entraAudiences.length === 0) {
      throw new ConfigurationError(
        "AUTH_ENABLED requires ENTRA_TENANT_ID and ENTRA_AUDIENCE (comma-separated list) to be set.",
      );
    }
  }
  // Signed audio links must survive restarts and replicas in production.
  if (config.transport === "http" && config.environment === "production" && !config.mediaSigningKey) {
    throw new ConfigurationError("MEDIA_SIGNING_KEY is required when ENVIRONMENT=production.");
  }
}
