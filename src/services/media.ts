import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config.js";

/**
 * Short-lived signed URLs for rendered audio. Copilot widgets run in a
 * sandboxed iframe that cannot attach the user's bearer token to an <audio>
 * element, and cannot read the keepsong:// MCP resource at all — so the only
 * way to play a song in the card is a plain HTTPS URL. The signature (HMAC over
 * `${id}.${exp}`) keeps the route from being a public download endpoint: a URL
 * is only mintable by this server, for one render, for one hour.
 */
export const DEFAULT_TTL_SECONDS = 3600;

// Dev fallback: links are valid for this process only (a restart invalidates them).
const ephemeralKey = randomBytes(32).toString("hex");

function keyFor(config: AppConfig): string {
  return config.mediaSigningKey || ephemeralKey;
}

function digest(key: string, id: string, exp: number): string {
  return createHmac("sha256", key).update(`${id}.${exp}`).digest("hex");
}

export function signRenderUrl(
  config: AppConfig,
  id: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = digest(keyFor(config), id, exp);
  return `${config.publicBaseUrl}/media/renders/${encodeURIComponent(id)}?exp=${exp}&sig=${sig}`;
}

/** Constant-time check of `sig` against `id` + `exp`; false for expired or malformed input. */
export function verifyRenderSignature(
  config: AppConfig,
  id: string,
  exp: string | undefined,
  sig: string | undefined,
): boolean {
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(digest(keyFor(config), id, Number(exp)), "hex");
  const given = Buffer.from(sig, "hex");
  return given.length > 0 && given.length === expected.length && timingSafeEqual(expected, given);
}
