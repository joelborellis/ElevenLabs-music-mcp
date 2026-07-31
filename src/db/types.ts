export type RenderStatus = "processing" | "complete" | "failed";
export type RenderMode = "prompt" | "plan";

/**
 * Shared row shape produced by both dialect schemas (a unit test asserts the
 * two schemas stay mirrored). blob_key/filename are nullable — unlike the
 * Python schema — because the durability flow (spec §8.3) inserts the row with
 * status "processing" BEFORE ElevenLabs returns a filename.
 */
export interface RenderRow {
  id: string;
  blob_key: string | null;
  blob_url: string | null;
  filename: string | null;
  content_type: string;
  file_size_bytes: number;
  duration_ms: number | null;
  model_id: string | null;
  title: string | null;
  prompt: string | null;
  mode: RenderMode | null;
  output_format: string | null;
  composition_plan: Record<string, unknown> | null;
  song_metadata: Record<string, unknown> | null;
  request_id: string | null;
  status: RenderStatus;
  error: string | null;
  // New vs. the Python schema: render provenance the spec recommends persisting.
  finetune_id: string | null;
  finetune_strength: number | null;
  created_at: Date;
}

export interface CreateProcessingInput {
  id: string;
  request_id: string;
  title?: string | null;
  prompt?: string | null;
  mode: RenderMode;
  model_id?: string | null;
  output_format?: string | null;
  composition_plan?: Record<string, unknown> | null;
  finetune_id?: string | null;
  finetune_strength?: number | null;
}

export interface MarkCompleteInput {
  blob_key: string;
  blob_url?: string | null;
  filename: string;
  content_type: string;
  file_size_bytes: number;
  duration_ms?: number | null;
  composition_plan?: Record<string, unknown> | null;
  song_metadata?: Record<string, unknown> | null;
}

export interface RenderRepository {
  /** Insert the row before calling ElevenLabs (spec §8.3 durability flow). */
  createProcessing(input: CreateProcessingInput): Promise<void>;
  markComplete(id: string, input: MarkCompleteInput): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  getById(id: string): Promise<RenderRow | null>;
  /** Newest-first. Backs the MCP resources/list. */
  listRenders(limit?: number, offset?: number): Promise<RenderRow[]>;
}
