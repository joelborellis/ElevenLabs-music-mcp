import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenerationError, PlanValidationError } from "../../src/errors.js";
import { RenderRequestSchema } from "../../src/models/render.js";
import { createDbConnection, runMigrations, type DbConnection } from "../../src/db/client.js";
import { createRenderRepository } from "../../src/db/renderRepository.js";
import type { RenderRepository } from "../../src/db/types.js";
import { LocalStorageBackend } from "../../src/services/storage/local.js";
import { render, type ProgressStage } from "../../src/services/renderService.js";
import type { ComposeDetailedResult } from "../../src/services/elevenlabs.js";
import { makeTestConfig } from "../helpers.js";

// Fully offline (mirrors the Python test_storage_and_db.py pattern): temp
// SQLite + temp storage dir, no server or network involved.
let workDir: string;
let conn: DbConnection;
let repo: RenderRepository;
let storage: LocalStorageBackend;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "keepsong-test-"));
  conn = await createDbConnection(
    makeTestConfig({ databaseUrl: path.join(workDir, "renders.db") }),
  );
  await runMigrations(conn);
  repo = createRenderRepository(conn);
  storage = new LocalStorageBackend(path.join(workDir, "blobs"));
});

afterAll(async () => {
  await conn.close(); // Windows: the sqlite handle must close before rm
  await rm(workDir, { recursive: true, force: true });
});

describe("LocalStorageBackend", () => {
  it("save/exists/getBytes/delete round-trip with file:// URI", async () => {
    const data = Buffer.from("audio-bytes-here");
    const url = await storage.save("sub/dir/test.mp3", data, "audio/mpeg");
    expect(url).toMatch(/^file:\/\//);
    expect(await storage.exists("sub/dir/test.mp3")).toBe(true);
    expect((await storage.getBytes("sub/dir/test.mp3"))?.equals(data)).toBe(true);

    await storage.delete("sub/dir/test.mp3");
    expect(await storage.exists("sub/dir/test.mp3")).toBe(false);
    expect(await storage.getBytes("sub/dir/test.mp3")).toBeNull();
    await expect(storage.delete("sub/dir/test.mp3")).resolves.toBeUndefined(); // no-op
  });

  it("streams reads in 8192-byte chunks", async () => {
    const big = Buffer.alloc(20_000, 0xab);
    await storage.save("big.mp3", big, "audio/mpeg");
    const chunks: Buffer[] = [];
    for await (const chunk of storage.openStream("big.mp3")) chunks.push(chunk);
    expect(chunks.length).toBe(3); // 8192 + 8192 + 3616
    expect(chunks[0]?.length).toBe(8192);
    expect(Buffer.concat(chunks).equals(big)).toBe(true);
  });

  it("rejects keys escaping the base directory", async () => {
    await expect(storage.getBytes("../outside.mp3")).rejects.toThrow(/Invalid storage key/);
  });
});

describe("render repository durability lifecycle", () => {
  it("createProcessing → markComplete", async () => {
    await repo.createProcessing({
      id: "render-1",
      request_id: "req-1",
      title: "Indie Sunrise",
      mode: "plan",
      model_id: "music_v2",
      composition_plan: { chunks: [{ duration_ms: 4000 }] },
    });
    let row = await repo.getById("render-1");
    expect(row?.status).toBe("processing");
    expect(row?.blob_key).toBeNull();
    expect(row?.composition_plan).toEqual({ chunks: [{ duration_ms: 4000 }] });

    await repo.markComplete("render-1", {
      blob_key: "indie_sunrise_deadbeef.mp3",
      blob_url: "file:///tmp/indie_sunrise_deadbeef.mp3",
      filename: "indie_sunrise_deadbeef.mp3",
      content_type: "audio/mpeg",
      file_size_bytes: 12345,
      duration_ms: 19_000,
      song_metadata: { title: "Indie Sunrise" },
    });
    row = await repo.getById("render-1");
    expect(row?.status).toBe("complete");
    expect(row?.file_size_bytes).toBe(12345);
    expect(row?.error).toBeNull();
    expect(row?.created_at).toBeInstanceOf(Date);
  });

  it("markFailed records the error", async () => {
    await repo.createProcessing({ id: "render-2", request_id: "req-2", mode: "prompt" });
    await repo.markFailed("render-2", "ElevenLabs exploded");
    const row = await repo.getById("render-2");
    expect(row?.status).toBe("failed");
    expect(row?.error).toBe("ElevenLabs exploded");
  });

  it("getById returns null for unknown ids; listRenders is newest-first", async () => {
    expect(await repo.getById("nope")).toBeNull();
    const rows = await repo.listRenders(10);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.created_at.getTime()).toBeGreaterThanOrEqual(rows[i]!.created_at.getTime());
    }
  });
});

