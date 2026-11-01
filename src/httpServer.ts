import express, { type RequestHandler } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createEntraAuthMiddleware } from "./auth/entra.js";
import { createCorsMiddleware } from "./http/cors.js";
import { createMcpServer } from "./mcp/server.js";
import type { ToolDeps } from "./mcp/tools.js";

/**
 * Stateless Streamable HTTP (as in Microsoft's Copilot MCP samples): every
 * POST gets its own transport + McpServer, so there are no session ids to
 * lose, any replica can serve any request, and every request is authenticated
 * on its own. Progress notifications still stream on the POST's SSE response.
 */
export function createHttpApp(deps: ToolDeps): express.Express {
  const { config } = deps;
  const app = express();
  app.use(createCorsMiddleware(config.corsAllowedOrigins));
  app.use(express.json({ limit: "10mb" }));

  // Liveness probe for container orchestration — deliberately unauthenticated
  // and the only non-MCP route this server exposes.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", name: config.appName, version: config.appVersion });
  });

  const auth: RequestHandler = config.authEnabled
    ? createEntraAuthMiddleware(config)
    : (_req, _res, next) => next();

  app.post(config.mcpPath, auth, (req, res) => {
    void (async () => {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const server = createMcpServer(deps);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    })().catch((err: unknown) => {
      console.error("MCP request failed:", err);
      if (!res.headersSent) res.status(500).end();
    });
  });

  // No standalone SSE stream or session teardown without sessions.
  const methodNotAllowed: RequestHandler = (_req, res) => {
    res
      .status(405)
      .set("Allow", "POST")
      .json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed: stateless server, use POST" },
        id: null,
      });
  };
  app.get(config.mcpPath, methodNotAllowed);
  app.delete(config.mcpPath, methodNotAllowed);

  return app;
}

export function startHttpServer(deps: ToolDeps): void {
  const { config } = deps;
  createHttpApp(deps).listen(config.port, () => {
    const auth = config.authEnabled
      ? `Entra ID, ${config.entraAudiences.length} audience(s), scope: ${config.entraRequiredScope ?? "not required"}`
      : "DISABLED";
    console.error(
      `${config.appName} listening on http://localhost:${config.port}${config.mcpPath} ` +
        `(auth: ${auth}, CORS origins: ${config.corsAllowedOrigins.length}, env: ${config.environment})`,
    );
  });
}
