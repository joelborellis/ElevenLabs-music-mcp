import { randomUUID } from "node:crypto";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../config.js";
import type { RenderRepository, RenderRow } from "../db/types.js";
import { ListFinetunesSchema, ListFinetunesShape } from "../models/finetune.js";
import { PlanGenerationRequestShape } from "../models/plan.js";
import { PromptGenerationRequestShape, type PromptGenerationResponse } from "../models/prompt.js";
import {
  GetRenderStatusShape,
  RenderRequestShape,
  RenderRequestSchema,
  type RenderResponse,
  type RenderStatusPending,
} from "../models/render.js";
import { findCachedFinetune, getFinetune, listFinetunes } from "../services/finetuneService.js";
import { signRenderUrl } from "../services/media.js";
import { generateCompositionPlan } from "../services/planGenerator.js";
import { generateMusicPrompt } from "../services/promptGenerator.js";
import { clearJob, getBrief, getProgress, setBrief, setProgress } from "../services/renderJobs.js";
import { render, type ProgressCallback, type RenderResult } from "../services/renderService.js";
import type { StorageBackend } from "../services/storage/index.js";
import { toToolError, toolJson, toolUi } from "./errors.js";
import { STUDIO_URI } from "./ui.js";

export interface ToolDeps {
  config: AppConfig;
  storage: StorageBackend;
  repo: RenderRepository;
}

// Renders created by preview_style (8-second style tastes) carry this title
// prefix so they never show up as the user's songs.
export const PREVIEW_TITLE_PREFIX = "preview:";

export function renderUri(id: string): string {
  return `keepsong://renders/${id}`;
}

/** Human name for the style badge — from the finetunes cache only, never a network call. */
function finetuneName(id: string | null | undefined): string | null {
  return id ? (findCachedFinetune(id)?.name ?? null) : null;
}

/** One list call (itself cached) so style names resolve even right after a restart. */
async function warmFinetuneCache(config: AppConfig): Promise<void> {
  try {
    await listFinetunes(config, ListFinetunesSchema.parse({ include_incomplete: true, page_size: 100 }));
  } catch {
    // The badge is decoration; never fail a status call over it.
  }
}

async function resolveFinetuneName(config: AppConfig, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const cached = finetuneName(id);
  if (cached) return cached;
  await warmFinetuneCache(config);
  return finetuneName(id);
}

/** The short prompt behind an 8-second style taste (the finetune itself carries the sound). */
function previewPrompt(descriptor: string): string {
  return `An eight-second instrumental taste${descriptor ? ` — ${descriptor}` : ""}: one confident, characteristic musical phrase at full energy from the first beat, no intro silence, no fade-out, no vocals.`;
}

function resultToResponse(result: RenderResult, requestId: string, config: AppConfig): RenderResponse {
  return {
    id: result.id,
    filename: result.filename,
    file_path: result.blob_url,
    download_url: renderUri(result.id),
    stream_url: renderUri(result.id),
    audio_url: signRenderUrl(config, result.id),
    content_type: result.content_type,
    file_size_bytes: result.file_size_bytes,
    duration_ms: result.duration_ms,
    composition_plan: result.composition_plan,
    song_metadata: result.song_metadata,
    finetune_id: result.finetune_id,
    finetune_name: finetuneName(result.finetune_id),
    finetune_strength: result.finetune_strength,
    request_id: requestId,
    timestamp: new Date().toISOString(),
  };
}

export function rowToResponse(row: RenderRow, config: AppConfig): RenderResponse {
  return {
    id: row.id,
    filename: row.filename ?? "",
    file_path: row.blob_url,
    download_url: renderUri(row.id),
    stream_url: renderUri(row.id),
    audio_url: row.status === "complete" && row.blob_key ? signRenderUrl(config, row.id) : null,
    content_type: row.content_type,
    file_size_bytes: row.file_size_bytes,
    duration_ms: row.duration_ms,
    composition_plan: row.composition_plan,
    song_metadata: row.song_metadata,
    finetune_id: row.finetune_id,
    finetune_name: finetuneName(row.finetune_id),
    finetune_strength: row.finetune_strength,
    request_id: row.request_id ?? "",
    timestamp: row.created_at.toISOString(),
    title: row.title,
    prompt: row.prompt,
  };
}

