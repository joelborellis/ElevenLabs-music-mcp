import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { AppConfig } from "../config.js";
import { ConfigurationError } from "../config.js";
import type { Chunk } from "../models/plan.js";

const API_BASE = "https://api.elevenlabs.io";
// The JS SDK uses a 240s default timeout for compose_detailed; renders can run
// longer, so the raw path allows up to 10 minutes before aborting.
const COMPOSE_TIMEOUT_MS = 600_000;

/**
 * Wire-shape body for POST /v1/music/detailed (snake_case, confirmed against
 * the SDK serialization layer). `output_format` travels as a query param, not
 * in the body. `finetune_strength` exists on the wire (the Python raw client
 * sends it) but is missing from the JS SDK entirely — one of the two reasons
 * this module bypasses the SDK wrapper for compose_detailed. The other: the JS
 * wrapper returns the multipart response as an unparsed byte stream anyway.
 */
export interface ComposeKwargs {
  prompt?: string;
  music_length_ms?: number;
  composition_plan?: { chunks: Chunk[] };
  model_id: string;
  force_instrumental: boolean;
  store_for_inpainting: boolean;
  with_timestamps: boolean;
  sign_with_c2pa: boolean;
  finetune_id?: string;
  finetune_strength?: number;
  output_format?: string;
}

export interface ComposeDetailedResult {
  json: Record<string, unknown>; // contains composition_plan / song_metadata
  audio: Buffer;
  filename: string;
  songId: string | null;
}

// One shared client for plan + finetune calls (spec §9.2: consolidate the
// Python app's three separate client constructions), lazily validated.
let sharedClient: ElevenLabsClient | undefined;

export function getElevenLabsClient(config: AppConfig): ElevenLabsClient {
  if (!sharedClient) {
    const apiKey = requireApiKey(config);
    sharedClient = new ElevenLabsClient({ apiKey });
  }
  return sharedClient;
}

export function requireApiKey(config: AppConfig): string {
  if (!config.elevenLabsApiKey) {
    throw new ConfigurationError("ELEVENLABS_API_KEY is not configured.");
  }
  return config.elevenLabsApiKey;
}

/** Test seam. */
export function resetElevenLabsClient(): void {
  sharedClient = undefined;
}

export class ElevenLabsApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly body: string,
  ) {
    super(message);
  }
}

/**
 * Raw-HTTP compose_detailed (spec §4.3/§11.1). Returns parsed multipart:
 * JSON metadata + audio bytes + filename + the song-id response header.
 */
export async function rawComposeDetailed(
  config: AppConfig,
  kwargs: ComposeKwargs,
  signal?: AbortSignal,
): Promise<ComposeDetailedResult> {
  const apiKey = requireApiKey(config);
  const { output_format, ...body } = kwargs;

  const url = new URL("/v1/music/detailed", API_BASE);
  if (output_format != null) url.searchParams.set("output_format", output_format);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(COMPOSE_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new ElevenLabsApiError(
      `ElevenLabs compose_detailed failed with status ${response.status}`,
      response.status,
      errBody,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const parsed = parseComposeMultipart(buffer, response.headers.get("content-type"));
  return { ...parsed, songId: response.headers.get("song-id") };
}

const CRLF_SEP = Buffer.from("\r\n\r\n");
const LF_SEP = Buffer.from("\n\n");

function findBodyStart(data: Buffer, from: number): number {
  const crlf = data.indexOf(CRLF_SEP, from);
  const lf = data.indexOf(LF_SEP, from);
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return crlf + CRLF_SEP.length;
  if (lf !== -1) return lf + LF_SEP.length;
  throw new Error("Could not find header/body separator in multipart part");
}

/**
 * Port of the Python SDK's hand-rolled `_parse_multipart` (the response is not
 * form-data-disposition multipart, so undici's response.formData() cannot be
 * relied on). Part 1: JSON metadata. Part 2: raw audio bytes to end-of-body,
 * with a trailing closing boundary stripped when present.
 */
export function parseComposeMultipart(
  body: Buffer,
  contentType?: string | null,
): Omit<ComposeDetailedResult, "songId"> {
  if (body.length === 0) throw new Error("Empty response from music API");

  // Boundary: prefer the Content-Type header, else the first line of the body
  // (the Python parser's behavior).
  let boundaryText: string | undefined;
  const headerMatch = contentType?.match(/boundary="?([^";]+)"?/i);
  if (headerMatch) boundaryText = `--${headerMatch[1]}`;
  if (!boundaryText) {
    const nl = body.indexOf(0x0a);
    boundaryText = body
      .subarray(0, nl === -1 ? body.length : nl)
      .toString("utf8")
      .trim();
  }
  const boundary = Buffer.from(boundaryText);

  const first = body.indexOf(boundary);
  if (first === -1) throw new Error("Could not find multipart boundary");
  const second = body.indexOf(boundary, first + boundary.length);
  if (second === -1) throw new Error("Could not find audio part boundary");

  // --- Part 1: JSON metadata ---
  const jsonPart = body.subarray(first + boundary.length, second);
  const jsonHeaderEnd = findBodyStart(jsonPart, 0);
  const jsonHeaders = jsonPart.subarray(0, jsonHeaderEnd).toString("utf8");
  const jsonText = jsonPart.subarray(jsonHeaderEnd).toString("utf8").trim();
  let jsonData: Record<string, unknown> | undefined;
  if (/application\/json/i.test(jsonHeaders) || jsonText.startsWith("{")) {
    try {
      jsonData = JSON.parse(jsonText) as Record<string, unknown>;
    } catch {
      /* handled below */
    }
  }
  if (!jsonData) throw new Error("Could not parse JSON data");

  // --- Part 2: audio ---
  const audioBodyStart = findBodyStart(body, second + boundary.length);
  const audioHeaders = body.subarray(second + boundary.length, audioBodyStart).toString("utf8");
  let audio = body.subarray(audioBodyStart);

  // Strip a trailing `\r\n--boundary--\r\n` terminator if the API sends one.
  const closing = Buffer.from(`${boundaryText}--`);
  const closingAt = audio.lastIndexOf(closing);
  if (closingAt !== -1 && audio.length - closingAt <= closing.length + 4) {
    let cut = closingAt;
    while (cut > 0 && (audio[cut - 1] === 0x0a || audio[cut - 1] === 0x0d)) cut--;
    audio = audio.subarray(0, cut);
  }

  // Filename comes from the audio part's Content-Disposition header.
  const filenameMatch =
    audioHeaders.match(/filename="([^"]+)"/) ?? jsonHeaders.match(/filename="([^"]+)"/);
  const filename = filenameMatch?.[1] ?? "generated_music.mp3";

  return { json: jsonData, audio: Buffer.from(audio), filename };
}
