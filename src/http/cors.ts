import type { RequestHandler } from "express";

/**
 * Exact-origin CORS for browser callers such as Copilot's MCP Apps widget host
 * ({sha256-of-mcp-domain}.widget-renderer.usercontent.microsoft.com). Auth is
 * a bearer header, not cookies, so no credentials mode. Preflights are
 * answered here, before auth, because browsers never attach the token to them.
 */
/** Distinct origins logged so far: enough to spot the real widget host, bounded against noise. */
const MAX_LOGGED_ORIGINS = 20;

export function createCorsMiddleware(
  allowedOrigins: string[],
  log: (line: string) => void = (line) => console.error(line),
): RequestHandler {
  const allowed = new Set(allowedOrigins);
  const seen = new Set<string>();
  return (req, res, next) => {
    const origin = req.headers.origin;
    const permitted = origin != null && allowed.has(origin);
    // CORS_ALLOWED_ORIGINS lists the widget host twice (".usercontent.microsoft"
    // and ".usercontent.microsoft.com"); this line says which one browsers send.
    if (origin != null && !seen.has(origin) && seen.size < MAX_LOGGED_ORIGINS) {
      seen.add(origin);
      log(`CORS: first request from origin ${origin} (${permitted ? "allowed" : "not in CORS_ALLOWED_ORIGINS"})`);
    }
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
