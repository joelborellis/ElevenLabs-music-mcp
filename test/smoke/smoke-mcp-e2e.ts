/**
 * End-to-end smoke test against a RUNNING server's real MCP surface:
 * tools/list → list_finetunes → generate_composition_plan → render_music
 * (with progress notifications) → get_render_status → resources/list →
 * resource read. COSTS REAL CREDITS (one ~8s render).
 *
 *   npm run dev          # in one terminal
 *   npx tsx test/smoke/smoke-mcp-e2e.ts [--url http://localhost:3000/mcp]
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const urlFlag = process.argv.indexOf("--url");
const url = urlFlag !== -1 ? process.argv[urlFlag + 1]! : "http://localhost:3000/mcp";

const client = new Client({ name: "keepsong-smoke", version: "0.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));

function firstText(result: { content?: unknown }): Record<string, unknown> {
  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content.find((c) => c.type === "text")?.text ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

const tools = await client.listTools();
console.log(`tools: ${tools.tools.map((t) => t.name).join(", ")}`);

const finetunes = firstText(
  await client.callTool({ name: "list_finetunes", arguments: { model_id: "music_v2" } }),
);
console.log(`list_finetunes: ${finetunes.count} completed music_v2 finetunes`);

const plan = firstText(
  await client.callTool({
    name: "generate_composition_plan",
    arguments: { prompt: "A 12-second upbeat indie pop sting with clean guitars." },
  }),
);
const chunks = plan.chunks as Array<{ duration_ms: number }>;
console.log(
  `generate_composition_plan: ${chunks.length} chunks, total ${chunks.reduce((s, c) => s + c.duration_ms, 0)}ms`,
);

const progressLog: string[] = [];
const renderRaw = await client.callTool(
  {
    name: "render_music",
    arguments: {
      title: "MCP E2E Smoke",
      prompt: "A short, upbeat 8-second bright pop-electro hook at 120 BPM.",
      music_length_ms: 8000,
      force_instrumental: true,
      output_format: "mp3_44100_128",
    },
  },
  undefined,
  {
    timeout: 300_000,
    resetTimeoutOnProgress: true,
    onprogress: (p) => {
      progressLog.push(`${p.progress}%${p.message ? ` ${p.message}` : ""}`);
    },
  },
);
if (renderRaw.isError) {
  console.error("render_music FAILED:", JSON.stringify(renderRaw.content));
  process.exit(1);
}
const render = firstText(renderRaw);
console.log(`render_music: id=${render.id} file=${render.filename} ${render.file_size_bytes} bytes`);
console.log(`  blob: ${render.file_path}`);
console.log(`  progress notifications received: ${progressLog.length}`);
console.log(`  stages: ${progressLog.join(" | ")}`);

const status = firstText(
  await client.callTool({ name: "get_render_status", arguments: { render_id: render.id } }),
);
console.log(`get_render_status: id=${status.id} present=${status.id === render.id}`);

const resources = await client.listResources();
console.log(`resources/list: ${resources.resources.length} renders listed`);

const read = await client.readResource({ uri: `keepsong://renders/${render.id}` });
const blob = read.contents[0] as { mimeType?: string; blob?: string };
const bytes = Buffer.from(blob.blob ?? "", "base64");
console.log(`resource read: ${blob.mimeType}, ${bytes.length} bytes (base64-decoded)`);
console.log(bytes.length > 1000 ? "E2E OK" : "E2E FAILED: suspiciously small audio");

await client.close();
