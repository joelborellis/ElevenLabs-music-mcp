/**
 * Live-API smoke test for the highest-risk integration (spec §4.3/Appendix B):
 * the raw-HTTP compose_detailed path, including finetune_id/finetune_strength
 * pass-through and the multipart response shape.
 *
 * COSTS REAL CREDITS (renders one ~8s clip). Never run in CI.
 *
 *   npm run smoke:compose-finetune            # picks the first completed finetune
 *   npm run smoke:compose-finetune -- --no-finetune
 *
 * Static findings this verifies at runtime (already confirmed against the
 * installed SDKs): wire param names are sign_with_c2pa / finetune_id /
 * finetune_strength; the JS SDK wrapper lacks finetune_strength entirely and
 * returns the multipart body unparsed, which is why the raw path is the
 * default, not a fallback.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../../src/config.js";
import { ListFinetunesSchema } from "../../src/models/finetune.js";
import { rawComposeDetailed } from "../../src/services/elevenlabs.js";
import { listFinetunes } from "../../src/services/finetuneService.js";

const config = loadConfig();
const useFinetune = !process.argv.includes("--no-finetune");

let finetuneId: string | undefined;
if (useFinetune) {
  const page = await listFinetunes(
    config,
    ListFinetunesSchema.parse({ model_id: "music_v2", page_size: 50 }),
  );
  finetuneId = page.finetunes[0]?.id;
  console.log(
    finetuneId
      ? `Using finetune: ${page.finetunes[0]?.name} (${finetuneId})`
      : "No completed music_v2 finetunes available — composing without one.",
  );
}

const result = await rawComposeDetailed(config, {
  prompt: "A short, upbeat 8-second bright pop-electro hook at 120 BPM in E major.",
  music_length_ms: 8000,
  model_id: "music_v2",
  force_instrumental: true,
  store_for_inpainting: false,
  with_timestamps: true, // exercise the timestamps field of the response too
  sign_with_c2pa: false,
  output_format: "mp3_44100_128",
  ...(finetuneId ? { finetune_id: finetuneId, finetune_strength: 0.8 } : {}),
});

console.log("OK — multipart parsed:");
console.log(`  filename:  ${result.filename}`);
console.log(`  audio:     ${result.audio.length} bytes`);
console.log(`  song-id:   ${result.songId ?? "(header absent)"}`);
console.log(`  json keys: ${Object.keys(result.json).join(", ")}`);

const outPath = path.resolve("test/smoke/last-smoke-output.mp3");
writeFileSync(outPath, result.audio);
console.log(`Audio written to ${outPath} — play it to verify it is valid MP3` +
  (finetuneId ? " and that the finetune audibly influenced the style." : "."));
