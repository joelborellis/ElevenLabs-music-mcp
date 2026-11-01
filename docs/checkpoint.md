# Checkpoint — Keepsong MCP + Microsoft 365 Copilot agent

**As of 2026-11-01.** Start here when picking the work back up.

## Where things stand

The MCP server is connected to a Microsoft 365 Copilot declarative agent with **Entra SSO**, and it
works end to end: asked "What music finetunes do we have?", Copilot signed the user in, called
`list_finetunes` with a user token, and showed the results. **The UI widgets have not been started.**

```
Copilot chat ──► Enterprise token store ──► Entra ID (user token, scope access_as_user)
     │
     ▼  POST https://keepsong-3000.use2.devtunnels.ms/mcp   (dev tunnel → localhost:3000)
keepsong-mcp (this repo): token checks → tools → ElevenLabs / OpenAI
```

## The two projects

| | This repo — `ElevenLabs-music-mcp` | Agent — `C:\Projects\ElevenLabs\keepsong-copilot` |
|---|---|---|
| What it is | The MCP server: tools, resources, auth, and (later) the UI widgets | The declarative agent package created by Microsoft 365 Agents Toolkit |
| Git | Committed and pushed | Local repo, one commit ("Intial commit") |
| Key files | `src/`, `prompts/generate_music_prompt.md`, `.env`, [docs/copilot-auth.md](copilot-auth.md) | `appPackage/ai-plugin.json`, `appPackage/declarativeAgent.json`, `appPackage/instruction.txt`, `m365agents.yml`, `env/.env.dev` |
| Runs where | Your machine (`npm run dev`), exposed through the dev tunnel | Provisioned to your Microsoft 365 tenant as **keepsong-copilot dev** |

### This repo (MCP server)

**Tools:** `list_finetunes` → `generate_music_prompt` → `generate_composition_plan` →
`render_music` → `get_render_status`, plus the `keepsong://renders/{id}` audio resource. Full
reference: [docs/mcp-tools.md](mcp-tools.md).

**Recent work, all committed:**
- **Finetunes drive the sound.** `generate_music_prompt` takes a `finetune_id` (not the old
  `sound_profile` presets). The server looks up the finetune and passes its name, genre and tags to
  the prompt agent. The project blueprint sets the form, delivery & control sets how prescriptive
  the prompt is, and the system prompt's rule 6 adapts both to the finetune's genre (including
  lyric language). Pass the same `finetune_id` to `render_music`.
- **Auth that works with Copilot's Entra SSO.**
  - Accepts several audiences (`ENTRA_AUDIENCE` is a comma-separated list) and both v1 and v2 tokens.
  - Requires the delegated scope `access_as_user`.
  - Allows the MCP Apps widget host through CORS.
- **Stateless transport:** every `POST /mcp` is handled on its own, with no session IDs, following
  Microsoft's sample. `GET` and `DELETE /mcp` return 405.
- **Docs:** [docs/copilot-auth.md](copilot-auth.md) (full setup runbook) and the README section
  "Auth tests with MCP Inspector".

### Agent project (keepsong-copilot)

- Created with Agents Toolkit: **Declarative Agent → Start with an MCP Server → Entra SSO**.
- `ai-plugin.json`: a `RemoteMCPServer` at `https://keepsong-3000.use2.devtunnels.ms/mcp`, with
  auth `OAuthPluginVault` and `reference_id: ${{MCP_DA_AUTH_ID_KEEPSONG30}}`. The real auth config
  ID was filled into `env/.env.dev` by **Provision**.
- Provisioned to the **dev** environment. The agent's instructions are still the generated
  defaults, and nothing has been customized yet.

## Configuration and where it lives

