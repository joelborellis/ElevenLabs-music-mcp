import { randomBytes } from "node:crypto";
import { PlanValidationError } from "../errors.js";
import type { Chunk } from "../models/plan.js";
import type { RenderRequest } from "../models/render.js";
import type { ComposeKwargs } from "./elevenlabs.js";

const MIN_TOTAL_MS = 3_000;
const MAX_TOTAL_MS = 300_000; // ElevenLabs' 5-minute generation limit
const MIN_CHUNK_MS = 3_000;

/**
 * Request → compose_detailed call mapping (spec §3.3): optional params are
 * included only when set so the API applies its own defaults; `title` is never
 * sent to ElevenLabs.
 */
export function toComposeKwargs(request: RenderRequest): ComposeKwargs {
  const kwargs: ComposeKwargs = {
    model_id: request.model_id,
    force_instrumental: request.force_instrumental,
    store_for_inpainting: request.store_for_inpainting,
    with_timestamps: request.with_timestamps,
    sign_with_c2pa: request.sign_with_c2pa,
  };
  if (request.output_format != null) kwargs.output_format = request.output_format;
  if (request.finetune_id != null) {
    kwargs.finetune_id = request.finetune_id;
    if (request.finetune_strength != null) kwargs.finetune_strength = request.finetune_strength;
  }
  if (request.prompt && request.prompt.trim()) {
    kwargs.prompt = request.prompt;
    if (request.music_length_ms != null) kwargs.music_length_ms = request.music_length_ms;
  } else {
    kwargs.composition_plan = { chunks: request.chunks };
  }
  return kwargs;
}

/**
 * Chunks-mode validation (spec §4.3). Prompt-mode requests are deliberately
 * not validated here — ElevenLabs validates those itself.
 */
export function validateCompositionPlan(plan: { chunks: Chunk[] }): number {
  const chunks = plan.chunks ?? [];
  if (chunks.length === 0) {
    throw new PlanValidationError("Composition plan must contain at least one chunk.");
  }
  let total = 0;
  chunks.forEach((chunk, index) => {
    const duration = chunk.duration_ms ?? 0;
    if (duration < MIN_CHUNK_MS) {
      const label = chunk.text?.trim() ? `'${chunk.text.trim()}'` : `at index ${index}`;
      throw new PlanValidationError(
        `Each chunk must be at least ${MIN_CHUNK_MS}ms; chunk ${label} is ${duration}ms.`,
      );
    }
    total += duration;
  });
  if (total < MIN_TOTAL_MS || total > MAX_TOTAL_MS) {
    throw new PlanValidationError(
      `Total composition plan duration must be between ${MIN_TOTAL_MS}ms and ${MAX_TOTAL_MS}ms, got ${total}ms.`,
    );
  }
  return total;
}

/**
 * Port of _sanitize_filename: lowercase → collapse whitespace to `_` → strip
 * everything not word-char/hyphen (unicode-aware, like Python's \w) → truncate
 * to 50 chars → append `_<8 hex chars>.mp3`.
 */
export function sanitizeFilename(title: string, randomHex?: string): string {
  const hex = randomHex ?? randomBytes(4).toString("hex");
  const cleaned = title
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .slice(0, 50);
  return `${cleaned}_${hex}.mp3`;
}

/** Content type from the output_format prefix; anything else → audio/mpeg. */
export function contentTypeForOutputFormat(outputFormat: string | null | undefined): string {
  const format = outputFormat ?? "";
  if (format.startsWith("pcm")) return "audio/pcm";
  if (format.startsWith("opus")) return "audio/opus";
  if (format.startsWith("wav")) return "audio/wav";
  return "audio/mpeg";
}

/**
 * duration_ms priority (spec §4.3 step 8): response plan's chunk sum →
 * request chunks' sum → request.music_length_ms.
 */
export function computeDurationMs(
  responsePlan: Record<string, unknown> | null,
  request: RenderRequest,
): number | null {
  const fromPlan = sumChunkDurations(responsePlan?.chunks);
  if (fromPlan != null) return fromPlan;
  const fromRequest = sumChunkDurations(request.chunks);
  if (fromRequest != null) return fromRequest;
  return request.music_length_ms ?? null;
}

function sumChunkDurations(chunks: unknown): number | null {
  if (!Array.isArray(chunks) || chunks.length === 0) return null;
  let total = 0;
  for (const chunk of chunks) {
    const duration = (chunk as { duration_ms?: unknown })?.duration_ms;
    if (typeof duration === "number") total += duration;
  }
  return total > 0 ? total : null;
}
