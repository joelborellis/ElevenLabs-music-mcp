import { beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "@openai/agents";
import { InvalidInputError, UpstreamError } from "../../src/errors.js";
import type { FinetuneSummary } from "../../src/models/finetune.js";
import { PromptGenerationRequestSchema } from "../../src/models/prompt.js";
import { findCachedFinetune, getFinetune } from "../../src/services/finetuneService.js";
import { generateMusicPrompt } from "../../src/services/promptGenerator.js";
import { makeTestConfig } from "../helpers.js";

vi.mock("@openai/agents", () => ({
  Agent: vi.fn(),
  run: vi.fn(),
  webSearchTool: vi.fn(),
}));

// Keep the real finetuneSlug; stub only the lookups.
vi.mock("../../src/services/finetuneService.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/services/finetuneService.js")>()),
  getFinetune: vi.fn(),
  findCachedFinetune: vi.fn(),
}));

const mockedRun = vi.mocked(run);
const mockedGet = vi.mocked(getFinetune);
const mockedCached = vi.mocked(findCachedFinetune);

const config = makeTestConfig();
const finetune: FinetuneSummary = {
  id: "ft_indie",
  name: "Indie Dance",
  primary_genre: "Indie",
  tags: ["Electronic", "Nu-Disco"],
  status: "completed",
};
const request = PromptGenerationRequestSchema.parse({
  project_blueprint: "standalone_song_mini",
  finetune_id: "ft_indie",
  delivery_and_control: "balanced_studio",
  user_narrative: "For Alex's birthday",
});
const agentOutput = {
  prompt: "A nu-disco song...",
  title: "Alex Glow",
  description: "A song.",
  about: "Alex's birthday",
};

function sentPayload(): Record<string, unknown> {
  return JSON.parse(mockedRun.mock.calls[0]?.[1] as string) as Record<string, unknown>;
}

beforeEach(() => {
  mockedRun.mockReset().mockResolvedValue({ finalOutput: agentOutput } as never);
  mockedGet.mockReset();
  mockedCached.mockReset();
});

describe("generateMusicPrompt", () => {
  it("sends the resolved finetune as sound_profile + finetune_context", async () => {
    mockedGet.mockResolvedValue(finetune);
    const result = await generateMusicPrompt(config, request);

    expect(sentPayload()).toEqual({
      project_blueprint: "standalone_song_mini",
      sound_profile: "indie_dance",
      finetune_id: "ft_indie",
      finetune_context: { name: "Indie Dance", primary_genre: "Indie", tags: ["Electronic", "Nu-Disco"] },
      delivery_and_control: "balanced_studio",
      instrumental_only: false,
      user_narrative: "For Alex's birthday",
    });
    expect(result).toMatchObject({
      ...agentOutput,
      finetune_id: "ft_indie",
      finetune_name: "Indie Dance",
      sound_profile: "indie_dance",
    });
  });

  it("falls back to a cached finetune name without context when ElevenLabs is down", async () => {
    mockedGet.mockRejectedValue(new UpstreamError("down"));
    mockedCached.mockReturnValue(finetune);
    await generateMusicPrompt(config, request);

    const payload = sentPayload();
    expect(payload.sound_profile).toBe("indie_dance");
    expect("finetune_context" in payload).toBe(false);
  });

  it("rethrows the upstream error when the finetune isn't cached", async () => {
    mockedGet.mockRejectedValue(new UpstreamError("down"));
    mockedCached.mockReturnValue(undefined);
    await expect(generateMusicPrompt(config, request)).rejects.toBeInstanceOf(UpstreamError);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("does not fall back for an unknown finetune", async () => {
    mockedGet.mockRejectedValue(new InvalidInputError("Finetune not found: ft_indie"));
    mockedCached.mockReturnValue(finetune);
    await expect(generateMusicPrompt(config, request)).rejects.toBeInstanceOf(InvalidInputError);
    expect(mockedRun).not.toHaveBeenCalled();
  });
});
