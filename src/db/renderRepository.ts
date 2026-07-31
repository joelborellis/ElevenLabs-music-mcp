import { desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { DbConnection } from "./client.js";
import type * as sqliteSchema from "./schema.sqlite.js";
import type {
  CreateProcessingInput,
  MarkCompleteInput,
  RenderRepository,
  RenderRow,
} from "./types.js";

export function createRenderRepository(conn: DbConnection): RenderRepository {
  // The drizzle query-builder calls below are textually identical for both
  // dialects and both row shapes match RenderRow (asserted by the
  // schema-mirror unit test), so the implementation is written once against
  // the sqlite types and narrowed here rather than duplicated per dialect.
  const db = conn.db as BetterSQLite3Database;
  const renders = conn.renders as typeof sqliteSchema.renders;

  return {
    async createProcessing(input: CreateProcessingInput): Promise<void> {
      await db.insert(renders).values({
        id: input.id,
        request_id: input.request_id,
        title: input.title ?? null,
        prompt: input.prompt ?? null,
        mode: input.mode,
        model_id: input.model_id ?? null,
        output_format: input.output_format ?? null,
        composition_plan: input.composition_plan ?? null,
        finetune_id: input.finetune_id ?? null,
        finetune_strength: input.finetune_strength ?? null,
        status: "processing",
      });
    },

    async markComplete(id: string, input: MarkCompleteInput): Promise<void> {
      await db
        .update(renders)
        .set({
          blob_key: input.blob_key,
          blob_url: input.blob_url ?? null,
          filename: input.filename,
          content_type: input.content_type,
          file_size_bytes: input.file_size_bytes,
          duration_ms: input.duration_ms ?? null,
          composition_plan: input.composition_plan ?? null,
          song_metadata: input.song_metadata ?? null,
          status: "complete",
          error: null,
        })
        .where(eq(renders.id, id));
    },

    async markFailed(id: string, error: string): Promise<void> {
      await db.update(renders).set({ status: "failed", error }).where(eq(renders.id, id));
    },

    async getById(id: string): Promise<RenderRow | null> {
      const rows = await db.select().from(renders).where(eq(renders.id, id)).limit(1);
      return (rows[0] as RenderRow | undefined) ?? null;
    },

    async listRenders(limit = 50, offset = 0): Promise<RenderRow[]> {
      const rows = await db
        .select()
        .from(renders)
        .orderBy(desc(renders.created_at))
        .limit(limit)
        .offset(offset);
      return rows as RenderRow[];
    },
  };
}
