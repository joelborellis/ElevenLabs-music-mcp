import express, { type Request, type RequestHandler, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createEntraAuthMiddleware } from "./auth/entra.js";
import { createCorsMiddleware } from "./http/cors.js";
import { createMcpServer } from "./mcp/server.js";
import type { ToolDeps } from "./mcp/tools.js";
import { verifyRenderSignature } from "./services/media.js";

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

  // Liveness probe for container orchestration — deliberately unauthenticated.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", name: config.appName, version: config.appVersion });
  });

  // Rendered audio for the studio card's player. Authenticated by the signed
  // URL (see services/media.ts), not by a bearer token: <audio> can't send one.
  app.get("/media/renders/:id", (req, res) => {
    void serveRenderAudio(deps, req, res).catch((err: unknown) => {
      console.error("Media request failed:", err);
      if (!res.headersSent) res.status(500).end();
    });
  });

  const auth: RequestHandler = config.authEnabled
    ? createEntraAuthMiddleware(config)
    : (_req, _res, next) => next();

  // Copilot fetches the widget template (resources/read ui://…) without a user
  // token, as in Microsoft's samples. Only that exact call may skip auth;
  // tools and keepsong:// audio resources always require a token.
  const mcpAuth: RequestHandler = (req, res, next) => {
    if (!req.headers.authorization && isUiTemplateRead(req.body)) {
      next();
      return;
    }
    auth(req, res, next);
  };

  app.post(config.mcpPath, mcpAuth, (req, res) => {
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

/** True only when every JSON-RPC message in the body is `resources/read` of a `ui://` URI. */
export function isUiTemplateRead(body: unknown): boolean {
  const messages = Array.isArray(body) ? body : [body];
  if (messages.length === 0) return false;
  return messages.every((message) => {
    if (!message || typeof message !== "object") return false;
    const { method, params } = message as { method?: unknown; params?: { uri?: unknown } };
    return (
      method === "resources/read" && typeof params?.uri === "string" && params.uri.startsWith("ui://")
    );
  });
}

async function serveRenderAudio(deps: ToolDeps, req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const query = req.query as Record<string, string | undefined>;
  if (!verifyRenderSignature(deps.config, id, query.exp, query.sig)) {
    res.status(403).json({ error: "forbidden", detail: "Invalid or expired media link" });
    return;
  }
  const row = await deps.repo.getById(id);
  if (!row || row.status !== "complete" || !row.blob_key) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const bytes = await deps.storage.getBytes(row.blob_key);
  if (!bytes) {
    res.status(404).json({ error: "not_found", detail: "Audio missing from storage" });
    return;
  }

  res.set({
    "Content-Type": row.content_type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "Content-Disposition": `inline; filename="${(row.filename ?? `${id}.mp3`).replace(/"/g, "")}"`,
  });

  // Range support so the player can scrub; files are a few MB, so slicing an
  // in-memory buffer is simpler and safer than a seeking stream.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    if (start > end || start >= bytes.length) {
      res.status(416).set("Content-Range", `bytes */${bytes.length}`).end();
      return;
    }
    res
      .status(206)
      .set("Content-Range", `bytes ${start}-${end}/${bytes.length}`)
      .set("Content-Length", String(end - start + 1))
      .end(bytes.subarray(start, end + 1));
    return;
  }
  res.set("Content-Length", String(bytes.length)).end(bytes);
}

export function startHttpServer(deps: ToolDeps): void {
  const { config } = deps;
  createHttpApp(deps).listen(config.port, () => {
    const auth = config.authEnabled
      ? `Entra ID, ${config.entraAudiences.length} audience(s), scope: ${config.entraRequiredScope ?? "not required"}`
      : "DISABLED";
    console.error(
      `${config.appName} listening on http://localhost:${config.port}${config.mcpPath} ` +
        `(auth: ${auth}, CORS origins: ${config.corsAllowedOrigins.length}, public URL: ${config.publicBaseUrl}, env: ${config.environment})`,
    );
  });
}
