import type { RenderProgressInfo } from "../models/render.js";

/**
 * In-memory progress for renders started with start_render. The durable
 * status (processing / complete / failed) lives in the renders row; this map
 * only adds the live stage + percent while ElevenLabs is working, so the
 * studio card can show "performing… 45%" instead of a bare spinner.
 *
 * Single-process by design (fine for the dev tunnel). For multi-replica Azure
 * hosting, persist the stage on the row instead — see docs/checkpoint.md.
 */
const jobs = new Map<string, RenderProgressInfo>();

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

/** Test seam. */
export function clearAllJobs(): void {
  jobs.clear();
}