| Piece | Value / location |
|---|---|
| Entra app registration | `keepsong-mcp`, single tenant, client ID `6b5abbe7-25c7-414c-bcbd-1b8e4257c246`. Exposes the scope `access_as_user`; pre-authorized clients are the token store `ab3be6b7-f5df-413d-ac2d-abf1e3fd9c0b` and the Azure CLI `04b07795-8ddb-461a-bbee-02f9e1bf7b46`. Web redirect `https://teams.microsoft.com/api/platform/v1.0/oAuthConsentRedirect`. Manifest: `requestedAccessTokenVersion: 2` |
| `identifierUris` on the Entra app | `api://<client-id>` and the Teams-generated `api://auth-<uuid>/<client-id>` |
| SSO auth config | Teams developer portal → Tools → Microsoft Entra SSO client ID registration (created by the toolkit). Its ID is `MCP_DA_AUTH_ID_KEEPSONG30` in the agent's `env/.env.dev` |
| Server auth settings | This repo's `.env`: `AUTH_ENABLED=true`, `ENTRA_TENANT_ID`, `ENTRA_AUDIENCE` (3 entries: client ID, `api://<client-id>`, the `api://auth-…` URI), `ENTRA_REQUIRED_SCOPE` blank (= `access_as_user`) |
| CORS | `CORS_ALLOWED_ORIGINS` holds the widget host **twice**, ending in `.usercontent.microsoft` (what Microsoft's generator returned) and in `.usercontent.microsoft.com` (what the docs say). Remove the wrong one once a real widget shows its `Origin` header |
| Dev tunnel | Persistent tunnel `keepsong.use2`, port 3000, anonymous connect (the server does the auth). Expires after 30 days unused; hosting it resets the timer |

## How to bring everything back up

1. In this repo: `npm run dev`. Check that the startup line shows
   `auth: Entra ID, 3 audience(s), scope: access_as_user, CORS origins: 2`.
2. In a second terminal: `devtunnel host keepsong`. Check that
   `https://keepsong-3000.use2.devtunnels.ms/health` loads.
3. Open [m365.cloud.microsoft/chat](https://m365.cloud.microsoft/chat) → **keepsong-copilot dev** →
   ask "What music finetunes do we have?".

Test without Copilot: see "Auth tests with MCP Inspector" in the [README](../README.md) (get a token with
`az account get-access-token --scope api://<client-id>/access_as_user`).

**If something breaks:** a 401 or 403 in the `npm run dev` log states its reason; see the
troubleshooting table in [docs/copilot-auth.md](copilot-auth.md). If Copilot can't reach the server,
the tunnel probably isn't being hosted, or the tunnel expired. If you have to create a new tunnel,
the URL changes and you must update the agent's `ai-plugin.json`, the SSO registration's Base URL,
and the widget host, then provision again.

## Next: UI widgets (not started)

The widgets are served by **this server** as `ui://` resources and linked from tools with
`_meta.ui.resourceUri` (MCP Apps) or `openai/outputTemplate` (OpenAI Apps SDK). The agent project
barely changes. Decisions to make before planning:

1. **Which widgets first.** Candidates:
   - a **song player** on `render_music` / `get_render_status` (title, sections, progress while rendering, audio playback)
   - a **finetune picker** on `list_finetunes`
   - a **prompt/plan viewer** with a "Render this" button
2. **How the player gets audio.** Widgets can't read `keepsong://renders/{id}`. Options: a short-lived
   **signed URL route** on this server (works with local and Azure storage), or an **Azure Blob SAS
   URL** (Azure storage only). Either changes the repo's current "no HTTP download routes" rule.
3. **Widget stack.** React + Fluent UI v9 (like Microsoft's samples), or plain HTML/JS.
4. **Widget standard.** MCP Apps (open standard) or OpenAI Apps SDK. Copilot supports both, with gaps:
   see the capability tables on Microsoft's [MCP apps page](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-mcp-apps).
5. **Template access.** Copilot loads widget templates without a user token. Microsoft's sample lets
   `resources/list` and `resources/read` through without auth for `ui://` URIs only. The audio
   resources and tools must stay protected.

Other open items:
- Customize the agent's instructions (`instruction.txt`) and conversation starters, e.g. teach it
  the `list_finetunes` → `generate_music_prompt` → `render_music` order.
- **Azure deployment (planned for after the widgets work against the tunnel).** No Dockerfile or
  infrastructure exists yet. Needs:
  - a container image and Azure Container Apps
  - Postgres (`npm run db:init` once)
  - Blob storage with managed identity
  - the API keys as secrets
  - `ENVIRONMENT=production`

  The Azure URL needs its **own** SSO auth config, which brings a new `api://auth-…` URI (add it to
  `identifierUris` and `ENTRA_AUDIENCE`) and a new widget host for `CORS_ALLOWED_ORIGINS`. Repeat
  steps 3–7 of [docs/copilot-auth.md](copilot-auth.md). In the agent project, add a second
  environment (`env/.env.prod`) pointing at the Azure URL rather than replacing the dev/tunnel
  setup, and put the MCP URL in an environment variable instead of hard-coding it in `ai-plugin.json`.
- `render_music` can take minutes. Check how Copilot handles long tool calls; the player widget may
  need to poll `get_render_status`.

## References

- [MCP apps in Microsoft 365 Copilot](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-mcp-apps)
- [Microsoft's MCP interactive UI samples](https://github.com/microsoft/mcp-interactiveUI-samples) (the expense-submission sample uses Entra SSO and stateless transport)
- [docs/copilot-auth.md](copilot-auth.md) — auth setup runbook
- [docs/mcp-tools.md](mcp-tools.md) — tool reference
