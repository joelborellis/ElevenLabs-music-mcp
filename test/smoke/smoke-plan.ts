/**
 * Live-API smoke test: composition plan creation (costs no credits per the
 * ElevenLabs docs, but requires ELEVENLABS_API_KEY).
 *
 *   npm run smoke:plan
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../../src/config.js";
import { generateCompositionPlan } from "../../src/services/planGenerator.js";

const config = loadConfig();
const fixture = JSON.parse(
  readFileSync(path.resolve("test/fixtures/plan_test_input.json"), "utf8"),
) as { prompt: string; music_length_ms?: number };

console.log(`Prompt: ${fixture.prompt}`);
const result = await generateCompositionPlan(config, {
  prompt: fixture.prompt,
  music_length_ms: fixture.music_length_ms ?? null,
});
console.log(`OK — received ${result.chunks.length} chunks:`);
for (const chunk of result.chunks) {
  console.log(
    `  ${String(chunk.text).split("\n")[0] || "(no text)"} — ${chunk.duration_ms}ms, ` +
      `${chunk.positive_styles.length} styles, adherence=${chunk.context_adherence ?? "n/a"}`,
  );
}
const total = result.chunks.reduce((sum, c) => sum + c.duration_ms, 0);
console.log(`Total duration: ${total}ms`);
