import path from "node:path";
import { fileURLToPath } from "node:url";

// Root of the installed package (the directory holding package.json), resolved
// from this module's own location — NOT process.cwd(). MCP clients spawn the
// server with *their* cwd, so bundled resources (prompts/, drizzle/) must be
// found relative to the code. Works from both src/ (tsx) and dist/ (build),
// which sit one level below the root.
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
