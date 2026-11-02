import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import { ConfigurationError, GenerationError, PlanValidationError } from "../errors.js";
import type { RenderRequest } from "../models/render.js";
import type { RenderRepository } from "../db/types.js";
import type { StorageBackend } from "./storage/index.js";
import {
  rawComposeDetailed,
  type ComposeDetailedResult,
  type ComposeKwargs,
} from "./elevenlabs.js";
import {
  computeDurationMs,
  contentTypeForOutputFormat,
  sanitizeFilename,
  toComposeKwargs,
  validateCompositionPlan,
} from "./renderUtils.js";

export interface RenderResult {
  id: string;
  filename: string;
  blob_key: string;
  blob_url: string | null;
  content_type: string;
  file_size_bytes: number;
  duration_ms: number | null;
  composition_plan: Record<string, unknown> | null;
  song_metadata: Record<string, unknown> | null;
  song_id: string | null;
  finetune_id: string | null;
  finetune_strength: number | null;
}

/** Stage vocabulary preserved from the Python WS path (spec §4.3). */
export type ProgressStage =
  | "validating"
  | "validated"
  | "generating"
  | "processing"
  | "saving"
  | "extracting"
  | "complete";

export type ProgressCallback = (
  stage: ProgressStage,
  percent: number,
  message: string,
) => void | Promise<void>;

export interface RenderOptions {
  /** Pre-chosen render id, so a caller can hand it out before the render finishes. */
  id?: string;
  /** Fires once the "processing" row exists — i.e. once get_render_status can find it. */
  onStarted?: (id: string) => void;
}

export interface RenderServiceDeps {
  config: AppConfig;
  storage: StorageBackend;
  repo: RenderRepository;
  /** Injection seam for tests; defaults to the raw-HTTP compose path. */
  compose?: (config: AppConfig, kwargs: ComposeKwargs) => Promise<ComposeDetailedResult>;
}

// ElevenLabs offers no real progress signal, so while compose_detailed is in
// flight progress is simulated: +5 every 2s, capped at 65 (spec §4.3).
const GENERATING_START = 15;
const GENERATING_CAP = 65;
const GENERATING_TICK_MS = 2_000;

function jsonField(
  json: Record<string, unknown>,
  snake: string,
  camel: string,
): Record<string, unknown> | null {
  const value = json[snake] ?? json[camel];
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * Unified render path (the Python app's duplicated blocking/WS variants,
 * collapsed). Durability flow per spec §8.3: the row is written with status
 * "processing" BEFORE calling ElevenLabs, then updated to complete/failed —
 * so a caller that loses its connection can recover via get_render_status.
 */
export async function render(
  deps: RenderServiceDeps,
  request: RenderRequest,
  requestId: string,
  onProgress?: ProgressCallback,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const emit = async (stage: ProgressStage, percent: number, message: string) => {
    if (onProgress) await onProgress(stage, percent, message);
  };

  await emit("validating", 5, "Validating request...");
  const kwargs = toComposeKwargs(request);
  const chunksMode = kwargs.composition_plan != null;
  if (kwargs.composition_plan) {
    validateCompositionPlan(kwargs.composition_plan); // throws PlanValidationError
  }
  await emit("validated", 10, "Request validated");

  const id = options.id ?? randomUUID();
  await deps.repo.createProcessing({
    id,
    request_id: requestId,
    title: request.title ?? null,
    prompt: request.prompt ?? null,
    mode: chunksMode ? "plan" : "prompt",
    model_id: request.model_id,
    output_format: request.output_format ?? null,
    composition_plan: kwargs.composition_plan ? { chunks: kwargs.composition_plan.chunks } : null,
    finetune_id: request.finetune_id ?? null,
    finetune_strength: request.finetune_strength ?? null,
  });
  options.onStarted?.(id);

  try {
    // --- generating: simulated progress while the API call is in flight ---
    let percent = GENERATING_START;
    await emit("generating", percent, "Generating music with ElevenLabs...");
    const ticker = onProgress
      ? setInterval(() => {
          percent = Math.min(GENERATING_CAP, percent + 5);
          void Promise.resolve(
            onProgress("generating", percent, "Generating music with ElevenLabs..."),
          ).catch(() => {});
        }, GENERATING_TICK_MS)
      : undefined;

    let composed: ComposeDetailedResult;
    try {
      const compose = deps.compose ?? rawComposeDetailed;
      composed = await compose(deps.config, kwargs);
    } finally {
      if (ticker) clearInterval(ticker);
    }

    await emit("processing", 75, "Processing audio...");
    const filename = request.title?.trim()
      ? sanitizeFilename(request.title)
      : composed.filename;
    const contentType = contentTypeForOutputFormat(request.output_format);

    await emit("saving", 90, "Saving audio...");
    const blobUrl = await deps.storage.save(filename, composed.audio, contentType);

    await emit("extracting", 95, "Extracting metadata...");
    const compositionPlan = jsonField(composed.json, "composition_plan", "compositionPlan");
    const songMetadata = jsonField(composed.json, "song_metadata", "songMetadata");
    const durationMs = computeDurationMs(compositionPlan, request);

    await deps.repo.markComplete(id, {
      blob_key: filename,
      blob_url: blobUrl,
      filename,
      content_type: contentType,
      file_size_bytes: composed.audio.length,
      duration_ms: durationMs,
      composition_plan: compositionPlan,
      song_metadata: songMetadata,
    });

    await emit("complete", 100, "Render complete");
    return {
      id,
      filename,
      blob_key: filename,
      blob_url: blobUrl,
      content_type: contentType,
      file_size_bytes: composed.audio.length,
      duration_ms: durationMs,
      composition_plan: compositionPlan,
      song_metadata: songMetadata,
      song_id: composed.songId,
      finetune_id: request.finetune_id ?? null,
      finetune_strength: request.finetune_strength ?? null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.repo.markFailed(id, message).catch(() => {});
    if (
      err instanceof PlanValidationError ||
      err instanceof GenerationError ||
      err instanceof ConfigurationError
    ) {
      throw err;
    }
    throw new GenerationError(`Music render failed: ${message}`);
  }
}
