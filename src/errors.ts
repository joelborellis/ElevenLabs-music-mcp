export { ConfigurationError } from "./config.js";

/** Equivalent of the Python services' RuntimeError wrapping (plan/prompt/render). */
export class GenerationError extends Error {}

/**
 * Upstream ElevenLabs failure surfaced by list_finetunes — the one place the
 * Python app maps to 502 Bad Gateway instead of 500 (spec §4.4). Preserved as
 * a distinct class so the tool's error text can keep the distinction.
 */
export class UpstreamError extends Error {}

/** Invalid composition plan (the render stage's only expected/typed error). */
export class PlanValidationError extends Error {}

/** Caller-supplied input that parses but refers to something unusable (e.g. an unknown finetune). */
export class InvalidInputError extends Error {}
