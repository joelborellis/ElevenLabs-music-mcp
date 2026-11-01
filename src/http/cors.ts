import type { RequestHandler } from "express";

/**
 * Exact-origin CORS for browser callers such as Copilot's MCP Apps widget host
 * ({sha256-of-mcp-domain}.widget-renderer.usercontent.microsoft.com). Auth is
 * a bearer header, not cookies, so no credentials mode. Preflights are
 * answered here, before auth, because browsers never attach the token to them.
 */
export function createCorsMiddleware(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    const origin = req.headers.origin;
    const permitted = origin != null && allowed.has(origin);
    if (permitted) {
      res.set("Access-Control-Allow-Origin", origin);
      res.vary("Origin");
    }
    if (req.method !== "OPTIONS") {
      next();
      return;
    }
    if (permitted) {
      res.set({
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Protocol-Version",
        "Access-Control-Max-Age": "600",
      });
    }
    res.status(204).end();
  };
}
