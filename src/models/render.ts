import { z } from "zod";
import { ChunkSchema, DEFAULT_MUSIC_MODEL } from "./plan.js";

// Raw shape is what gets registered as the MCP tool inputSchema. The MCP SDK
// wraps the shape in a plain z.object(), which cannot carry cross-field rules —
// the render tool handler must re-parse args with RenderRequestSchema below to
// enforce them.
export const RenderRequestShape = {
  // --- Generation source: mutually exclusive (enforced by superRefine) ---
  prompt: z.string().describe("Text prompt (text-prompt mode)").nullish(),
  chunks: z.array(ChunkSchema).default([]),

  // --- Prompt-mode only ---
  music_length_ms: z.number().int().min(3000).max(300000).nullish(),

  // --- compose_detailed passthrough params ---
  model_id: z.string().default(DEFAULT_MUSIC_MODEL),
  finetune_id: z.string().describe("Finetune id from list_finetunes").nullish(),
  finetune_strength: z.number().min(0).max(1).nullish(),
  force_instrumental: z.boolean().default(false),
  store_for_inpainting: z.boolean().default(false),
  with_timestamps: z.boolean().default(false),
  sign_with_c2pa: z.boolean().default(false),

  // --- Query-style param ---
  output_format: z
    .string()
    .describe('Audio format, e.g. "mp3_44100_128"; omit to let the API choose')
    .nullish(),

  // --- Local only — NEVER sent to ElevenLabs ---
  title: z.string().describe("Names the stored file; never sent to ElevenLabs").nullish(),
};

export const RenderRequestSchema = z
  .object(RenderRequestShape)
  .superRefine((val, ctx) => {
    const hasPrompt = !!(val.prompt && val.prompt.trim());
    const hasChunks = val.chunks.length > 0;
    if (hasPrompt && hasChunks) {
      ctx.addIssue({ code: "custom", message: "Provide either 'prompt' or 'chunks', not both." });
    }
    if (!hasPrompt && !hasChunks) {
      ctx.addIssue({ code: "custom", message: "Provide either 'prompt' or 'chunks'." });
    }
    if (val.music_length_ms != null && !hasPrompt) {
      ctx.addIssue({
        code: "custom",
        message: "'music_length_ms' can only be used together with 'prompt'.",
      });
    }
    if (val.finetune_strength != null && !val.finetune_id) {
      ctx.addIssue({
        code: "custom",
        message: "'finetune_strength' can only be used together with 'finetune_id'.",
      });
    }
  });

export type RenderRequest = z.infer<typeof RenderRequestSchema>;

export interface RenderResponse {
  id: string; // render id — primary handle for status/resource reads
  filename: string;
  file_path?: string | null; // canonical storage URL/URI — informational only
  download_url: string; // keepsong://renders/{id} (no HTTP passthrough in this deployment)
  stream_url?: string | null;
  content_type: string;
  file_size_bytes: number;
  duration_ms?: number | null;
  composition_plan?: Record<string, unknown> | null;
  song_metadata?: Record<string, unknown> | null;
  finetune_id?: string | null; // style model applied, if any
  finetune_strength?: number | null;
  audio_url?: string | null; // short-lived signed HTTPS URL for players/widgets; null until complete
  request_id: string;
  timestamp: string; // ISO 8601
  title?: string | null;
  prompt?: string | null;
}

/** Live stage of an in-flight render (start_render), from services/renderJobs.ts. */
export interface RenderProgressInfo {
  stage: string;
  percent: number;
  message: string;
}

export const GetRenderStatusShape = {
  render_id: z.string().min(1),
};

export interface RenderStatusPending {
  id: string;
  status: "processing" | "failed";
  error?: string | null;
  progress?: RenderProgressInfo | null;
}
