import { z } from "zod";

// Three-choice preset enums — product-defined, unrelated to ElevenLabs finetunes.
export const ProjectBlueprintSchema = z.enum([
  "ad_brand_fast_hook",
  "podcast_voiceover_loop",
  "video_game_action_loop",
  "meditation_sleep",
  "standalone_song_mini",
]);

export const SoundProfileSchema = z.enum([
  "bright_pop_electro",
  "dark_trap_night",
  "lofi_cozy",
  "epic_cinematic",
  "indie_live_band",
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
  sound_profile: SoundProfileSchema,
  delivery_and_control: DeliveryAndControlSchema,
  instrumental_only: z.boolean().default(false),
  user_narrative: z
    .string()
    .describe("Freeform story/occasion/people details; primary creative context when present")
    .nullish(),
};

export const PromptGenerationRequestSchema = z.object(PromptGenerationRequestShape);
export type PromptGenerationRequest = z.infer<typeof PromptGenerationRequestSchema>;

// Structured output the LLM agent is constrained to produce.
export const AgentPromptOutputSchema = z.object({
  prompt: z.string(),
  title: z.string(),
  description: z.string(),
});
export type AgentPromptOutput = z.infer<typeof AgentPromptOutputSchema>;

export interface PromptGenerationResponse {
  prompt: string;
  title?: string | null;
  description?: string | null;
  request_id: string;
  timestamp: string; // ISO 8601
  input_parameters: PromptGenerationRequest;
}
