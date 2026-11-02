# Keepsong MCP Server

Node.js/TypeScript MCP server exposing the Keepsong four-stage AI music-generation
pipeline (**prompt → plan → render → finetune**), ported from the Python/FastAPI
backend per [_specs/mcp-server-spec.md](_specs/mcp-server-spec.md).

## Tools & resources

Full reference — inputs, outputs, error conventions, and how MCP tools differ
from REST endpoints: [docs/mcp-tools.md](docs/mcp-tools.md).

| MCP name | What it does |
|---|---|
| `generate_music_prompt` | Finetune (sets the sound) + blueprint and delivery presets (+ optional narrative) → polished music prompt, via `@openai/agents` (gpt-5.6 + web search, structured output) |
| `generate_composition_plan` | Prompt text → section-by-section `music_v2_5` plan (`chunks`) |
| `render_music` | Prompt **or** chunks → actual audio via ElevenLabs; optional `finetune_id`/`finetune_strength`; emits MCP progress notifications when the caller sends a `progressToken` |
| `start_render` | Same inputs as `render_music`, but returns a render id **immediately** and renders in the background — what the Copilot card uses so nobody waits on one long call |
| `get_render_status` | Recover a render by id (`processing` with live progress / `complete` with a signed `audio_url` / `failed`) |
| `list_finetunes` | ElevenLabs finetunes (TTL-cached; client-side `model_id`/completed filtering) |
| `list_renders` | Recent songs with signed audio URLs — lets Copilot find a song by name in a new chat; also backs the card's Versions rail |
| `preview_style` | App-only: an 8-second instrumental taste of one finetune for the card's Style strip, rendered once per style and reused |
| `keepsong://renders/{id}` | Resource: the rendered audio bytes (base64 blob + mimeType); `resources/list` browses recent renders |
| `ui://keepsong/studio.html` | Resource: the **Keepsong Studio** card (MCP Apps) attached to the tools above; built from `widgets/` |

Audio leaves the server via the MCP resource or via short-lived **signed links**
(`GET /media/renders/{id}?exp=&sig=`, one hour, minted only by the server) that the
Copilot card's player can play. Non-MCP routes: `GET /health` (unauthenticated) and
`GET /media/...` (signature-authenticated).

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
- **Transport**: stateless Streamable HTTP — every `POST /mcp` gets its own
  transport and server, so there are no session ids and any replica can serve any
  request. Progress notifications still stream on the POST's SSE response.
- **Auth**: Entra ID bearer-JWT validation (`jose`, tenant JWKS) in front of the
  transport, built for Microsoft 365 Copilot's Entra SSO: v1 and v2 issuers,
  several audiences (incl. the Teams-generated `api://auth-…` URI), a required
  delegated scope (`access_as_user`), and CORS for the MCP Apps widget host.
  Defaults on when `ENVIRONMENT=production`; gate with `AUTH_ENABLED`. Uniform
  authorization (any valid tenant user → all tools). Setup:
  [docs/copilot-auth.md](docs/copilot-auth.md).
- **Copilot UI (MCP Apps)**: `widgets/` is a React + Fluent UI v9 app bundled to
  one HTML file (`assets/studio.html`) and served as `ui://keepsong/studio.html`.
  Widget tools point at it via `_meta.ui.resourceUri` and return
  `structuredContent.kind`, which picks the card state. `start_render` runs renders
  in the background (progress kept in memory — single replica) and `audio_url` is a
  signed one-hour link so the card's player can stream. Set `PUBLIC_BASE_URL` to
  the URL Copilot uses (tunnel or Azure) and a `MEDIA_SIGNING_KEY`. Status and
  phases: [docs/checkpoint.md](docs/checkpoint.md).
- The system prompt `prompts/generate_music_prompt.md` is the behavioral spec for
  prompt generation: blueprint and delivery preset mappings, plus how the sound is
  derived from the finetune the server looks up from `finetune_id`.

## Setup (local clone or fork)

Requires Node >= 20.

