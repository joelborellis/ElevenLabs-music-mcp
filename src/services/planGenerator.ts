import type { AppConfig } from "../config.js";
import { ConfigurationError } from "../config.js";
import { GenerationError } from "../errors.js";
import type { Chunk, CompositionPlanResponse, PlanGenerationRequest } from "../models/plan.js";
import { getElevenLabsClient } from "./elevenlabs.js";

const DEFAULT_MUSIC_LENGTH_MS = 30_000;
const MIN_MS = 1_000;
const MAX_MS = 300_000;

// Match "30-second", "30 seconds", "2 minutes", "1.5 minute" — seconds tried
// first, then minutes (spec §4.2).
const SECONDS_RE = /(\d+(\.\d+)?)\s*[-\s]?\s*seconds?/i;
const MINUTES_RE = /(\d+(\.\d+)?)\s*[-\s]?\s*minutes?/i;

export function extractDurationFromPrompt(prompt: string): number | null {
  const seconds = SECONDS_RE.exec(prompt);
  if (seconds?.[1]) {
    return clamp(Math.round(parseFloat(seconds[1]) * 1000));
  }
  const minutes = MINUTES_RE.exec(prompt);
  if (minutes?.[1]) {
    return clamp(Math.round(parseFloat(minutes[1]) * 60_000));
  }
  return null;
}

function clamp(ms: number): number {
  return Math.min(MAX_MS, Math.max(MIN_MS, ms));
}

/** Duration priority: explicit request value → extracted from prompt → 30s default. */
export function resolveMusicLengthMs(request: PlanGenerationRequest): number {
  return (
    request.music_length_ms ?? extractDurationFromPrompt(request.prompt) ?? DEFAULT_MUSIC_LENGTH_MS
  );
}

export async function generateCompositionPlan(
  config: AppConfig,
  request: PlanGenerationRequest,
): Promise<CompositionPlanResponse> {
  const musicLengthMs = resolveMusicLengthMs(request);
  try {
    const client = getElevenLabsClient(config);
    const plan = await client.music.compositionPlan.create({
      prompt: request.prompt,
      musicLengthMs,
      modelId: "music_v2",
    });

    // music_v2 returns { chunks }; the SDK deserializes wire snake_case to
    // camelCase, so map back with the same plain 5-field copy the Python
    // service performs.
    const rawChunks = "chunks" in plan ? plan.chunks : [];
    const chunks: Chunk[] = rawChunks.map((c) => {
      const chunk = c as Partial<{
        text: string;
        positiveStyles: string[];
        negativeStyles: string[];
        durationMs: number;
        contextAdherence: string;
      }>;
      return {
        text: chunk.text ?? "",
        positive_styles: chunk.positiveStyles ?? [],
        negative_styles: chunk.negativeStyles ?? [],
        duration_ms: chunk.durationMs ?? 0,
        context_adherence: chunk.contextAdherence ?? null,
      };
    });
    return { chunks };
  } catch (err) {
    if (err instanceof ConfigurationError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new GenerationError(`Composition plan generation failed: ${message}`);
  }
}
