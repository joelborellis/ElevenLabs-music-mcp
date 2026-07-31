import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigurationError } from "../../src/config.js";
import { UpstreamError } from "../../src/errors.js";
import { ListFinetunesSchema } from "../../src/models/finetune.js";
import { clearFinetuneCache, listFinetunes } from "../../src/services/finetuneService.js";
import { getElevenLabsClient } from "../../src/services/elevenlabs.js";
import { makeTestConfig } from "../helpers.js";

vi.mock("../../src/services/elevenlabs.js", () => ({
  getElevenLabsClient: vi.fn(),
}));

const listMock = vi.fn();
const mockedGetClient = vi.mocked(getElevenLabsClient);

// SDK-shaped (camelCase) upstream page.
function upstreamPage() {
  return {
    finetunes: [
      {
        id: "ft_done",
        name: "Golden Hour Indie Guitar",
        tags: ["indie"],
        primaryGenre: "indie",
        modelId: "music_v2",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        visibility: "public",
        createdBy: "elevenlabs",
        status: "completed",
        trainingProgress: 1,
      },
      {
        id: "ft_training",
        name: "Rock Français",
        tags: [],
        modelId: "music_v2",
        createdAt: new Date("2026-02-01T00:00:00Z"),
        visibility: "public",
        createdBy: "elevenlabs",
        status: "in_progress",
        trainingProgress: 0.4,
      },
      {
        id: "ft_v1",
        name: "Old Model",
        tags: [],
        modelId: "music_v1",
        createdAt: new Date("2026-03-01T00:00:00Z"),
        visibility: "public",
        createdBy: "elevenlabs",
        status: "completed",
        trainingProgress: 1,
      },
    ],
    hasMore: true,
    nextCursor: "cursor-2",
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return ListFinetunesSchema.parse(overrides);
}

beforeEach(() => {
  vi.useFakeTimers();
  clearFinetuneCache();
  listMock.mockReset().mockResolvedValue(upstreamPage());
  mockedGetClient.mockReturnValue({
    music: { finetunes: { list: listMock } },
  } as unknown as ReturnType<typeof getElevenLabsClient>);
});

afterEach(() => {
  vi.useRealTimers();
});

const config = makeTestConfig({ finetunesCacheTtlSeconds: 300 });

describe("listFinetunes", () => {
  it("filters to completed by default and maps to snake_case summaries", async () => {
    const result = await listFinetunes(config, request());
    expect(result.finetunes.map((f) => f.id)).toEqual(["ft_done", "ft_v1"]);
    expect(result.count).toBe(2); // filtered count
    expect(result.has_more).toBe(true); // upstream page, unfiltered
    expect(result.next_cursor).toBe("cursor-2");
    expect(result.finetunes[0]?.created_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("include_incomplete keeps non-completed entries; model_id filters client-side", async () => {
    const all = await listFinetunes(config, request({ include_incomplete: true }));
    expect(all.count).toBe(3);
    const v2 = await listFinetunes(config, request({ model_id: "music_v2" }));
    expect(v2.finetunes.map((f) => f.id)).toEqual(["ft_done"]);
    // Different filters, same upstream params → still one upstream fetch.
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("caches per upstream params and expires after the TTL", async () => {
    await listFinetunes(config, request());
    await listFinetunes(config, request());
    expect(listMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(301_000);
    await listFinetunes(config, request());
    expect(listMock).toHaveBeenCalledTimes(2);

    // Different upstream params → separate cache entry.
    await listFinetunes(config, request({ visibility: "private" }));
    expect(listMock).toHaveBeenCalledTimes(3);
  });

  it("refresh bypasses the cache; TTL=0 disables caching entirely", async () => {
    await listFinetunes(config, request());
    await listFinetunes(config, request({ refresh: true }));
    expect(listMock).toHaveBeenCalledTimes(2);

    const noCache = makeTestConfig({ finetunesCacheTtlSeconds: 0 });
    clearFinetuneCache();
    await listFinetunes(noCache, request());
    await listFinetunes(noCache, request());
    expect(listMock).toHaveBeenCalledTimes(4);
  });

  it("wraps upstream failures as UpstreamError (the 502-class distinction)", async () => {
    listMock.mockRejectedValue(new Error("boom"));
    await expect(listFinetunes(config, request())).rejects.toBeInstanceOf(UpstreamError);
  });

  it("propagates ConfigurationError from a missing API key untouched", async () => {
    mockedGetClient.mockImplementation(() => {
      throw new ConfigurationError("ELEVENLABS_API_KEY is not configured.");
    });
    await expect(listFinetunes(config, request())).rejects.toBeInstanceOf(ConfigurationError);
  });
});
