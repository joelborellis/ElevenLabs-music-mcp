import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PlanValidationError } from "../../src/errors.js";
import { RenderRequestSchema, type RenderRequest } from "../../src/models/render.js";
import {
  computeDurationMs,
  contentTypeForOutputFormat,
  sanitizeFilename,
  toComposeKwargs,
  validateCompositionPlan,
} from "../../src/services/renderUtils.js";

const fixtures = JSON.parse(
  readFileSync(path.resolve("test/fixtures/render_test_input.json"), "utf8"),
) as Record<string, unknown>;

function parse(payload: unknown): RenderRequest {
  return RenderRequestSchema.parse(payload);
}

describe("toComposeKwargs", () => {
  it("prompt mode sends prompt + music_length_ms and no composition_plan", () => {
    const kwargs = toComposeKwargs(parse(fixtures.prompt_mode));
    expect(kwargs.prompt).toContain("bright pop-electro");
    expect(kwargs.music_length_ms).toBe(8000);
    expect(kwargs.composition_plan).toBeUndefined();
    expect(kwargs.output_format).toBe("mp3_44100_128");
  });

  it("plan mode sends composition_plan and never music_length_ms", () => {
    const kwargs = toComposeKwargs(parse(fixtures.plan_mode));
    expect(kwargs.prompt).toBeUndefined();
    expect(kwargs.music_length_ms).toBeUndefined();
    expect(kwargs.composition_plan?.chunks).toHaveLength(4);
  });

  it("omits output_format and finetune params when unset so the API applies defaults", () => {
    const kwargs = toComposeKwargs(parse({ prompt: "a song", music_length_ms: 8000 }));
    expect("output_format" in kwargs).toBe(false);
    expect("finetune_id" in kwargs).toBe(false);
    expect("finetune_strength" in kwargs).toBe(false);
  });

  it("includes finetune params only when set", () => {
    const kwargs = toComposeKwargs(
      parse({ prompt: "a song", finetune_id: "ft_123", finetune_strength: 0.7 }),
    );
    expect(kwargs.finetune_id).toBe("ft_123");
    expect(kwargs.finetune_strength).toBe(0.7);
  });

  it("never sends title to ElevenLabs", () => {
    const kwargs = toComposeKwargs(parse(fixtures.with_title)) as Record<string, unknown>;
    expect("title" in kwargs).toBe(false);
  });
});

describe("validateCompositionPlan", () => {
  it("accepts the plan_mode fixture and returns the total duration", () => {
    const request = parse(fixtures.plan_mode);
    expect(validateCompositionPlan({ chunks: request.chunks })).toBe(19_000);
  });

  it("rejects an empty plan", () => {
    expect(() => validateCompositionPlan({ chunks: [] })).toThrow(PlanValidationError);
  });

  it("rejects a chunk under 3000ms, naming its text", () => {
    const chunks = [
      { text: "[Intro]", positive_styles: [], negative_styles: [], duration_ms: 2000 },
    ];
    expect(() => validateCompositionPlan({ chunks })).toThrow(/'\[Intro\]' is 2000ms/);
  });

  it("rejects a chunk under 3000ms by index when text is empty", () => {
    const chunks = [{ text: "", positive_styles: [], negative_styles: [], duration_ms: 1000 }];
    expect(() => validateCompositionPlan({ chunks })).toThrow(/at index 0/);
  });

  it("rejects totals above 600000ms, reporting the actual total", () => {
    const chunks = Array.from({ length: 7 }, () => ({
      text: "[Part]",
      positive_styles: [],
      negative_styles: [],
      duration_ms: 100_000,
    }));
    expect(() => validateCompositionPlan({ chunks })).toThrow(/700000ms/);
  });
});

describe("sanitizeFilename", () => {
  it("lowercases, collapses whitespace, strips punctuation, appends hex + .mp3", () => {
    expect(sanitizeFilename("Epic  Battle Theme!", "deadbeef")).toBe("epic_battle_theme_deadbeef.mp3");
  });

  it("truncates the cleaned title to 50 chars", () => {
    const long = "x".repeat(80);
    const result = sanitizeFilename(long, "deadbeef");
    expect(result).toBe(`${"x".repeat(50)}_deadbeef.mp3`);
  });

  it("keeps unicode word characters like Python's \\w", () => {
    expect(sanitizeFilename("Café Été", "deadbeef")).toBe("café_été_deadbeef.mp3");
  });

  it("generates an 8-hex suffix when none is supplied", () => {
    expect(sanitizeFilename("song")).toMatch(/^song_[0-9a-f]{8}\.mp3$/);
  });
});

describe("contentTypeForOutputFormat", () => {
  it.each([
    ["mp3_44100_128", "audio/mpeg"],
    ["pcm_44100", "audio/pcm"],
    ["opus_48000_128", "audio/opus"],
    ["wav_44100", "audio/wav"],
    ["ulaw_8000", "audio/mpeg"],
    [null, "audio/mpeg"],
    [undefined, "audio/mpeg"],
  ])("%s → %s", (format, expected) => {
    expect(contentTypeForOutputFormat(format as string | null | undefined)).toBe(expected);
  });
});

describe("computeDurationMs", () => {
  const promptRequest = parse({ prompt: "a song", music_length_ms: 8000 });

  it("prefers the response plan's chunk sum", () => {
    const plan = { chunks: [{ duration_ms: 4000 }, { duration_ms: 6000 }] };
    expect(computeDurationMs(plan, promptRequest)).toBe(10_000);
  });

  it("falls back to the request chunks' sum", () => {
    const request = parse(fixtures.plan_mode);
    expect(computeDurationMs(null, request)).toBe(19_000);
  });

  it("falls back to music_length_ms, else null", () => {
    expect(computeDurationMs(null, promptRequest)).toBe(8000);
    expect(computeDurationMs(null, parse({ prompt: "a song" }))).toBeNull();
  });
});
