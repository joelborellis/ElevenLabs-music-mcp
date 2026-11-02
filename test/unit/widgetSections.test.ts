import { describe, expect, it } from "vitest";
import { formatTime, parseSections, sectionAt } from "../../widgets/src/lib/sections";

// Shaped like a real ElevenLabs plan: bracketed labels, lyrics after the label,
// per-section style tags.
const plan = {
  chunks: [
    { text: "[Hook Intro]", duration_ms: 4000, positive_styles: ["124 BPM", "bright major key"] },
    { text: "[Main Teaser] Here comes the bright side\nHere comes the light", duration_ms: 26000, positive_styles: ["124 BPM"] },
  ],
};

describe("widget section parsing", () => {
  it("splits labels from lyrics and accumulates start times", () => {
    const sections = parseSections(plan);
    expect(sections.map((s) => [s.label, s.startMs, s.durationMs])).toEqual([
      ["Hook Intro", 0, 4000],
      ["Main Teaser", 4000, 26000],
    ]);
    expect(sections[0]?.lyrics).toBe("");
    expect(sections[1]?.lyrics).toBe("Here comes the bright side\nHere comes the light");
    expect(sections[0]?.styles).toEqual(["124 BPM", "bright major key"]);
  });

  it("copes with unlabelled chunks and missing plans", () => {
    expect(parseSections(null)).toEqual([]);
    const [section] = parseSections({ chunks: [{ text: "just vibes", duration_ms: 3000 }] });
    expect(section?.label).toBe("just vibes");
    const [unnamed] = parseSections({ chunks: [{ duration_ms: 3000 }] });
    expect(unnamed?.label).toBe("Section 1");
  });

  it("finds the section under the playhead and formats time", () => {
    const sections = parseSections(plan);
    expect(sectionAt(sections, 0)?.label).toBe("Hook Intro");
    expect(sectionAt(sections, 3999)?.label).toBe("Hook Intro");
    expect(sectionAt(sections, 4000)?.label).toBe("Main Teaser");
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(12345)).toBe("0:12");
    expect(formatTime(90000)).toBe("1:30");
    expect(formatTime(Number.NaN)).toBe("0:00");
  });
});
