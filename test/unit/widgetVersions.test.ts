import { describe, expect, it } from "vitest";
import { alwaysInstrumental } from "../../widgets/src/lib/blueprints";
import { styleMessage, variationsFor } from "../../widgets/src/lib/variations";
import {
  isInstrumental,
  normalize,
  previousVersion,
  sameProject,
  useThisOneMessage,
  versionLine,
  versionsOf,
} from "../../widgets/src/lib/versions";
import type { Song } from "../../widgets/src/types";

const sung = { chunks: [{ text: "[Intro]", duration_ms: 4000 }, { text: "[Hook] Here comes the light", duration_ms: 26000 }] };
const bed = { chunks: [{ text: "[Intro]", duration_ms: 4000 }, { text: "[Groove]", duration_ms: 26000 }] };

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: "a",
    title: "Bright Side",
    about: "Sprout launch, April 15",
    duration_ms: 30_000,
    finetune_id: "ft_indie",
    finetune_name: "Indie Dance",
    composition_plan: sung,
    timestamp: "2026-11-02T10:00:00Z",
    ...overrides,
  };
}

describe("widget versions", () => {
  it("groups takes by the 'For:' line, else by title, ignoring case and punctuation", () => {
    expect(normalize("  Sprout launch — April 15! ")).toBe("sprout launch april 15");
    expect(sameProject(song(), song({ id: "b", title: "Other", about: "sprout launch, april 15" }))).toBe(true);
    expect(sameProject(song({ about: null }), song({ id: "b", about: null, title: "bright side" }))).toBe(true);
    expect(sameProject(song(), song({ id: "b", title: "Other", about: "Board offsite" }))).toBe(false);
    expect(sameProject(song({ title: null, about: null }), song({ id: "b", title: null, about: null }))).toBe(false);
  });

  it("lists a song's takes newest first and finds the previous one", () => {
    const first = song({ id: "v1", timestamp: "2026-11-02T10:00:00Z" });
    const second = song({ id: "v2", timestamp: "2026-11-02T11:00:00Z" });
    const unrelated = song({ id: "x", title: "Other", about: "Board offsite", timestamp: "2026-11-02T12:00:00Z" });
    const all = [unrelated, second, first];
    expect(versionsOf(second, all).map((s) => s.id)).toEqual(["v2", "v1"]);
    expect(previousVersion(second, all)?.id).toBe("v1");
    expect(previousVersion(first, all)).toBeUndefined();
    // The current song is always in its own group, even when the list doesn't have it yet.
    expect(versionsOf(second, [first]).map((s) => s.id)).toEqual(["v2", "v1"]);
  });

  it("says what changed since the previous take", () => {
    const base = song();
    expect(isInstrumental(base)).toBe(false);
    expect(isInstrumental(song({ composition_plan: bed }))).toBe(true);
    expect(isInstrumental(song({ composition_plan: null }))).toBeNull();

    expect(versionLine(song({ composition_plan: bed }), base)).toBe("instrumental");
    expect(versionLine(base, song({ composition_plan: bed }))).toBe("with vocals");
    expect(versionLine(song({ duration_ms: 60_000 }), base)).toBe("longer, 1:00");
    expect(versionLine(song({ duration_ms: 15_000, finetune_id: "ft_rock", finetune_name: "Rock" }), base)).toBe(
      "shorter, 0:15 · Rock style",
    );
    expect(versionLine(song({ duration_ms: 31_000 }), base)).toBe("new take"); // within tolerance
    expect(versionLine(base)).toBe("0:30 · Indie Dance · sung");
  });

  it("names the take when the user picks it", () => {
    expect(useThisOneMessage(song(), "instrumental")).toBe(
      'Use "Bright Side" (instrumental) as the song for Sprout launch, April 15.',
    );
    expect(useThisOneMessage(song({ about: null }), "new take")).toBe('Use "Bright Side" as the song.');
  });
});

describe("widget variations", () => {
  it("offers only the chips that change something", () => {
    expect(variationsFor(song()).map((v) => v.label)).toEqual(["Shorter", "Instrumental", "More energy", "Extend to 60s"]);
    expect(variationsFor(song({ composition_plan: bed, duration_ms: 90_000 })).map((v) => v.label)).toEqual([
      "Shorter",
      "More energy",
    ]);
    expect(variationsFor(song({ duration_ms: 10_000 })).map((v) => v.label)).not.toContain("Shorter");
  });

  it("phrases each variation as one follow-up line", () => {
    const instrumental = variationsFor(song()).find((v) => v.label === "Instrumental");
    expect(instrumental?.message).toBe('Make "Bright Side" instrumental, keep everything else the same.');
    expect(styleMessage(song(), "Rock Français")).toBe(
      'Make a version of "Bright Side" in the "Rock Français" style, keep everything else the same.',
    );
  });

  it("knows which uses are always instrumental", () => {
    expect(alwaysInstrumental("podcast_voiceover_loop")).toBe(true);
    expect(alwaysInstrumental("video_game_action_loop")).toBe(true);
    expect(alwaysInstrumental("meditation_sleep")).toBe(true);
    expect(alwaysInstrumental("ad_brand_fast_hook")).toBe(false);
    expect(alwaysInstrumental(undefined)).toBe(false);
  });
});
