/**
 * Live-API smoke test: prompt generation via @openai/agents (requires
 * OPENAI_API_KEY; one gpt-5.6 agent run with web search available).
 *
 *   npm run smoke:prompt
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PromptGenerationRequestSchema } from "../../src/models/prompt.js";
import { generateMusicPrompt } from "../../src/services/promptGenerator.js";

const cases = JSON.parse(
  readFileSync(path.resolve("test/fixtures/prompt_test_cases.json"), "utf8"),
) as Record<string, unknown>;
const defaultCase = (cases.default ?? Object.values(cases)[0]) as Record<string, unknown>;
const payload = (defaultCase.request ?? defaultCase) as Record<string, unknown>;

const request = PromptGenerationRequestSchema.parse(payload);
console.log(`Request: ${JSON.stringify(request)}`);
const output = await generateMusicPrompt(request);
console.log(`OK — title: ${output.title}`);
console.log(`description: ${output.description}`);
console.log(`prompt (${output.prompt.length} chars):\n${output.prompt}`);
