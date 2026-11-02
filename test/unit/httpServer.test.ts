import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { jwtVerify } from "jose";
import { createHttpApp } from "../../src/httpServer.js";
import type { ToolDeps } from "../../src/mcp/tools.js";
import { STUDIO_URI } from "../../src/mcp/ui.js";
import { signRenderUrl } from "../../src/services/media.js";
import { completeRow, fakeRepo, fakeStorage } from "../fakes.js";
import { makeTestConfig } from "../helpers.js";

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({}) as unknown),
  jwtVerify: vi.fn(),
}));

// "good" verifies as a delegated user token; anything else fails verification.
vi.mocked(jwtVerify).mockImplementation((async (token: string) => {
  if (token !== "good") throw new Error("signature verification failed");
  return { payload: { oid: "user-1", scp: "access_as_user" } };
}) as unknown as typeof jwtVerify);

const widgetOrigin = "https://abc123.widget-renderer.usercontent.microsoft.com";
const config = makeTestConfig({
  authEnabled: true,
  entraTenantId: "tid",
  entraAudiences: ["cid"],
  corsAllowedOrigins: [widgetOrigin],
});
// One complete render ("r1", 10 bytes of "audio") for the media route tests.
const deps: ToolDeps = {
  config,
  storage: fakeStorage({ "song.mp3": Buffer.from("0123456789") }),
  repo: fakeRepo([completeRow()]),
};

let server: Server;
let base: string;

beforeAll(async () => {
  server = createHttpApp(deps).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

function rpc(method: string, id: number, params: unknown, token = "good") {
  return fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

/** The SSE response carries one JSON-RPC message per `data:` line. */
async function rpcResult(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const data = text.split("\n").find((line) => line.startsWith("data:"));
  return JSON.parse(data ? data.slice("data:".length) : text) as Record<string, unknown>;
}

describe("HTTP server", () => {
  it("answers CORS preflight from an allowed origin without a token", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "OPTIONS",
      headers: { origin: widgetOrigin, "access-control-request-method": "POST" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(widgetOrigin);
    expect(res.headers.get("access-control-allow-headers")).toContain("Authorization");
  });

  it("sends no CORS headers to an unlisted origin", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("keeps /health open and /mcp closed without a token", async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
    const res = await fetch(`${base}/mcp`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("rejects an invalid token", async () => {
    const res = await rpc("tools/list", 1, {}, "forged");
    expect(res.status).toBe(401);
  });

  it("serves initialize and tools/list statelessly (no Mcp-Session-Id)", async () => {
    const init = await rpc("initialize", 1, {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0.0.0" },
    });
    expect(init.status).toBe(200);
    expect(init.headers.get("mcp-session-id")).toBeNull();
    expect((await rpcResult(init)).result).toBeDefined();

    const list = await rpc("tools/list", 2, {});
    expect(list.status).toBe(200);
    const { result } = (await rpcResult(list)) as { result: { tools: Array<{ name: string }> } };
    expect(result.tools.map((t) => t.name)).toContain("list_finetunes");
  });

  it("returns 405 for GET and DELETE on the MCP path", async () => {
    expect((await fetch(`${base}/mcp`, { method: "GET" })).status).toBe(405);
    expect((await fetch(`${base}/mcp`, { method: "DELETE" })).status).toBe(405);
  });
});

describe("studio template and media (no bearer token)", () => {
  function readResource(uri: string) {
    return fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri } }),
    });
  }

  it("lets Copilot read the ui:// template without a token", async () => {
    const res = await readResource(STUDIO_URI);
    expect(res.status).toBe(200);
    const { result } = (await rpcResult(res)) as { result: { contents: Array<{ mimeType: string }> } };
    expect(result.contents[0]?.mimeType).toBe("text/html;profile=mcp-app");
  });

  it("still requires a token for keepsong:// audio resources", async () => {
    expect((await readResource("keepsong://renders/r1")).status).toBe(401);
  });

  it("serves audio only with a valid signature, with Range support", async () => {
    expect((await fetch(`${base}/media/renders/r1?exp=99999999999&sig=00`)).status).toBe(403);

    const signed = signRenderUrl(config, "r1").replace("http://localhost:3000", base);
    const full = await fetch(signed);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("audio/mpeg");
    expect(await full.text()).toBe("0123456789");

    const part = await fetch(signed, { headers: { range: "bytes=2-5" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await part.text()).toBe("2345");

    const missing = signRenderUrl(config, "nope").replace("http://localhost:3000", base);
    expect((await fetch(missing)).status).toBe(404);
  });
});
