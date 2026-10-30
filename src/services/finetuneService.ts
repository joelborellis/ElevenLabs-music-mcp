import { ElevenLabsError, type ElevenLabs } from "@elevenlabs/elevenlabs-js";
import type { AppConfig } from "../config.js";
import { ConfigurationError } from "../config.js";
import { InvalidInputError, UpstreamError } from "../errors.js";
import type {
  FinetuneListResponse,
  FinetuneSummary,
  ListFinetunesRequest,
} from "../models/finetune.js";
import { getElevenLabsClient } from "./elevenlabs.js";

interface CachedPage {
  finetunes: FinetuneSummary[];
  hasMore: boolean;
  nextCursor: string | null;
  fetchedAtMs: number;
}

// Keyed on the UPSTREAM call parameters only (spec §4.4). model_id and
// only_completed are applied client-side per request, so one fetched page
// serves many filter combinations.
const cache = new Map<string, CachedPage>();

/** Test seam. */
export function clearFinetuneCache(): void {
  cache.clear();
}

function cacheKey(req: ListFinetunesRequest): string {
  return JSON.stringify([
    req.visibility ?? null,
    req.created_by ?? null,
    req.cursor ?? null,
    req.page_size ?? null,
  ]);
}

function toSummary(item: ElevenLabs.MusicFinetuneResponseModel): FinetuneSummary {
  const createdAt = item.createdAt;
  return {
    id: item.id,
    name: item.name ?? null,
    tags: item.tags ?? [],
    primary_genre: item.primaryGenre ?? null,
    model_id: item.modelId ?? null,
    created_at:
      createdAt instanceof Date ? createdAt.toISOString() : ((createdAt as string | undefined) ?? null),
    visibility: item.visibility ?? null,
    created_by: item.createdBy ?? null,
    status: item.status ?? null,
    training_progress: item.trainingProgress ?? null,
    failure_reason: item.failureReason ?? null,
  };
}

export async function listFinetunes(
  config: AppConfig,
  req: ListFinetunesRequest,
): Promise<FinetuneListResponse> {
  const ttlMs = config.finetunesCacheTtlSeconds * 1000;
  const key = cacheKey(req);

  let page: CachedPage | undefined;
  if (ttlMs > 0 && !req.refresh) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.fetchedAtMs < ttlMs) {
      page = cached;
    }
  }

  if (!page) {
    const client = getElevenLabsClient(config); // throws ConfigurationError if key missing
    let upstream;
    try {
      upstream = await client.music.finetunes.list({
        visibility: req.visibility ?? undefined,
        createdBy: req.created_by ?? undefined,
        cursor: req.cursor ?? undefined,
        pageSize: req.page_size ?? undefined,
      });
    } catch (err) {
      if (err instanceof ConfigurationError) throw err;
      // Deliberately kept distinct from generation failures: this is the one
      // call class the Python app maps to 502 Bad Gateway (spec §4.4).
      const message = err instanceof Error ? err.message : String(err);
      throw new UpstreamError(`ElevenLabs finetunes listing failed: ${message}`);
    }
    page = {
      finetunes: (upstream.finetunes ?? []).map(toSummary),
      hasMore: upstream.hasMore ?? false,
      nextCursor: upstream.nextCursor ?? null,
      fetchedAtMs: Date.now(),
    };
    if (ttlMs > 0) cache.set(key, page);
  }

  // Client-side, per-request filters — never part of the cache key.
  const onlyCompleted = !req.include_incomplete;
  const filtered = page.finetunes.filter((f) => {
    if (req.model_id && f.model_id !== req.model_id) return false;
    if (onlyCompleted && f.status !== "completed") return false;
    return true;
  });

  return {
    finetunes: filtered,
    count: filtered.length, // filtered count
    has_more: page.hasMore, // upstream, unfiltered page
    next_cursor: page.nextCursor,
  };
}

/**
 * Look up a finetune already fetched by listFinetunes, with no network call.
 * maxAgeMs bounds staleness; omit it to accept any cached page (used as the
 * fallback when ElevenLabs is unreachable — a stale name beats no name).
 */
export function findCachedFinetune(id: string, maxAgeMs?: number): FinetuneSummary | undefined {
  for (const page of cache.values()) {
    if (maxAgeMs != null && Date.now() - page.fetchedAtMs >= maxAgeMs) continue;
    const hit = page.finetunes.find((f) => f.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Resolve one finetune for prompt generation: fresh list cache first, else
 * GET /finetunes/{id}. Unknown or not-yet-trained finetunes are caller errors.
 */
export async function getFinetune(config: AppConfig, id: string): Promise<FinetuneSummary> {
  let finetune = findCachedFinetune(id, config.finetunesCacheTtlSeconds * 1000);
  if (!finetune) {
    const client = getElevenLabsClient(config); // throws ConfigurationError if key missing
    try {
      finetune = toSummary(await client.music.finetunes.get(id));
    } catch (err) {
      if (err instanceof ElevenLabsError && (err.statusCode === 404 || err.statusCode === 422)) {
        throw new InvalidInputError(`Finetune not found: ${id}`);
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new UpstreamError(`ElevenLabs finetune lookup failed: ${message}`);
    }
  }
  if (finetune.status !== "completed") {
    throw new InvalidInputError(
      `Finetune ${id} is not ready (status: ${finetune.status ?? "unknown"}).`,
    );
  }
  return finetune;
}

/** "Rock Français" → "rock_francais": the sound_profile slug the system prompt expects. */
export function finetuneSlug(name: string | null | undefined, fallback: string): string {
  const slug = (name ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // strip combining marks left by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || fallback;
}
