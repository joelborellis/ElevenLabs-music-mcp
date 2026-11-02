/** The "Use" chip: human labels for project_blueprint, plus the render length each implies. */
export const USES = [
  { id: "ad_brand_fast_hook", label: "30s teaser", lengthMs: 30_000 },
  { id: "podcast_voiceover_loop", label: "60s background bed", lengthMs: 60_000 },
  { id: "standalone_song_mini", label: "90s song", lengthMs: 90_000 },
  { id: "video_game_action_loop", label: "Game loop", lengthMs: 90_000 },
  { id: "meditation_sleep", label: "Calm & sleep", lengthMs: null },
] as const;

export type BlueprintId = (typeof USES)[number]["id"];

export function useLabel(id: string | undefined): string {
  return USES.find((u) => u.id === id)?.label ?? "Song";
}

/** Server render stages → words a producer would use. */
const STAGE_WORDS: Record<string, string> = {
  validating: "Reading the brief",
  validated: "Reading the brief",
  generating: "Performing",
  processing: "Mixing",
  saving: "Mixing",
  extracting: "Finishing",
  complete: "Done",
};

export function stageWord(stage: string | undefined): string {
  return (stage && STAGE_WORDS[stage]) || "Getting ready";
}

/**
 * Length to ask ElevenLabs for: a duration stated in the prompt ("30-second",
 * "about 1 minute") wins, else the blueprint's default, else let the API decide.
 * Clamped to the API's 3s–5min window.
 */
export function renderLengthMs(prompt: string | null | undefined, blueprint: string | undefined): number | undefined {
  const match = /(\d+(?:\.\d+)?)\s*[- ]?(seconds?|secs?|minutes?|mins?)\b/i.exec(prompt ?? "");
  if (match) {
    const n = Number(match[1]);
    const ms = /^m/i.test(match[2]) ? n * 60_000 : n * 1000;
    return Math.min(300_000, Math.max(3000, Math.round(ms)));
  }
  return USES.find((u) => u.id === blueprint)?.lengthMs ?? undefined;
}

/** First few sentences of the prompt — the "direction" preview on the brief. */
export function directionLines(prompt: string | null | undefined, max = 3): string[] {
  return (prompt ?? "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}
