import { ZodError } from "zod";
import { ConfigurationError, GenerationError, PlanValidationError, UpstreamError } from "../errors.js";

export interface ToolErrorResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError: true;
}

/**
 * Map service failures to MCP tool errors, preserving the Python app's
 * operator-relevant distinctions (spec §4.1/§4.4/§8.1): misconfiguration vs.
 * generation failure vs. upstream (502-class) failure vs. invalid input.
 */
export function toToolError(err: unknown): ToolErrorResult {
  let text: string;
  if (err instanceof ConfigurationError) {
    text = `Configuration Error: ${err.message}`;
  } else if (err instanceof PlanValidationError) {
    text = `Validation Error: ${err.message}`;
  } else if (err instanceof ZodError) {
    text = `Validation Error: ${err.issues.map((issue) => issue.message).join("; ")}`;
  } else if (err instanceof UpstreamError) {
    text = `Upstream Error (bad gateway): ${err.message}`;
  } else if (err instanceof GenerationError) {
    text = `Generation Error: ${err.message}`;
  } else {
    text = `Internal Server Error: ${err instanceof Error ? err.message : String(err)}`;
  }
  return { content: [{ type: "text", text }], isError: true };
}

export function toolJson(payload: unknown): {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
} {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
