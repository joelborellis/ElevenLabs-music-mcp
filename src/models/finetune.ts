import { z } from "zod";

export const FinetuneVisibilitySchema = z.enum(["private", "workspace", "public"]);
export const FinetuneCreatedBySchema = z.enum(["self", "workspace", "elevenlabs"]);

// Python uses `extra="ignore"` here (opposite of Chunk) — a plain zod object
// strips unknown keys on parse, which matches.
export const FinetuneSummarySchema = z.object({
  id: z.string(), // pass as finetune_id to render_music
  name: z.string().nullish(),
  tags: z.array(z.string()).default([]),
  primary_genre: z.string().nullish(),
  model_id: z.string().nullish(), // e.g. "music_v2"
  created_at: z.string().nullish(), // ISO datetime
  visibility: FinetuneVisibilitySchema.nullish(),
  created_by: FinetuneCreatedBySchema.nullish(),
  status: z.string().nullish(), // e.g. "completed"
  training_progress: z.number().nullish(), // 0.0-1.0
  failure_reason: z.string().nullish(),
});
export type FinetuneSummary = z.infer<typeof FinetuneSummarySchema>;

export interface FinetuneListResponse {
  finetunes: FinetuneSummary[];
  count: number; // filtered count
  has_more: boolean; // upstream, unfiltered page
  next_cursor?: string | null;
}

// MCP tool input — mirrors GET /finetunes query params.
export const ListFinetunesShape = {
  model_id: z.string().nullish(),
  visibility: FinetuneVisibilitySchema.nullish(),
  created_by: FinetuneCreatedBySchema.nullish(),
  include_incomplete: z.boolean().default(false),
  cursor: z.string().nullish(),
  page_size: z.number().int().min(1).max(100).nullish(),
  refresh: z.boolean().default(false),
};
export const ListFinetunesSchema = z.object(ListFinetunesShape);
export type ListFinetunesRequest = z.infer<typeof ListFinetunesSchema>;
