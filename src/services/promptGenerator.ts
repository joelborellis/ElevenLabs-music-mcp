import { readFile } from "node:fs/promises";
import path from "node:path";
import { Agent, run, webSearchTool } from "@openai/agents";
import { ConfigurationError, GenerationError } from "../errors.js";
import {
  AgentPromptOutputSchema,
  type AgentPromptOutput,
  type PromptGenerationRequest,
} from "../models/prompt.js";

// The 359-line behavioral spec for all 15 presets + 6 conflict-resolution
// rules — carried over VERBATIM from the Python app (spec §11.2 #3).
const INSTRUCTIONS_PATH = path.resolve("prompts/generate_music_prompt.md");
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

export async function generateMusicPrompt(
  request: PromptGenerationRequest,
): Promise<AgentPromptOutput> {
  const agent = await getAgent();

  // The entire validated request, serialized as pretty-printed JSON, is the
  // single user message (mirrors request.model_dump_json(indent=2)).
  const userMessage = JSON.stringify(request, null, 2);

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
  return parsed.data;
}
