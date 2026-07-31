import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import type { RenderMode, RenderStatus } from "./types.js";

export const renders = pgTable(
  "renders",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    blob_key: text("blob_key"),
    blob_url: text("blob_url"),
    filename: text("filename"),
    content_type: text("content_type").notNull().default("audio/mpeg"),
    file_size_bytes: bigint("file_size_bytes", { mode: "number" }).notNull().default(0),
    duration_ms: integer("duration_ms"),
    model_id: text("model_id"),
    title: text("title"),
    prompt: text("prompt"),
    mode: text("mode").$type<RenderMode>(),
    output_format: text("output_format"),
    composition_plan: jsonb("composition_plan").$type<Record<string, unknown>>(),
    song_metadata: jsonb("song_metadata").$type<Record<string, unknown>>(),
    request_id: text("request_id"),
    status: text("status").$type<RenderStatus>().notNull().default("complete"),
    error: text("error"),
    finetune_id: text("finetune_id"),
    finetune_strength: doublePrecision("finetune_strength"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ix_renders_blob_key").on(t.blob_key),
    index("ix_renders_filename").on(t.filename),
    index("ix_renders_request_id").on(t.request_id),
  ],
);
