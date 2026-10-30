import { z } from "zod";

// ElevenLabs music model used for planning and (by default) rendering.
export const DEFAULT_MUSIC_MODEL = "music_v2_5";

// A single section of a music_v2 / music_v2_5 composition plan.
// The Python model uses `extra="allow"` — unknown fields (e.g. a future
// `conditioning_ref` / `condition_strength`) must be preserved, not dropped,
// hence looseObject (zod v4's passthrough object). looseObject alone emits
// `additionalProperties: {}`, which schema linters flag as untyped; the .meta()
// below spells the same contract as an explicit `true`.
export const ChunkSchema = z.looseObject({
  text: z.string().default(""),
  positive_styles: z.array(z.string()).default([]),
  negative_styles: z.array(z.string()).default([]),
  duration_ms: z.number().int(),
  context_adherence: z.string().describe('How closely this section follows prior context, e.g. "high"').nullish(),
}).meta({ additionalProperties: true });
export type Chunk = z.infer<typeof ChunkSchema>;

// NOTE: floor is 1000 here — deliberately different from RenderRequest's 3000
// floor (spec Appendix B warns not to conflate the two).
export const PlanGenerationRequestShape = {
  prompt: z.string().min(1),
  music_length_ms: z.number().int().min(1000).max(300000).nullish(),
};
export const PlanGenerationRequestSchema = z.object(PlanGenerationRequestShape);
export type PlanGenerationRequest = z.infer<typeof PlanGenerationRequestSchema>;

export interface CompositionPlanResponse {
  chunks: Chunk[];
}
