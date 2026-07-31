CREATE TABLE IF NOT EXISTS "renders" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"blob_key" text,
	"blob_url" text,
	"filename" text,
	"content_type" text DEFAULT 'audio/mpeg' NOT NULL,
	"file_size_bytes" bigint DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"model_id" text,
	"title" text,
	"prompt" text,
	"mode" text,
	"output_format" text,
	"composition_plan" jsonb,
	"song_metadata" jsonb,
	"request_id" text,
	"status" text DEFAULT 'complete' NOT NULL,
	"error" text,
	"finetune_id" text,
	"finetune_strength" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Adopt a pre-existing renders table created by the Python app's Alembic
-- migration (68a008a079ed): add the Node-port columns and relax the
-- constraints the processing-first durability flow requires. Every statement
-- is idempotent, so this migration works against both a fresh database and
-- the adopted one.
ALTER TABLE "renders" ADD COLUMN IF NOT EXISTS "error" text;--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN IF NOT EXISTS "finetune_id" text;--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN IF NOT EXISTS "finetune_strength" double precision;--> statement-breakpoint
ALTER TABLE "renders" ALTER COLUMN "blob_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "renders" ALTER COLUMN "filename" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "renders" ALTER COLUMN "content_type" SET DEFAULT 'audio/mpeg';--> statement-breakpoint
ALTER TABLE "renders" ALTER COLUMN "file_size_bytes" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "renders" ALTER COLUMN "status" SET DEFAULT 'complete';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ix_renders_blob_key" ON "renders" USING btree ("blob_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_renders_filename" ON "renders" USING btree ("filename");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_renders_request_id" ON "renders" USING btree ("request_id");
