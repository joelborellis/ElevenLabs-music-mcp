import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDeps } from "./tools.js";
import { renderUri } from "./tools.js";

/**
 * keepsong://renders/{id} — the single way audio bytes leave this server
 * (deployment decision: no plain-HTTP download/stream routes). Collapses the
 * Python app's download/stream endpoints into one MCP resource read.
 * resources/list is backed by listRenders(), newest-first.
 */
export function registerResources(server: McpServer, deps: ToolDeps): void {
  const template = new ResourceTemplate("keepsong://renders/{id}", {
    list: async () => {
      const rows = await deps.repo.listRenders();
      return {
        resources: rows
          .filter((row) => row.status === "complete")
          .map((row) => ({
            uri: renderUri(row.id),
            name: row.title || row.filename || row.id,
            description: [
              row.mode ? `mode: ${row.mode}` : null,
              row.duration_ms != null ? `${Math.round(row.duration_ms / 1000)}s` : null,
              row.created_at.toISOString(),
            ]
              .filter(Boolean)
              .join(", "),
            mimeType: row.content_type,
          })),
      };
    },
  });

  server.registerResource(
    "renders",
    template,
    {
      title: "Rendered music",
      description: "Audio files produced by render_music, addressed by render id.",
    },
    async (uri, variables) => {
      const id = String(variables.id ?? "");
      const row = await deps.repo.getById(id);
      if (!row) throw new Error(`Render not found: ${id}`);
      if (row.status !== "complete") {
        throw new Error(
          `Render ${id} is not complete (status: ${row.status}${row.error ? `, error: ${row.error}` : ""}).`,
        );
      }
      if (!row.blob_key) throw new Error(`Render ${id} has no stored audio.`);
      const bytes = await deps.storage.getBytes(row.blob_key);
      if (!bytes) {
        throw new Error(`Audio for render ${id} is missing from storage (key: ${row.blob_key}).`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: row.content_type,
            blob: bytes.toString("base64"),
          },
        ],
      };
    },
  );
}
