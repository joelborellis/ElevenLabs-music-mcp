import { describe, expect, it } from "vitest";
import { directionLines, renderLengthMs, stageWord, useLabel } from "../../widgets/src/lib/blueprints";

describe("widget blueprint helpers", () => {
  it("prefers a duration stated in the prompt, else the blueprint default", () => {
    expect(renderLengthMs("Create a 30-second upbeat teaser…", "standalone_song_mini")).toBe(30_000);
    expect(renderLengthMs("A piece of about 2 minutes for…", "ad_brand_fast_hook")).toBe(120_000);
    expect(renderLengthMs("No length here", "podcast_voiceover_loop")).toBe(60_000);
    expect(renderLengthMs("No length here", "meditation_sleep")).toBeUndefined();
    expect(renderLengthMs("a 1 second sting", "ad_brand_fast_hook")).toBe(3000); // clamped
  });

  it("labels uses and stages in human words", () => {
    expect(useLabel("ad_brand_fast_hook")).toBe("30s teaser");
    expect(useLabel("nope")).toBe("Song");
    expect(stageWord("generating")).toBe("Performing");
    expect(stageWord(undefined)).toBe("Getting ready");
  });

  it("takes the first sentences of the prompt as the direction preview", () => {
    const prompt = "Open with a bright hook. Build quickly! Keep the midrange open for voiceover? Then finish.";
    expect(directionLines(prompt, 3)).toEqual([
      "Open with a bright hook.",
      "Build quickly!",
      "Keep the midrange open for voiceover?",
    ]);
    expect(directionLines(null)).toEqual([]);
  });
});
