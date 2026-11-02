import { beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/mcp/server.js";
import type { ToolDeps } from "../../src/mcp/tools.js";
import { STUDIO_URI } from "../../src/mcp/ui.js";
import type { ComposeDetailedResult } from "../../src/services/elevenlabs.js";
import { clearAllJobs } from "../../src/services/renderJobs.js";
import { completeRow, fakeRepo, fakeStorage } from "../fakes.js";
import { makeTestConfig } from "../helpers.js";

type ToolResult = { structuredContent?: Record<string, unknown>; isError?: boolean };

async function connect(deps: ToolDeps): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "studio-test", version: "0.0.0" });
  await Promise.all([createMcpServer(deps).connect(serverT), client.connect(clientT)]);
  return client;
}

const config = makeTestConfig();

beforeEach(() => {
  clearAllJobs();
});

describe("Keepsong Studio wiring", () => {
  it("attaches the studio resource to widget tools, visible to model and app", async () => {
    const client = await connect({ config, storage: fakeStorage(), repo: fakeRepo() });
    const { tools } = await client.listTools();
    const meta = Object.fromEntries(tools.map((t) => [t.name, t._meta as { ui?: Record<string, unknown> } | undefined]));

    for (const name of ["generate_music_prompt", "list_finetunes", "start_render", "get_render_status", "list_renders"]) {
      expect(meta[name]?.ui?.resourceUri, name).toBe(STUDIO_URI);
      // No visibility restriction: Copilot needs list_renders to find songs by name in a new chat.
      expect(meta[name]?.ui?.visibility, name).toBeUndefined();
    }
    expect(meta.render_music?.ui).toBeUndefined();

    // Copilot prompts the user before any tool that isn't read-only: only the
    // two credit-spending renders should trigger that.
    const readOnly = Object.fromEntries(tools.map((t) => [t.name, t.annotations?.readOnlyHint === true]));
    for (const name of ["generate_music_prompt", "generate_composition_plan", "list_finetunes", "get_render_status", "list_renders"]) {
      expect(readOnly[name], name).toBe(true);
    }
    expect(readOnly.start_render).toBe(false);
    expect(readOnly.render_music).toBe(false);
    await client.close();
  });

  it("serves the studio template as an MCP Apps resource with CSP for the public origin", async () => {
    const client = await connect({ config, storage: fakeStorage(), repo: fakeRepo() });
    const { contents } = await client.readResource({ uri: STUDIO_URI });
    const item = contents[0] as { mimeType?: string; text?: string; _meta?: { ui?: { csp?: Record<string, string[]> } } };
    expect(item.mimeType).toBe("text/html;profile=mcp-app");
    expect(item.text).toContain('window.__KEEPSONG_BASE_URL__="http://localhost:3000"');
    expect(item._meta?.ui?.csp?.connectDomains).toEqual(["http://localhost:3000"]);
    await client.close();
  });

  it("returns a complete render as a 'song' with a signed audio_url", async () => {
    const client = await connect({ config, storage: fakeStorage(), repo: fakeRepo([completeRow()]) });
    const result = (await client.callTool({ name: "get_render_status", arguments: { render_id: "r1" } })) as ToolResult;
    expect(result.structuredContent?.kind).toBe("song");
    expect(String(result.structuredContent?.audio_url)).toMatch(/^http:\/\/localhost:3000\/media\/renders\/r1\?exp=\d+&sig=[0-9a-f]+$/);
    await client.close();
  });

  it("start_render returns while the render is still running, then status reports progress and completion", async () => {
    let finish!: (value: ComposeDetailedResult) => void;
    const composing = new Promise<ComposeDetailedResult>((resolve) => {
      finish = resolve;
    });
    const repo = fakeRepo();
    const deps = { config, storage: fakeStorage(), repo, compose: () => composing } as ToolDeps;
    const client = await connect(deps);

    const started = (await client.callTool({
      name: "start_render",
      arguments: { prompt: "a song for the launch", music_length_ms: 8000, title: "Launch" },
    })) as ToolResult;
    expect(started.structuredContent).toMatchObject({ kind: "composing", status: "processing", title: "Launch" });
    const id = String(started.structuredContent?.id);
    expect(repo.rows.get(id)?.status).toBe("processing");

    const pending = (await client.callTool({ name: "get_render_status", arguments: { render_id: id } })) as ToolResult;
    expect(pending.structuredContent?.kind).toBe("composing");
    expect(pending.structuredContent?.progress).toMatchObject({ stage: "generating" });

    finish({ json: {}, audio: Buffer.from("0123456789"), filename: "launch.mp3", songId: null });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const done = (await client.callTool({ name: "get_render_status", arguments: { render_id: id } })) as ToolResult;
    expect(done.structuredContent?.kind).toBe("song");
    expect(done.structuredContent?.progress).toBeUndefined();
    await client.close();
  });

  it("list_renders hides style previews and in-flight rows", async () => {
    const repo = fakeRepo([
      completeRow({ id: "song", title: "Real song" }),
      completeRow({ id: "prev", title: "preview:ft_indie" }),
      completeRow({ id: "wip", status: "processing" }),
    ]);
    const client = await connect({ config, storage: fakeStorage(), repo });
    const result = (await client.callTool({ name: "list_renders", arguments: {} })) as ToolResult;
    const renders = result.structuredContent?.renders as Array<{ id: string }>;
    expect(renders.map((r) => r.id)).toEqual(["song"]);
    await client.close();
  });
});
