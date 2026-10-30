# Keepsong MCP Server

Node.js/TypeScript MCP server exposing the Keepsong four-stage AI music-generation
pipeline (**prompt → plan → render → finetune**), ported from the Python/FastAPI
backend per [_specs/mcp-server-spec.md](_specs/mcp-server-spec.md).

## Tools & resources

Full reference — inputs, outputs, error conventions, and how MCP tools differ
from REST endpoints: [docs/mcp-tools.md](docs/mcp-tools.md).

| MCP name | What it does |
|---|---|
| `generate_music_prompt` | Preset trio (+ optional narrative) → polished music prompt, via `@openai/agents` (gpt-5.6 + web search, structured output) |
| `generate_composition_plan` | Prompt text → section-by-section `music_v2_5` plan (`chunks`) |
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

## Setup (local clone or fork)

Requires Node >= 20.

```bash
git clone https://github.com/joelborellis/ElevenLabs-music-mcp.git
cd ElevenLabs-music-mcp
npm install              # also builds dist/ via the prepare script
cp .env.example .env     # fill in keys; see .env.example for every variable
npm run db:init          # Postgres only — applies migrations out-of-band (NEVER at container startup)
```

`.env.example` documents every supported variable with its default; `.env` only
needs what differs. Minimum to function: `OPENAI_API_KEY` (checked at startup)
and `ELEVENLABS_API_KEY` (checked on first use). With the dev defaults
(`STORAGE_BACKEND=local`, SQLite `DATABASE_URL`, `ENVIRONMENT=development`) the
database is auto-created at startup, so `db:init` is only needed for Postgres.

## Run (dev / manual)

```bash
npm run dev              # Streamable HTTP on :3000/mcp
npm run dev:stdio        # stdio transport for manual testing / MCP Inspector
npm run build && npm start
```

## Connect an MCP client

Three ways to wire the server into an MCP client (Claude Code, Cursor, Windsurf,
…). All samples use the common `mcpServers` JSON shape — in Claude Code that's
`.mcp.json` at your project root (or `claude mcp add`).

**How configuration reaches the server:** the process loads `.env` from its
*current working directory* (dotenv), and a client-spawned server inherits the
client's cwd — usually **not** this repo. So for the stdio options either set
`DOTENV_CONFIG_PATH` to the absolute path of a `.env` file, or put the variables
inline in the `env` block. Prefer absolute paths for `DATABASE_URL` /
`LOCAL_STORAGE_DIR` for the same reason.

**Windows note:** in all samples, `command` must be a real executable. `node`
works as-is; `npm`/`npx` are `.cmd` shims and must be wrapped:
`"command": "cmd", "args": ["/c", "npx", ...]`. Forward slashes are fine in
JSON paths on Windows.

### 1. stdio — local clone (client starts the server)

Nothing to start manually: the client spawns the process per session and speaks
MCP over stdin/stdout. Auth never applies to stdio. Build first
(`npm run build`), then:

```json
{
  "mcpServers": {
    "keepsong": {
      "command": "node",
      "args": ["<path-to-repo>/dist/index.js", "--stdio"],
      "env": {
        "DOTENV_CONFIG_PATH": "<path-to-repo>/.env"
      }
    }
  }
}
```

Rebuild after code changes — or run straight from source (no build step) by
swapping the `args`:

```json
"args": [
  "<path-to-repo>/node_modules/tsx/dist/cli.mjs",
  "<path-to-repo>/src/index.ts",
  "--stdio"
]
```

Claude Code one-liner:
`claude mcp add --scope user --env DOTENV_CONFIG_PATH=<path-to-repo>/.env keepsong -- node <path-to-repo>/dist/index.js --stdio`

### 2. stdio — straight from the GitHub repo (no clone)

`npx` clones, installs, builds (via the `prepare` script), and runs the
package's `bin` — the client still spawns everything:

```json
{
  "mcpServers": {
    "keepsong": {
      "command": "npx",
      "args": ["-y", "github:joelborellis/ElevenLabs-music-mcp", "--stdio"],
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "ELEVENLABS_API_KEY": "...",
        "STORAGE_BACKEND": "local",
        "LOCAL_STORAGE_DIR": "<abs-path>/keepsong/music",
        "DATABASE_URL": "<abs-path>/keepsong/renders.db"
      }
    }
  }
}
```

(Windows: `"command": "cmd", "args": ["/c", "npx", "-y", "github:...", "--stdio"]`.)

- There is no checkout and no `.env`, so configuration must come from the `env`
  block — or point `DOTENV_CONFIG_PATH` at a `.env` you keep anywhere on disk.
- While the repo is private, the machine's git credentials must have access.
- **Prime the cache once** from a terminal — the first run clones, installs
  (native `better-sqlite3` build included), and compiles, which can exceed an
  MCP client's startup timeout:
  `npx -y github:joelborellis/ElevenLabs-music-mcp --stdio`, wait for
  `keepsong-mcp running on stdio` on stderr, then Ctrl+C.
- The bare spec tracks `main` — every push makes the next start reinstall.
  Pin a tag or commit for reproducible, always-fast starts:
  `github:joelborellis/ElevenLabs-music-mcp#<tag-or-sha>`.

### 3. Streamable HTTP (you run the server; client connects to a URL)

Start the server yourself — locally or deployed — then point the client at it:

```bash
npm run build && npm start    # serves :3000/mcp (override with MCP_PORT / MCP_PATH)
```

```json
{
  "mcpServers": {
    "keepsong": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Claude Code one-liner:
`claude mcp add --transport http keepsong http://localhost:3000/mcp`

**Auth:** with `ENVIRONMENT=production`, Entra ID bearer auth defaults **on**
and requires `ENTRA_TENANT_ID` + `ENTRA_AUDIENCE`; clients must then send a
tenant JWT, e.g. `"headers": { "Authorization": "Bearer <token>" }` in the
config above. For local development set `AUTH_ENABLED=false`. `GET /health` is
always unauthenticated.

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
