# Keepsong MCP Server

Node.js/TypeScript MCP server exposing the Keepsong four-stage AI music-generation
pipeline (**prompt → plan → render → finetune**), ported from the Python/FastAPI
backend per [_specs/mcp-server-spec.md](_specs/mcp-server-spec.md).

## Tools & resources

Full reference — inputs, outputs, error conventions, and how MCP tools differ
from REST endpoints: [docs/mcp-tools.md](docs/mcp-tools.md).

| MCP name | What it does |
|---|---|
| `generate_music_prompt` | Preset trio (+ optional narrative) → polished `music_v2` prompt, via `@openai/agents` (gpt-5.6 + web search, structured output) |
| `generate_composition_plan` | Prompt text → section-by-section `music_v2` plan (`chunks`) |
| `render_music` | Prompt **or** chunks → actual audio via ElevenLabs; optional `finetune_id`/`finetune_strength`; emits MCP progress notifications when the caller sends a `progressToken` |
| `get_render_status` | Recover a render by id after a timeout/disconnect (`processing` / `complete` / `failed`) |
| `list_finetunes` | ElevenLabs finetunes (TTL-cached; client-side `model_id`/completed filtering) |
| `keepsong://renders/{id}` | Resource: the rendered audio bytes (base64 blob + mimeType); `resources/list` browses recent renders |

Audio bytes leave the server **only** via the MCP resource — there are no HTTP
download/stream routes. The only non-MCP route is an unauthenticated `GET /health`.

## Architecture notes

- **Render durability**: the `renders` row is written with `status: "processing"`
  *before* calling ElevenLabs, then updated to `complete`/`failed` — that is what
  makes `get_render_status` recovery work.
- **`compose_detailed` uses raw HTTP** (`src/services/elevenlabs.ts`), not the JS
  SDK wrapper: the wrapper cannot send `finetune_strength` at all and returns the
  multipart response unparsed. Wire names confirmed live: `sign_with_c2pa`,
  `finetune_id`, `finetune_strength`; response JSON keys are snake_case
  (`composition_plan`, `song_metadata`, `words_timestamps`).
- **Storage**: `local` (dev, file://) or `azure` (Blob; connection string takes
  precedence, else managed identity). Metadata: SQLite (dev) or Postgres (prod,
  always TLS). Python-style `DATABASE_URL`s (`postgresql+asyncpg://...?ssl=require`)
  are normalized automatically.
- **Auth**: Entra ID bearer-JWT validation (`jose`, tenant JWKS, iss/aud/exp) in
  front of the Streamable HTTP transport. Defaults on when `ENVIRONMENT=production`;
  gate with `AUTH_ENABLED`. Uniform authorization (any valid tenant token → all tools).
- The system prompt `prompts/generate_music_prompt.md` is a **verbatim** copy from
  the Python app — do not paraphrase it; it is the behavioral spec for all presets.

## Setup

```bash
npm install
cp .env.example .env     # fill in keys; see .env.example for every variable
npm run db:init          # apply migrations (out-of-band; NEVER at container startup)
```

## Run

```bash
npm run dev              # Streamable HTTP on :3000/mcp
npm run dev:stdio        # stdio transport for local MCP clients / Inspector
npm run build && npm start
```

## Tests

```bash
npm test                 # offline suite (no network, no credits)
npm run smoke:plan       # live ElevenLabs plan call (free)
npm run smoke:prompt     # live OpenAI agent run
npm run smoke:compose-finetune   # live render incl. finetune pass-through — COSTS CREDITS
npx tsx test/smoke/smoke-mcp-e2e.ts  # full pipeline against a running server — COSTS CREDITS
npx tsx scripts/inspect-db.ts        # read-only look at the configured Postgres
```

Migrations: `npm run db:generate:sqlite` / `db:generate:pg` after editing
`src/db/schema.*.ts` (keep both dialects mirrored — a unit test enforces it).
The initial pg migration is idempotent and **adopts** a pre-existing Python-era
`renders` table (adds `error`/`finetune_id`/`finetune_strength`, relaxes
`blob_key`/`filename` nullability).
