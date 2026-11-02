import { z } from "zod";

// Closed preset enums (blueprint = form, delivery = strictness/mix). The sound
// itself comes from an ElevenLabs finetune, passed by id — see finetune_id.
export const ProjectBlueprintSchema = z.enum([
  "ad_brand_fast_hook",
  "podcast_voiceover_loop",
  "video_game_action_loop",
  "meditation_sleep",
  "standalone_song_mini",
]);

export const DeliveryAndControlSchema = z.enum([
  "exploratory_iterate",
  "balanced_studio",
  "blueprint_plan_first",
  "live_one_take",
  "isolation_stems",
]);

// Raw shape is what gets registered as the MCP tool inputSchema.
export const PromptGenerationRequestShape = {
  project_blueprint: ProjectBlueprintSchema,
  finetune_id: z
    .string()
    .min(1)
    .describe("Finetune id from list_finetunes; sets the sound. Pass the same id to render_music"),
  delivery_and_control: DeliveryAndControlSchema,
  instrumental_only: z.boolean().default(false),
  user_narrative: z
    .string()
    .describe("Freeform story/occasion/people details; primary creative context when present")
    .nullish(),
};

export const PromptGenerationRequestSchema = z.object(PromptGenerationRequestShape);
export type PromptGenerationRequest = z.infer<typeof PromptGenerationRequestSchema>;

// Resolved server-side from finetune_id; the agent derives genre detail from it.
export interface FinetuneContext {
  name: string;
  primary_genre: string | null;
  tags: string[];
}

// The payload actually sent to the agent (the keys prompts/generate_music_prompt.md expects).
export interface AgentPromptInput {
  project_blueprint: PromptGenerationRequest["project_blueprint"];
  sound_profile: string; // slug of the finetune name
  finetune_id: string;
  finetune_context?: FinetuneContext;
  delivery_and_control: PromptGenerationRequest["delivery_and_control"];
  instrumental_only: boolean;
  user_narrative?: string | null;
}

// Structured output the LLM agent is constrained to produce. `about` is the
// one-line "what this song is for" the studio card shows (empty when there was
// no narrative).
export const AgentPromptOutputSchema = z.object({
  prompt: z.string(),
  title: z.string(),
  description: z.string(),
  about: z.string(),
});
export type AgentPromptOutput = z.infer<typeof AgentPromptOutputSchema>;

export interface PromptGenerationResponse {
  prompt: string;
  title?: string | null;
  description?: string | null;
  about?: string | null;
  finetune_id: string; // pass to render_music
  finetune_name?: string | null;
  sound_profile: string; // slug derived from the finetune name
  request_id: string;
  timestamp: string; // ISO 8601
  input_parameters: PromptGenerationRequest;
}
