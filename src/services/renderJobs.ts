import type { RenderProgressInfo } from "../models/render.js";

/**
 * In-memory state for renders started with start_render.
 *
 * - `progress`: live stage + percent while ElevenLabs is working, so the
 *   studio card can show "performing… 45%" instead of a bare spinner. Cleared
 *   when the row carries the final state.
 * - `briefs`: the brief the card was composed from (description, "about",
 *   style name) — the renders table only stores title/prompt, so this is what
 *   lets later states keep saying what the song is for. Bounded; survives
 *   only as long as the process.
 *
 * Single-process by design (fine for the dev tunnel). For multi-replica Azure
 * hosting, persist both on the row instead — see docs/checkpoint.md.
 */
const jobs = new Map<string, RenderProgressInfo>();

export interface RenderBrief {
  title: string | null;
  description: string | null;
  about: string | null;
  finetune_name: string | null;
}

const briefs = new Map<string, RenderBrief>();
const MAX_BRIEFS = 200;

export function setProgress(id: string, stage: string, percent: number, message: string): void {
  jobs.set(id, { stage, percent, message });
}

export function getProgress(id: string): RenderProgressInfo | undefined {
  return jobs.get(id);
}

/** Drop the live entry once the row carries the final state. */
export function clearJob(id: string): void {
  jobs.delete(id);
}

export function setBrief(id: string, brief: RenderBrief): void {
  briefs.set(id, brief);
  if (briefs.size > MAX_BRIEFS) {
    const oldest = briefs.keys().next().value;
    if (oldest !== undefined) briefs.delete(oldest);
  }
}

export function getBrief(id: string): RenderBrief | undefined {
  return briefs.get(id);
}

/** Test seam. */
export function clearAllJobs(): void {
  jobs.clear();
  briefs.clear();
}
