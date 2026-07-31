import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { RenderMode, RenderStatus } from "./types.js";

export const renders = sqliteTable(
  "renders",
  {
    id: text("id", { length: 36 }).primaryKey(),
    blob_key: text("blob_key"),
    blob_url: text("blob_url"),
    filename: text("filename"),
    content_type: text("content_type").notNull().default("audio/mpeg"),
    file_size_bytes: integer("file_size_bytes").notNull().default(0),
    duration_ms: integer("duration_ms"),
    model_id: text("model_id"),
    title: text("title"),
    prompt: text("prompt"),
    mode: text("mode").$type<RenderMode>(),
    output_format: text("output_format"),
    composition_plan: text("composition_plan", { mode: "json" }).$type<Record<string, unknown>>(),
    song_metadata: text("song_metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    request_id: text("request_id"),
    status: text("status").$type<RenderStatus>().notNull().default("complete"),
    error: text("error"),
    finetune_id: text("finetune_id"),
    finetune_strength: real("finetune_strength"),
    created_at: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("ix_renders_blob_key").on(t.blob_key),
    index("ix_renders_filename").on(t.filename),
    index("ix_renders_request_id").on(t.request_id),
  ],
);
