import { readFile } from "node:fs/promises";
import path from "node:path";
import { Agent, run, webSearchTool } from "@openai/agents";
import type { AppConfig } from "../config.js";
import { ConfigurationError, GenerationError, UpstreamError } from "../errors.js";
import { PACKAGE_ROOT } from "../paths.js";
import type { FinetuneSummary } from "../models/finetune.js";
import {
  AgentPromptOutputSchema,
  type AgentPromptInput,
  type AgentPromptOutput,
  type PromptGenerationRequest,
} from "../models/prompt.js";
import { findCachedFinetune, finetuneSlug, getFinetune } from "./finetuneService.js";

// Behavioral spec: blueprint + delivery preset mappings, finetune-derived
// sound profile (Section B), and the conflict-resolution rules.
const INSTRUCTIONS_PATH = path.join(PACKAGE_ROOT, "prompts", "generate_music_prompt.md");
const AGENT_MODEL = "gpt-5.6";

let cachedInstructions: string | undefined;
let cachedAgent: Agent<unknown, typeof AgentPromptOutputSchema> | undefined;

async function getInstructions(): Promise<string> {
  if (cachedInstructions == null) {
    try {
      cachedInstructions = await readFile(INSTRUCTIONS_PATH, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // Server misconfiguration — deliberately distinct from a generation
        // failure (spec §8.1): an operator fixes these two differently.
        throw new ConfigurationError(
          `System prompt file not found: ${INSTRUCTIONS_PATH}. The prompts/ directory must be deployed with the server.`,
        );
      }
      throw err;
    }
  }
  return cachedInstructions;
}

async function getAgent(): Promise<Agent<unknown, typeof AgentPromptOutputSchema>> {
  if (!cachedAgent) {
    cachedAgent = new Agent({
      name: "keepsong-prompt-generator",
      instructions: await getInstructions(),
      model: AGENT_MODEL,
      tools: [webSearchTool()],
      // Forces structured JSON output matching the 3-field schema, the
      // @openai/agents equivalent of the Python SDK's output_type.
      outputType: AgentPromptOutputSchema,
    });
  }
  return cachedAgent;
}

/**
 * Dev affordance carried over from the Python app: clears the cached
 * instructions/agent so prompts/generate_music_prompt.md can be hot-edited
 * without restarting.
 */
export function reloadInstructions(): void {
  cachedInstructions = undefined;
  cachedAgent = undefined;
}

export interface GeneratedPrompt extends AgentPromptOutput {
  finetune_id: string;
  finetune_name: string | null;
  sound_profile: string;
}

/**
 * Resolve the finetune that sets the sound. If ElevenLabs is unreachable, fall
 * back to any cached list entry and proceed without finetune_context (the
 * system prompt then infers genre from the slug). With no cached name there is
 * no sound profile, so the upstream error stands.
 */
async function resolveFinetune(
  config: AppConfig,
  id: string,
): Promise<{ finetune: FinetuneSummary; withContext: boolean }> {
  try {
    return { finetune: await getFinetune(config, id), withContext: true };
  } catch (err) {
    const cached = err instanceof UpstreamError ? findCachedFinetune(id) : undefined;
    if (!cached?.name) throw err;
    console.error(`${err instanceof Error ? err.message : err} — using cached finetune name.`);
    return { finetune: cached, withContext: false };
  }
}

export async function generateMusicPrompt(
  config: AppConfig,
  request: PromptGenerationRequest,
): Promise<GeneratedPrompt> {
  const { finetune, withContext } = await resolveFinetune(config, request.finetune_id);
  const soundProfile = finetuneSlug(finetune.name, finetune.id);

  const input: AgentPromptInput = {
    project_blueprint: request.project_blueprint,
    sound_profile: soundProfile,
    finetune_id: finetune.id,
    ...(withContext && {
      finetune_context: {
        name: finetune.name ?? soundProfile,
        primary_genre: finetune.primary_genre ?? null,
        tags: finetune.tags,
      },
    }),
    delivery_and_control: request.delivery_and_control,
    instrumental_only: request.instrumental_only,
    user_narrative: request.user_narrative,
  };

  const agent = await getAgent();

  // The resolved payload, serialized as pretty-printed JSON, is the single
  // user message.
  const userMessage = JSON.stringify(input, null, 2);

  let result;
  try {
    result = await run(agent, userMessage);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new GenerationError(`Prompt generation failed: ${message}`);
  }

  const output = result.finalOutput;
  const parsed = AgentPromptOutputSchema.safeParse(output);
  if (!parsed.success) {
    throw new GenerationError("Prompt generation failed: Agent returned invalid output");
  }
  return {
    ...parsed.data,
    finetune_id: finetune.id,
    finetune_name: finetune.name ?? null,
    sound_profile: soundProfile,
  };
}
