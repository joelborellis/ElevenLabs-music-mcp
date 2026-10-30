import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { renders as sqliteRenders } from "../../src/db/schema.sqlite.js";
import { renders as pgRenders } from "../../src/db/schema.pg.js";
import { ChunkSchema, PlanGenerationRequestSchema } from "../../src/models/plan.js";
import { RenderRequestSchema } from "../../src/models/render.js";
import { FinetuneSummarySchema } from "../../src/models/finetune.js";
import { PromptGenerationRequestSchema } from "../../src/models/prompt.js";

const fixtures = JSON.parse(
  readFileSync(path.resolve("test/fixtures/render_test_input.json"), "utf8"),
) as Record<string, unknown>;

describe("RenderRequestSchema cross-field rules (ports the Python 422 cases)", () => {
  it("accepts the prompt_mode and plan_mode fixtures", () => {
    expect(RenderRequestSchema.safeParse(fixtures.prompt_mode).success).toBe(true);
    expect(RenderRequestSchema.safeParse(fixtures.plan_mode).success).toBe(true);
  });

  it("rejects empty chunks with no prompt", () => {
    const result = RenderRequestSchema.safeParse({ chunks: [] });
    expect(result.success).toBe(false);
  });

  it("rejects prompt and chunks together", () => {
    const plan = fixtures.plan_mode as { chunks: unknown[] };
    const result = RenderRequestSchema.safeParse({ prompt: "a song", chunks: plan.chunks });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("not both");
  });

  it("rejects music_length_ms without prompt", () => {
    const plan = fixtures.plan_mode as { chunks: unknown[] };
    const result = RenderRequestSchema.safeParse({ chunks: plan.chunks, music_length_ms: 10_000 });
    expect(result.success).toBe(false);
  });

  it("rejects finetune_strength without finetune_id", () => {
    const result = RenderRequestSchema.safeParse({ prompt: "a song", finetune_strength: 0.5 });
    expect(result.success).toBe(false);
  });

  it("applies defaults (model_id, booleans, chunks)", () => {
    const parsed = RenderRequestSchema.parse({ prompt: "a song" });
    expect(parsed.model_id).toBe("music_v2_5");
    expect(parsed.force_instrumental).toBe(false);
    expect(parsed.sign_with_c2pa).toBe(false);
    expect(parsed.chunks).toEqual([]);
  });

  it("render music_length_ms floor is 3000", () => {
    expect(RenderRequestSchema.safeParse({ prompt: "a", music_length_ms: 2999 }).success).toBe(false);
    expect(RenderRequestSchema.safeParse({ prompt: "a", music_length_ms: 3000 }).success).toBe(true);
  });
});

describe("PlanGenerationRequestSchema", () => {
  it("floor is 1000 — deliberately different from RenderRequest's 3000", () => {
    expect(PlanGenerationRequestSchema.safeParse({ prompt: "a", music_length_ms: 500 }).success).toBe(false);
    expect(PlanGenerationRequestSchema.safeParse({ prompt: "a", music_length_ms: 1000 }).success).toBe(true);
  });

  it("requires a non-empty prompt", () => {
    expect(PlanGenerationRequestSchema.safeParse({}).success).toBe(false);
    expect(PlanGenerationRequestSchema.safeParse({ prompt: "" }).success).toBe(false);
  });
});

describe("PromptGenerationRequestSchema", () => {
  const base = { project_blueprint: "ad_brand_fast_hook", delivery_and_control: "balanced_studio" };

  it("requires a non-empty finetune_id", () => {
    expect(PromptGenerationRequestSchema.safeParse(base).success).toBe(false);
    expect(PromptGenerationRequestSchema.safeParse({ ...base, finetune_id: "" }).success).toBe(false);
    expect(PromptGenerationRequestSchema.safeParse({ ...base, finetune_id: "ft_1" }).success).toBe(true);
  });

  it("no longer accepts the old fixed sound_profile presets in place of a finetune", () => {
    const parsed = PromptGenerationRequestSchema.safeParse({ ...base, sound_profile: "lofi_cozy" });
    expect(parsed.success).toBe(false);
  });
});

describe("Chunk passthrough (Pydantic extra='allow' parity)", () => {
  it("preserves unknown future music model fields", () => {
    const parsed = ChunkSchema.parse({
      text: "[Intro]",
      duration_ms: 5000,
      conditioning_ref: { source: "abc" },
      condition_strength: "high",
    });
    expect(parsed.conditioning_ref).toEqual({ source: "abc" });
    expect(parsed.condition_strength).toBe("high");
  });
});

describe("FinetuneSummary strips unknown fields (extra='ignore' parity)", () => {
  it("drops keys not in the model", () => {
    const parsed = FinetuneSummarySchema.parse({ id: "ft_1", some_future_field: 42 });
    expect("some_future_field" in parsed).toBe(false);
  });

  it("parses every entry of the 37-entry live-shaped fixture", () => {
    const data = JSON.parse(
      readFileSync(path.resolve("test/fixtures/finetunes.json"), "utf8"),
    ) as { finetunes?: unknown[] } | unknown[];
    const items = Array.isArray(data) ? data : (data.finetunes ?? []);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(FinetuneSummarySchema.safeParse(item).success).toBe(true);
    }
  });
});

describe("sqlite/pg schema mirror", () => {
  it("both dialects define identical column names and nullability", () => {
    const sqliteCols = getTableColumns(sqliteRenders);
    const pgCols = getTableColumns(pgRenders);
    expect(Object.keys(sqliteCols).sort()).toEqual(Object.keys(pgCols).sort());
    for (const [name, col] of Object.entries(sqliteCols)) {
      expect(pgCols[name as keyof typeof pgCols].notNull, `notNull mismatch on ${name}`).toBe(
        col.notNull,
      );
    }
  });
});