describe("render() end-to-end with mocked compose", () => {
  const fakeCompose = (json: Record<string, unknown>): ComposeDetailedResult => ({
    json,
    audio: Buffer.from("fake-mp3-bytes"),
    filename: "elevenlabs_default.mp3",
    songId: "song-xyz",
  });

  it("runs the durability flow and emits the progress stage sequence", async () => {
    const stages: Array<[ProgressStage, number]> = [];
    const request = RenderRequestSchema.parse({
      title: "My Track",
      prompt: "an 8 second sting",
      music_length_ms: 8000,
      output_format: "mp3_44100_128",
    });
    const result = await render(
      {
        config: makeTestConfig(),
        storage,
        repo,
        compose: async () =>
          fakeCompose({
            composition_plan: { chunks: [{ duration_ms: 8000 }] },
            song_metadata: { title: "My Track" },
          }),
      },
      request,
      "req-render",
      (stage, percent) => {
        stages.push([stage, percent]);
      },
    );

    expect(result.filename).toMatch(/^my_track_[0-9a-f]{8}\.mp3$/);
    expect(result.duration_ms).toBe(8000);
    expect(result.song_id).toBe("song-xyz");
    expect(await storage.exists(result.filename)).toBe(true);

    const row = await repo.getById(result.id);
    expect(row?.status).toBe("complete");
    expect(row?.mode).toBe("prompt");
    expect(row?.blob_key).toBe(result.filename);
    expect(row?.song_metadata).toEqual({ title: "My Track" });

    expect(stages.map(([stage]) => stage)).toEqual([
      "validating",
      "validated",
      "generating",
      "processing",
      "saving",
      "extracting",
      "complete",
    ]);
    expect(stages.at(-1)).toEqual(["complete", 100]);
  });

  it("accepts camelCase JSON keys from the multipart payload", async () => {
    const request = RenderRequestSchema.parse({ prompt: "a sting", music_length_ms: 8000 });
    const result = await render(
      {
        config: makeTestConfig(),
        storage,
        repo,
        compose: async () => fakeCompose({ compositionPlan: { chunks: [{ duration_ms: 5000 }] } }),
      },
      request,
      "req-camel",
    );
    expect(result.duration_ms).toBe(5000);
    expect(result.filename).toBe("elevenlabs_default.mp3"); // no title → API filename
  });

  it("marks the row failed and rethrows when compose fails", async () => {
    const request = RenderRequestSchema.parse({ prompt: "a sting" });
    let renderId: string | undefined;
    const repoSpy: RenderRepository = {
      ...repo,
      createProcessing: async (input) => {
        renderId = input.id;
        await repo.createProcessing(input);
      },
    };
    await expect(
      render(
        {
          config: makeTestConfig(),
          storage,
          repo: repoSpy,
          compose: async () => {
            throw new Error("upstream 500");
          },
        },
        request,
        "req-fail",
      ),
    ).rejects.toBeInstanceOf(GenerationError);
    const row = await repo.getById(renderId!);
    expect(row?.status).toBe("failed");
    expect(row?.error).toContain("upstream 500");
  });

  it("rejects an invalid composition plan before writing any row", async () => {
    const request = RenderRequestSchema.parse({
      chunks: [{ text: "[Intro]", duration_ms: 1000 }],
    });
    const before = (await repo.listRenders(100)).length;
    await expect(
      render(
        {
          config: makeTestConfig(),
          storage,
          repo,
          compose: async () => fakeCompose({}),
        },
        request,
        "req-invalid",
      ),
    ).rejects.toBeInstanceOf(PlanValidationError);
    expect((await repo.listRenders(100)).length).toBe(before); // no orphan row
  });
});
