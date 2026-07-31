import { randomUUID } from "node:crypto";
import express, { type RequestHandler } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createEntraAuthMiddleware } from "./auth/entra.js";
import { createMcpServer } from "./mcp/server.js";
import type { ToolDeps } from "./mcp/tools.js";

export function startHttpServer(deps: ToolDeps): void {
  const { config } = deps;
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // Liveness probe for container orchestration — deliberately unauthenticated
  // and the only non-MCP route this server exposes.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", name: config.appName, version: config.appVersion });
  });

  const auth: RequestHandler = config.authEnabled
    ? createEntraAuthMiddleware(config)
    : (_req, _res, next) => next();

  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post(config.mcpPath, auth, (req, res) => {
    void (async () => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport = sessionId ? transports.get(sessionId) : undefined;

      if (!transport) {
        if (sessionId || !isInitializeRequest(req.body)) {
          res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Bad Request: no valid session" },
            id: null,
          });
          return;
        }
        const newTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports.set(sid, newTransport);
          },
        });
        newTransport.onclose = () => {
          if (newTransport.sessionId) transports.delete(newTransport.sessionId);
        };
        await createMcpServer(deps).connect(newTransport);
        transport = newTransport;
      }

      await transport.handleRequest(req, res, req.body);
    })().catch((err: unknown) => {
      console.error("MCP request failed:", err);
      if (!res.headersSent) res.status(500).end();
    });
  });

  // GET = SSE notification stream, DELETE = session termination.
  const handleSession: RequestHandler = (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    void transport.handleRequest(req, res).catch((err: unknown) => {
      console.error("MCP session request failed:", err);
      if (!res.headersSent) res.status(500).end();
    });
  };
  app.get(config.mcpPath, auth, handleSession);
  app.delete(config.mcpPath, auth, handleSession);

  app.listen(config.port, () => {
    console.error(
      `${config.appName} listening on http://localhost:${config.port}${config.mcpPath} ` +
        `(auth: ${config.authEnabled ? "Entra ID" : "DISABLED"}, env: ${config.environment})`,
    );
  });
}
