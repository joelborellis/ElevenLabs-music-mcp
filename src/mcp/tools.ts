import { randomUUID } from "node:crypto";
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
import { listFinetunes } from "../services/finetuneService.js";
import { generateCompositionPlan } from "../services/planGenerator.js";
import { generateMusicPrompt } from "../services/promptGenerator.js";
import { render, type ProgressCallback, type RenderResult } from "../services/renderService.js";
import type { StorageBackend } from "../services/storage/index.js";
import { toToolError, toolJson } from "./errors.js";

export interface ToolDeps {
  config: AppConfig;
  storage: StorageBackend;
  repo: RenderRepository;
}

export function renderUri(id: string): string {
  return `keepsong://renders/${id}`;
}

function resultToResponse(result: RenderResult, requestId: string): RenderResponse {
  return {
    id: result.id,
    filename: result.filename,
    file_path: result.blob_url,
    download_url: renderUri(result.id),
    stream_url: renderUri(result.id),
    content_type: result.content_type,
    file_size_bytes: result.file_size_bytes,
    duration_ms: result.duration_ms,
    composition_plan: result.composition_plan,
    song_metadata: result.song_metadata,
    finetune_id: result.finetune_id,
    finetune_strength: result.finetune_strength,
    request_id: requestId,
    timestamp: new Date().toISOString(),
  };
}

export function rowToResponse(row: RenderRow): RenderResponse {
  return {
    id: row.id,
    filename: row.filename ?? "",
    file_path: row.blob_url,
    download_url: renderUri(row.id),
    stream_url: renderUri(row.id),
    content_type: row.content_type,
    file_size_bytes: row.file_size_bytes,
    duration_ms: row.duration_ms,
    composition_plan: row.composition_plan,
    song_metadata: row.song_metadata,
    finetune_id: row.finetune_id,
    finetune_strength: row.finetune_strength,
    request_id: row.request_id ?? "",
    timestamp: row.created_at.toISOString(),
  };
}

export function registerTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "generate_music_prompt",
    {
      title: "Generate music prompt",
      description:
        "Write a polished music_v2_5 text prompt from a finetune plus two presets and an optional freeform narrative. Pick a finetune with list_finetunes first: the finetune sets the genre/sound, the project blueprint sets the form (use case, length, structure, vocals) and delivery & control sets how prescriptive the prompt is. The result feeds generate_composition_plan or render_music — pass the returned finetune_id to render_music so the audio matches the prompt.",
      inputSchema: PromptGenerationRequestShape,
    },
    async (args) => {
      try {
        const output = await generateMusicPrompt(deps.config, args);
        const response: PromptGenerationResponse = {
          prompt: output.prompt,
          title: output.title,
          description: output.description,
          finetune_id: output.finetune_id,
          finetune_name: output.finetune_name,
          sound_profile: output.sound_profile,
          request_id: randomUUID(),
          timestamp: new Date().toISOString(),
          input_parameters: args,
        };
        return toolJson(response);
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
        "Turn a text prompt into a structured, section-by-section music_v2_5 composition plan (chunks with styles and durations). If music_length_ms is omitted, a duration mentioned in the prompt text (e.g. '30 seconds') is used, else 30s. The returned chunks feed render_music.",
      inputSchema: PlanGenerationRequestShape,
    },
    async (args) => {
      try {
        const response = await generateCompositionPlan(deps.config, args);
        return toolJson(response);
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
        "Generate actual audio via ElevenLabs from EITHER a text prompt OR composition-plan chunks (never both). Optionally steer the style with a finetune_id from list_finetunes; when the prompt came from generate_music_prompt, pass the same finetune_id it returned. Rendering can take from seconds to a few minutes; progress notifications are emitted when the call includes a progressToken. The returned id is durable — if the call times out or disconnects, poll get_render_status with it instead of re-submitting. Audio is retrieved via the keepsong://renders/{id} resource.",
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
        return toolJson(resultToResponse(result, requestId));
      } catch (err) {
        return toToolError(err);
      }
    },
  );

  server.registerTool(
    "get_render_status",
    {
      title: "Get render status",
      description:
        "Recover the state of a render by id: returns the full render result when complete, or its processing/failed status otherwise. Use this after a render_music call was interrupted or timed out, instead of re-submitting the render.",
      inputSchema: GetRenderStatusShape,
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
        if (row.status === "complete") {
          return toolJson(rowToResponse(row));
        }
        const pending: RenderStatusPending = {
          id: row.id,
          status: row.status,
          error: row.error,
        };
        return toolJson(pending);
      } catch (err) {
        return toToolError(err);
      }
    },
  );

  server.registerTool(
    "list_finetunes",
    {
      title: "List finetunes",
      description:
        "List ElevenLabs music finetunes (custom-trained style models, e.g. 'Rock Français') that can steer render_music via finetune_id. Only completed finetunes are returned unless include_incomplete is true. Results are cached briefly; set refresh to bypass the cache.",
      inputSchema: ListFinetunesShape,
    },
    async (args) => {
      try {
        const response = await listFinetunes(deps.config, ListFinetunesSchema.parse(args));
        return toolJson(response);
      } catch (err) {
        return toToolError(err);
      }
    },
  );
}
