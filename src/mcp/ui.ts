import { readFile } from "node:fs/promises";
import path from "node:path";
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../config.js";
import { PACKAGE_ROOT } from "../paths.js";

/**
 * The Keepsong Studio card: ONE MCP Apps resource shared by every widget tool.
 * The bundled React app (widgets/ → assets/studio.html) decides which state to
 * show from `structuredContent.kind` of whichever tool result it receives.
 */
export const STUDIO_URI = "ui://keepsong/studio.html";
export const STUDIO_ASSET = path.join(PACKAGE_ROOT, "assets", "studio.html");

// Shown (instead of a resource error) when the widget bundle hasn't been built.
const PLACEHOLDER_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Keepsong Studio</title></head>
<body style="font-family:system-ui;padding:16px;color:#444">
<strong>Keepsong Studio is not built.</strong><br>Run <code>npm run build:widgets</code> in the keepsong-mcp repo.
</body></html>`;

// Read from disk on every request: hosts fetch the template once per card, so
// the cost is negligible, and a widget rebuild shows up without a restart in
// any environment.
async function loadStudioHtml(): Promise<string> {
  try {
    return await readFile(STUDIO_ASSET, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return PLACEHOLDER_HTML;
    throw err;
  }
}

/** Origin the widget may fetch from / load media from — this server's public URL. */
function publicOrigin(config: AppConfig): string | undefined {
  try {
    return new URL(config.publicBaseUrl).origin;
  } catch {
    return undefined;
  }
}

export function registerStudioResource(server: McpServer, config: AppConfig): void {
  const origin = publicOrigin(config);
  const csp = origin ? { connectDomains: [origin], resourceDomains: [origin] } : {};

  registerAppResource(
    server,
    "Keepsong Studio",
    STUDIO_URI,
    {
      description: "Interactive music card: brief, style, composing progress, player and versions.",
      _meta: { ui: { csp } },
    },
    async () => {
      // Same trick as Microsoft's samples: tell the bundle where its server lives.
      const html = (await loadStudioHtml()).replace(
        "<head>",
        `<head><script>window.__KEEPSONG_BASE_URL__=${JSON.stringify(config.publicBaseUrl)};</script>`,
      );
      return {
        contents: [{ uri: STUDIO_URI, mimeType: RESOURCE_MIME_TYPE, text: html, _meta: { ui: { csp } } }],
      };
    },
  );
}