// Every widget tool renders the same studio card; `kind` in structuredContent
// picks the state (brief / styles / composing / song / failed / versions).
const studio = { ui: { resourceUri: STUDIO_URI } };

export function registerTools(server: McpServer, deps: ToolDeps): void {
  registerAppTool(
    server,
    "generate_music_prompt",
    {
      title: "Generate music prompt",
      description:
        "Write a polished music_v2_5 text prompt from a finetune plus two presets and an optional freeform narrative. Pick a finetune with list_finetunes first: the finetune sets the genre/sound, the project blueprint sets the form (use case, length, structure, vocals) and delivery & control sets how prescriptive the prompt is. Put the user's story, occasion, product or document in user_narrative — it drives lyrics and emotion. The result feeds start_render (or render_music) — pass the returned finetune_id along so the audio matches the prompt.",
      inputSchema: PromptGenerationRequestShape,
      // Copilot asks the user to confirm every tool that isn't read-only; these
      // have no side effects (and spend no ElevenLabs credits), so skip the prompt.
      annotations: { readOnlyHint: true },
      _meta: studio,
    },
    async (args) => {
      try {
        const output = await generateMusicPrompt(deps.config, args);
        const response: PromptGenerationResponse = {
          prompt: output.prompt,
          title: output.title,
          description: output.description,
          about: output.about || null,
          finetune_id: output.finetune_id,
          finetune_name: output.finetune_name,
          sound_profile: output.sound_profile,
          request_id: randomUUID(),
          timestamp: new Date().toISOString(),
          input_parameters: args,
        };
        return toolUi("brief", { ...response });
      } catch (err) {
        return toToolError(err);
      }
    },
  );

  server.registerTool(
    "generate_composition_plan",
    {
      title: "Generate composition plan",
      description:
        "Turn a text prompt into a structured, section-by-section music_v2_5 composition plan (chunks with styles and durations). If music_length_ms is omitted, a duration mentioned in the prompt text (e.g. '30 seconds') is used, else 30s. The returned chunks feed render_music / start_render.",
      inputSchema: PlanGenerationRequestShape,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const response = await generateCompositionPlan(deps.config, args);
        return toolUi("plan", { ...response });
      } catch (err) {
        return toToolError(err);
      }
    },
  );

  server.registerTool(
    "render_music",
    {
      title: "Render music",
      description:
        "Generate the song audio with ElevenLabs (uses credits) and wait for it to finish. Inputs: EITHER a text prompt OR composition-plan chunks (never both). Prefer start_render when a UI card is shown (it returns immediately). Optionally steer the style with a finetune_id from list_finetunes; when the prompt came from generate_music_prompt, pass the same finetune_id it returned. Rendering can take from seconds to a few minutes; progress notifications are emitted when the call includes a progressToken. The returned id is durable — if the call times out or disconnects, poll get_render_status with it instead of re-submitting. Audio is retrieved via the keepsong://renders/{id} resource or the signed audio_url.",
      inputSchema: RenderRequestShape,
    },
    async (args, extra) => {
      try {
        // Re-parse to enforce the cross-field rules (prompt/chunks mutual
        // exclusivity etc.) that a raw shape cannot express.
        const request = RenderRequestSchema.parse(args);
        const progressToken = extra._meta?.progressToken;
        const onProgress: ProgressCallback | undefined =
          progressToken != null
            ? async (stage, percent, message) => {
                await extra.sendNotification({
                  method: "notifications/progress",
                  params: {
                    progressToken,
                    progress: percent,
                    total: 100,
                    message: `${stage}: ${message}`,
                  },
                });
              }
            : undefined;
        const requestId = randomUUID();
        const result = await render(deps, request, requestId, onProgress);
        return toolJson(resultToResponse(result, requestId, deps.config));
      } catch (err) {
        return toToolError(err);
      }
    },
  );

  registerAppTool(
    server,
    "start_render",
    {
      title: "Start rendering a song",
      description:
        // Copilot shows this text on the confirmation prompt (the call spends
        // ElevenLabs credits), so the first sentence is written for the user.
        "Compose the song now: generates the audio with ElevenLabs (uses credits) and returns right away so the card can show progress. Prefer this over render_music whenever the Keepsong Studio card is shown. Inputs: EITHER a text prompt OR composition-plan chunks (never both), plus the finetune_id returned by generate_music_prompt; pass the brief's title, description and about too so the card can show them. The card polls get_render_status itself; you can also call it with the returned id.",
      inputSchema: RenderRequestShape,
      _meta: studio,
    },
    async (args) => {
      try {
        const request = RenderRequestSchema.parse(args);
        const requestId = randomUUID();
        const id = randomUUID();
        const brief = {
          title: request.title ?? null,
          description: request.description ?? null,
          about: request.about ?? null,
          finetune_name: await resolveFinetuneName(deps.config, request.finetune_id),
        };
        setBrief(id, brief);
        const onProgress: ProgressCallback = (stage, percent, message) => {
          setProgress(id, stage, percent, message);
        };
        // Resolve as soon as the "processing" row exists (so get_render_status
        // can find it); reject only if the render fails before that point.
        await new Promise<void>((resolve, reject) => {
          render(deps, request, requestId, onProgress, { id, onStarted: () => resolve() }).then(
            () => clearJob(id),
            (err: unknown) => {
              clearJob(id);
              reject(err);
            },
          );
        });
        return toolUi("composing", {
          id,
          status: "processing",
          request_id: requestId,
          ...brief,
          prompt: request.prompt ?? null,
          finetune_id: request.finetune_id ?? null,
          progress: getProgress(id) ?? null,
        });
      } catch (err) {
        return toToolError(err);
      }
    },
  );

  registerAppTool(
    server,
    "get_render_status",
    {
      title: "Get render status",
      description:
        "Recover the state of a render by id: returns the full render result (with a signed audio_url) when complete, or its processing/failed status — including live progress for renders started with start_render. Use this after start_render, or after a render_music call was interrupted, instead of re-submitting the render.",
      inputSchema: GetRenderStatusShape,
      annotations: { readOnlyHint: true },
      _meta: studio,
    },
    async (args) => {
      try {
        const row = await deps.repo.getById(args.render_id);
        if (!row) {
          return {
            content: [{ type: "text", text: `Render not found: ${args.render_id}` }],
            isError: true,
          };
        }
        // The brief (description / about / style name) only exists in memory
        // for renders this process started; later states fall back gracefully.
        const brief = getBrief(row.id);
        if (row.status === "complete") {
          const response = rowToResponse(row, deps.config);
          return toolUi("song", {
            ...response,
            finetune_name:
              brief?.finetune_name ?? (await resolveFinetuneName(deps.config, row.finetune_id)),
            description: brief?.description ?? null,
            about: brief?.about ?? null,
          });
        }
        const pending: RenderStatusPending = {
          id: row.id,
          status: row.status,
          error: row.error,
          progress: getProgress(row.id) ?? null,
        };
        return toolUi(row.status === "failed" ? "failed" : "composing", {
          ...pending,
          title: row.title,
          prompt: row.prompt,
          finetune_id: row.finetune_id,
          finetune_name: brief?.finetune_name ?? finetuneName(row.finetune_id),
          description: brief?.description ?? null,
          about: brief?.about ?? null,
        });
      } catch (err) {
        return toToolError(err);
      }
    },
  );

  registerAppTool(
    server,
    "list_finetunes",
    {
      title: "List finetunes",
      description:
        "List ElevenLabs music finetunes (custom-trained style models, e.g. 'Rock Français') that set the sound for generate_music_prompt and render_music via finetune_id. Call this first when the user wants a song, then pick the style that fits their words (or let them choose in the card). Only completed finetunes are returned unless include_incomplete is true. Results are cached briefly; set refresh to bypass the cache.",
      inputSchema: ListFinetunesShape,
      annotations: { readOnlyHint: true },
      _meta: studio,
    },
    async (args) => {
      try {
        const response = await listFinetunes(deps.config, ListFinetunesSchema.parse(args));
        return toolUi("styles", { ...response });
      } catch (err) {
        return toToolError(err);
      }
    },
  );

  registerAppTool(
    server,
    "list_renders",
    {
      title: "List recent songs",
      description:
        "Recent completed songs, newest first, with titles, descriptions and signed audio URLs. Use this to find a song the user refers to by name or as 'the last one' (e.g. in a new chat), then call get_render_status with its id to show the player. Also backs the card's Versions rail.",
      inputSchema: { limit: z.number().int().min(1).max(50).default(20) },
      annotations: { readOnlyHint: true },
      _meta: studio,
    },
    async (args) => {
      try {
        // Over-fetch generously: style previews and in-flight rows are filtered out
        // below, and a run of recent previews must not hide the user's songs.
        const rows = (await deps.repo.listRenders(args.limit + 100))
          .filter((row) => row.status === "complete" && !row.title?.startsWith(PREVIEW_TITLE_PREFIX))
          .slice(0, args.limit);
        if (rows.some((row) => row.finetune_id && !finetuneName(row.finetune_id))) {
          await warmFinetuneCache(deps.config);
        }
        const renders = rows.map((row) => {
          const brief = getBrief(row.id);
          return {
            ...rowToResponse(row, deps.config),
            description: brief?.description ?? null,
            about: brief?.about ?? null,
          };
        });
        return toolUi("versions", { renders });
      } catch (err) {
        return toToolError(err);
      }
    },
  );

  registerAppTool(
    server,
    "preview_style",
    {
      title: "Hear a taste of a style",
      description:
        "Card-only: an 8-second instrumental sample of one finetune so the user can hear a style before composing. Rendered once per style and reused after that.",
      inputSchema: { finetune_id: z.string().min(1).describe("Finetune id from list_finetunes") },
      // Cached after the first render and never visible to the model, so the
      // host shouldn't interrupt a tap on "Hear a taste" with a confirmation.
      annotations: { readOnlyHint: true, idempotentHint: true },
      _meta: { ui: { resourceUri: STUDIO_URI, visibility: ["app" as const] } },
    },
    async (args) => {
      try {
        const title = `${PREVIEW_TITLE_PREFIX}${args.finetune_id}`;
        const existing = (await deps.repo.listRenders(200)).find(
          (row) => row.title === title && row.status === "complete" && row.blob_key,
        );
        if (existing) {
          return toolUi("preview", {
            finetune_id: args.finetune_id,
            audio_url: signRenderUrl(deps.config, existing.id),
            duration_ms: existing.duration_ms,
            cached: true,
          });
        }
        const finetune = await getFinetune(deps.config, args.finetune_id);
        const descriptor = [finetune.primary_genre, ...finetune.tags].filter(Boolean).join(", ");
        const request = RenderRequestSchema.parse({
          prompt: previewPrompt(descriptor),
          music_length_ms: 8000,
          force_instrumental: true,
          finetune_id: args.finetune_id,
          title,
        });
        const result = await render(deps, request, randomUUID());
        return toolUi("preview", {
          finetune_id: args.finetune_id,
          audio_url: signRenderUrl(deps.config, result.id),
          duration_ms: result.duration_ms,
          cached: false,
        });
      } catch (err) {
        return toToolError(err);
      }
    },
  );
}
