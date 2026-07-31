CREATE TABLE `renders` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`blob_key` text,
	`blob_url` text,
	`filename` text,
	`content_type` text DEFAULT 'audio/mpeg' NOT NULL,
	`file_size_bytes` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`model_id` text,
	`title` text,
	`prompt` text,
	`mode` text,
	`output_format` text,
	`composition_plan` text,
	`song_metadata` text,
	`request_id` text,
	`status` text DEFAULT 'complete' NOT NULL,
	`error` text,
	`finetune_id` text,
	`finetune_strength` real,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ix_renders_blob_key` ON `renders` (`blob_key`);--> statement-breakpoint
CREATE INDEX `ix_renders_filename` ON `renders` (`filename`);--> statement-breakpoint
CREATE INDEX `ix_renders_request_id` ON `renders` (`request_id`);