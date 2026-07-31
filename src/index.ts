#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, validateStartupConfig } from "./config.js";
import { createDbConnection, runMigrations } from "./db/client.js";
import { createRenderRepository } from "./db/renderRepository.js";
import { createMcpServer } from "./mcp/server.js";
import { createStorageBackend } from "./services/storage/index.js";
import { startHttpServer } from "./httpServer.js";

// All logging goes to stderr: in stdio mode, stdout carries the MCP protocol.
async function main(): Promise<void> {
  const config = loadConfig();
  validateStartupConfig(config); // hard-fail-fast (spec §9.1)

  // Eagerly constructed so a misconfigured Azure backend crashes at boot,
  // not on the first render (spec §9.1).
  const storage = await createStorageBackend(config);

  const conn = await createDbConnection(config);
  if (config.environment === "development") {
    // Dev-only auto-create shortcut (spec §6.2). Production applies
    // migrations out-of-band via `npm run db:init`, never at startup.
    await runMigrations(conn);
  }
  const repo = createRenderRepository(conn);
  const deps = { config, storage, repo };

  if (config.transport === "stdio") {
    const server = createMcpServer(deps);
    await server.connect(new StdioServerTransport());
    console.error(`${config.appName} running on stdio`);
  } else {
    startHttpServer(deps);
  }
}

main().catch((err: unknown) => {
  console.error("Fatal startup error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