```bash
git clone https://github.com/joelborellis/ElevenLabs-music-mcp.git
cd ElevenLabs-music-mcp
npm install              # also builds dist/ via the prepare script
npm run widgets:install && npm run build:widgets   # Copilot card → assets/studio.html (only needed for Copilot)
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
and requires `ENTRA_TENANT_ID` + `ENTRA_AUDIENCE` (comma-separated list); clients
must then send a user token carrying the `access_as_user` scope, e.g.
`"headers": { "Authorization": "Bearer <token>" }` in the config above. For local
development set `AUTH_ENABLED=false`. `GET /health` is always unauthenticated.
To connect a Microsoft 365 Copilot agent (Entra SSO), follow
[docs/copilot-auth.md](docs/copilot-auth.md).

## Tests

```bash
npm test                 # offline suite (no network, no credits)
npm run smoke:plan       # live ElevenLabs plan call (free)
npm run smoke:prompt     # live OpenAI agent run (FINETUNE_ID=<id>, else first completed finetune)
npm run smoke:compose-finetune   # live render incl. finetune pass-through — COSTS CREDITS
npx tsx test/smoke/smoke-mcp-e2e.ts  # full pipeline against a running server — COSTS CREDITS
npx tsx scripts/inspect-db.ts        # read-only look at the configured Postgres
```

### Auth tests with MCP Inspector

Checks the Entra ID auth end to end on your machine, with the Azure CLI standing
in for Copilot's token store. Run these before connecting a Copilot agent: the
server applies exactly the same checks to Copilot's tokens.

**Prerequisites** — an Entra app registration with the `access_as_user` scope and
the Azure CLI (`04b07795-8ddb-461a-bbee-02f9e1bf7b46`) as an authorized client
application (see [docs/copilot-auth.md](docs/copilot-auth.md), step 2), and in `.env`:

```bash
AUTH_ENABLED=true
ENTRA_TENANT_ID=<tenant-id>
ENTRA_AUDIENCE=<client-id>,api://<client-id>
```

Restart `npm run dev`; the startup line should show
`auth: Entra ID, 2 audience(s), scope: access_as_user`.

**Get a token** (valid for about an hour):

```bash
az login --tenant <tenant-id>
az account get-access-token --scope api://<client-id>/access_as_user --query accessToken -o tsv
```

**Connect** — `npx @modelcontextprotocol/inspector`, transport *Streamable HTTP*,
URL `http://localhost:3000/mcp`. In the server's settings add a **custom header**
`Authorization` = `Bearer <token>`. Leave *OAuth Settings* empty: this server only
validates tokens, it doesn't run a sign-in flow.

| # | Test | Expected |
|---|---|---|
| 1 | Connect **without** the header | Fails: `POST /mcp` → **401**. Inspector then tries OAuth discovery and Dynamic Client Registration (`/.well-known/…`, `/register`) and gets 404s — expected, ignore them |
| 2 | Add the header and connect | Connects; `POST /mcp` → **200**, no `.well-known` requests |
| 3 | Run `list_finetunes` (optionally a short `render_music`) | Returns results; render progress still streams |
| 4 | Change one character of the token | **401** `invalid_token` |
| 5 | Remove the token's audience from `ENTRA_AUDIENCE`, restart | **401** `unexpected "aud" claim value` — the error you'll see if Copilot's Teams-generated URI is ever missing. Restore it afterwards |
| 6 | Wait for the token to expire (~1 h) | **401** `"exp" claim timestamp check failed` — get a new token |

Every 401/403 states its reason in the response's `error.message` and in the
server log. Without Inspector, the same check works with curl:

```bash
curl -i -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

or run the full pipeline with auth on: `MCP_TOKEN=<token> npx tsx test/smoke/smoke-mcp-e2e.ts`
(costs credits).

Migrations: `npm run db:generate:sqlite` / `db:generate:pg` after editing
`src/db/schema.*.ts` (keep both dialects mirrored — a unit test enforces it).
The initial pg migration is idempotent and **adopts** a pre-existing Python-era
`renders` table (adds `error`/`finetune_id`/`finetune_strength`, relaxes
`blob_key`/`filename` nullability).
