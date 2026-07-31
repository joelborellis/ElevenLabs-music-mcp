import { describe, expect, it } from "vitest";
import {
  extractDurationFromPrompt,
  resolveMusicLengthMs,
} from "../../src/services/planGenerator.js";

describe("extractDurationFromPrompt", () => {
  it.each([
    ["a 30-second bright pop ad", 30_000],
    ["make it 30 seconds long", 30_000],
    ["one 1 second sting", 1000],
    ["a 2 minutes lofi loop", 120_000],
    ["roughly 1.5 minute track", 90_000],
    ["45 SECONDS of energy", 45_000],
  ])("extracts %s → %d", (prompt, expected) => {
    expect(extractDurationFromPrompt(prompt)).toBe(expected);
  });

  it("prefers seconds over minutes when both appear", () => {
    // The seconds pattern is tried first (spec §4.2).
    expect(extractDurationFromPrompt("2 minutes of intro then 30 seconds outro")).toBe(30_000);
  });

  it("clamps to [1000, 300000]", () => {
    expect(extractDurationFromPrompt("0.5 seconds blip")).toBe(1000);
    expect(extractDurationFromPrompt("10 minutes odyssey")).toBe(300_000);
  });

  it("returns null when no duration is present", () => {
    expect(extractDurationFromPrompt("an upbeat pop track")).toBeNull();
  });
});

describe("resolveMusicLengthMs priority", () => {
  it("explicit request value wins over prompt text", () => {
    expect(resolveMusicLengthMs({ prompt: "a 30-second ad", music_length_ms: 12_000 })).toBe(12_000);
  });

  it("falls back to prompt extraction, then the 30s default", () => {
    expect(resolveMusicLengthMs({ prompt: "a 45 seconds ad" })).toBe(45_000);
    expect(resolveMusicLengthMs({ prompt: "an ad" })).toBe(30_000);
  });
});
