/**
 * ElevenLabs composition plans arrive as chunks whose `text` is a section
 * label in brackets, optionally followed by the lyrics sung in that section:
 *   "[Hook Intro]"                       → instrumental section
 *   "[Main Teaser] Here comes the bright…" → section with lyrics
 * `positive_styles` holds the sound tags for the section ("124 BPM", "D major").
 */
export interface Section {
  index: number;
  label: string;
  lyrics: string;
  startMs: number;
  durationMs: number;
  styles: string[];
}

export interface PlanLike {
  chunks?: Array<{ text?: unknown; duration_ms?: unknown; positive_styles?: unknown }>;
}

export function parseSections(plan: PlanLike | null | undefined): Section[] {
  const chunks = plan?.chunks ?? [];
  let start = 0;
  return chunks.map((chunk, index) => {
    const text = String(chunk.text ?? "").trim();
    const match = /^\[([^\]]+)\]\s*([\s\S]*)$/.exec(text);
    const label = match ? match[1].trim() : text.split("\n")[0]?.trim() || `Section ${index + 1}`;
    const lyrics = match ? match[2].trim() : "";
    const durationMs = Math.max(0, Number(chunk.duration_ms ?? 0) || 0);
    const styles = Array.isArray(chunk.positive_styles) ? chunk.positive_styles.map(String) : [];
    const section: Section = { index, label, lyrics, startMs: start, durationMs, styles };
    start += durationMs;
    return section;
  });
}

export function totalDuration(sections: Section[]): number {
  return sections.reduce((sum, s) => sum + s.durationMs, 0);
}

/** 12345 ms → "0:12" */
export function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** The section the playhead is in (last one whose start is <= time). */
export function sectionAt(sections: Section[], timeMs: number): Section | undefined {
  let current: Section | undefined;
  for (const section of sections) {
    if (section.startMs <= timeMs) current = section;
    else break;
  }
  return current;
}
