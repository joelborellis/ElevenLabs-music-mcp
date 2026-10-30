/**
 * Live-API smoke test: prompt generation via @openai/agents (requires
 * OPENAI_API_KEY and ELEVENLABS_API_KEY; one gpt-5.6 agent run with web search
 * available, plus a finetune lookup).
 *
 *   FINETUNE_ID=<id> npm run smoke:prompt
 *
 * Without FINETUNE_ID, the first completed finetune from list_finetunes is used.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../../src/config.js";
import { ListFinetunesSchema } from "../../src/models/finetune.js";
import { PromptGenerationRequestSchema } from "../../src/models/prompt.js";
import { listFinetunes } from "../../src/services/finetuneService.js";
import { generateMusicPrompt } from "../../src/services/promptGenerator.js";

const config = loadConfig();

const cases = JSON.parse(
  readFileSync(path.resolve("test/fixtures/prompt_test_cases.json"), "utf8"),
) as Record<string, unknown>;
const defaultCase = cases.default as Record<string, unknown>;

let finetuneId = process.env.FINETUNE_ID;
if (!finetuneId) {
  const { finetunes } = await listFinetunes(config, ListFinetunesSchema.parse({}));
  finetuneId = finetunes[0]?.id;
  if (!finetuneId) throw new Error("No completed finetunes available; set FINETUNE_ID.");
}

const request = PromptGenerationRequestSchema.parse({ ...defaultCase, finetune_id: finetuneId });
console.log(`Request: ${JSON.stringify(request)}`);
const output = await generateMusicPrompt(config, request);
console.log(`OK — finetune: ${output.finetune_name} (${output.finetune_id}), sound_profile: ${output.sound_profile}`);
console.log(`title: ${output.title}`);
console.log(`description: ${output.description}`);
console.log(`prompt (${output.prompt.length} chars):\n${output.prompt}`);
