import type {
  CreateProcessingInput,
  MarkCompleteInput,
  RenderRepository,
  RenderRow,
} from "../src/db/types.js";
import type { StorageBackend } from "../src/services/storage/index.js";

/** In-memory RenderRepository with the same durability flow as the real one. */
export function fakeRepo(seed: RenderRow[] = []): RenderRepository & { rows: Map<string, RenderRow> } {
  const rows = new Map(seed.map((row) => [row.id, row]));
  return {
    rows,
    async createProcessing(input: CreateProcessingInput) {
      rows.set(input.id, {
        id: input.id,
        blob_key: null,
        blob_url: null,
        filename: null,
        content_type: "audio/mpeg",
        file_size_bytes: 0,
        duration_ms: null,
        model_id: input.model_id ?? null,
        title: input.title ?? null,
        prompt: input.prompt ?? null,
        mode: input.mode,
        output_format: input.output_format ?? null,
        composition_plan: input.composition_plan ?? null,
        song_metadata: null,
        request_id: input.request_id,
        status: "processing",
        error: null,
        finetune_id: input.finetune_id ?? null,
        finetune_strength: input.finetune_strength ?? null,
        created_at: new Date(),
      });
    },
    async markComplete(id: string, input: MarkCompleteInput) {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, ...input, status: "complete" });
    },
    async markFailed(id: string, error: string) {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, status: "failed", error });
    },
    async getById(id: string) {
      return rows.get(id) ?? null;
    },
    async listRenders(limit = 50, offset = 0) {
      return [...rows.values()]
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(offset, offset + limit);
    },
  };
}

export function completeRow(overrides: Partial<RenderRow> = {}): RenderRow {
  return {
    id: "r1",
    blob_key: "song.mp3",
    blob_url: "file:///song.mp3",
    filename: "song.mp3",
    content_type: "audio/mpeg",
    file_size_bytes: 10,
    duration_ms: 8000,
    model_id: "music_v2_5",
    title: "Spring Roast Groove",
    prompt: "a song",
    mode: "prompt",
    output_format: null,
    composition_plan: { chunks: [{ text: "[Intro]", duration_ms: 3000 }] },
    song_metadata: null,
    request_id: "req-1",
    status: "complete",
    error: null,
    finetune_id: "ft_indie",
    finetune_strength: null,
    created_at: new Date("2026-11-01T00:00:00Z"),
    ...overrides,
  };
}

/** In-memory StorageBackend keyed by filename. */
export function fakeStorage(seed: Record<string, Buffer> = {}): StorageBackend & { files: Map<string, Buffer> } {
  const files = new Map(Object.entries(seed));
  return {
    files,
    async save(key, data) {
      files.set(key, data);
      return `memory://${key}`;
    },
    async *openStream(key) {
      const data = files.get(key);
      if (data) yield data;
    },
    async getBytes(key) {
      return files.get(key) ?? null;
    },
    async delete(key) {
      files.delete(key);
    },
    async exists(key) {
      return files.has(key);
    },
  };
}
