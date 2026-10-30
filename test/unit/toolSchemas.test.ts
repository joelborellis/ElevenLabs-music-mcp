import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/mcp/server.js";
import type { ToolDeps } from "../../src/mcp/tools.js";

// Registration never touches storage/repo, so stubs suffice for tools/list.
const deps = {
  config: { appName: "keepsong-test", appVersion: "0.0.0" },
  storage: {},
  repo: {},
} as unknown as ToolDeps;

/**
 * Paths of every `type: [...]` array and every empty `{}` subschema (accepts
 * anything without saying so) anywhere in the schema.
 */
function unportablePaths(node: unknown, at = "$"): string[] {
  if (Array.isArray(node)) return node.flatMap((v, i) => unportablePaths(v, `${at}[${i}]`));
  if (!node || typeof node !== "object") return [];
  if (Object.keys(node).length === 0) return [at];
  return Object.entries(node).flatMap(([k, v]) =>
    k === "type" && Array.isArray(v) ? [`${at}.type`] : unportablePaths(v, `${at}.${k}`),
  );
}

describe("tool inputSchemas (as served by tools/list)", () => {
  // zod collapses a bare `z.string().nullish()` to `type: ["string","null"]`,
  // which single-type dialects (e.g. Gemini's OpenAPI subset) reject. Giving the
  // inner type a .describe() keeps it as anyOf — see src/models/*.ts. Likewise
  // z.looseObject emits `additionalProperties: {}` unless overridden via .meta().
  it("never use array-valued `type` or empty `{}` subschemas", async () => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "schema-test", version: "0.0.0" });
    await Promise.all([createMcpServer(deps).connect(serverT), client.connect(clientT)]);

    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(unportablePaths(tool.inputSchema), tool.name).toEqual([]);
    }
    await client.close();
  });
});
