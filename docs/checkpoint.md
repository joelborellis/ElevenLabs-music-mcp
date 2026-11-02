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

## UI: Keepsong Studio (in progress)

Design (decided 2026-11-01): **one evolving "studio card"** (MCP Apps standard, React + Fluent UI v9)
that moves through Brief → Style strip → Composing → Listen → Versions, built for an internal demo.
Full design and phases: the plan in `C:\Users\Joel(gametolearn)\.claude\plans\i-shifted-to-plan-wise-thimble.md`
(copy it into docs/ if it should live with the repo).

**Phase 0 — foundations: done.**
- `widgets/` workspace builds `assets/studio.html` (`npm run widgets:install`, `npm run build:widgets`).
  The server serves it as `ui://keepsong/studio.html` with CSP for `PUBLIC_BASE_URL`, and lets Copilot
  read that one resource without a token.
- Widget tools carry `_meta.ui.resourceUri`; results include `structuredContent.kind`
  (brief / styles / plan / composing / song / failed / versions).
- `start_render` (async, returns the id at once) + in-memory progress; `get_render_status` reports it.
- Signed audio links: `GET /media/renders/{id}?exp=&sig=` (1 h, `MEDIA_SIGNING_KEY`), `audio_url` on results.
- `list_renders` (app-only) for the Versions rail.
- Agent instructions + conversation starters rewritten in `keepsong-copilot` (re-provision after edits).
- The card itself is still the Phase 0 "hello card": a readable summary per state plus an `<audio>`
  player, and it polls `get_render_status` every 3 s while composing.
- **Verified in Copilot on 2026-11-02:** "Make a 30-second upbeat teaser" → brief → one Confirm
  (only credit-spending tools prompt; the rest are `readOnlyHint: true`) → composing with live
  percentage → player, and the audio played from the tunnel via the signed link.

**Phase 1 — Listen state: done, verified in Copilot 2026-11-02.** `widgets/src/components/Player.tsx`:
section timeline as scrub bar (`lib/sections.ts` parses `[Label] lyrics` chunks), current-section
sound tags, lyrics panel with the active section highlighted, Download (`&download=1` → attachment),
Copy link, full-screen toggle. `list_renders` is model-visible so Copilot can find a song by name in a
new chat (`list_renders` → `get_render_status`). Known gap: the style badge only shows when the
finetune is in the server's in-memory cache (i.e. after `list_finetunes` ran since the last restart).

**Phase 2 — Brief + Composing: done, verified in Copilot 2026-11-02** (attached a PowerPoint launch
deck → brief with "For: Sprout launch, April 15, 2027"; Use/Vocals chips rewrite the brief in place;
the "More playful" nudge posts via `sendMessage` and Copilot rewrites; Copilot chains straight to the
song unless told to stop — the agent instructions now say to stop after the brief).
`components/Brief.tsx` (title / description / "For:" line, Use + Vocals flip-chips that re-run
`generate_music_prompt` from the card, direction preview, **Compose** → `start_render` from the card,
nudge chips → `sendMessage`), `components/Composing.tsx` (section timeline from
`generate_composition_plan` filling with progress, stage words, direction lines), a Failed state with
Try again. Server: the prompt agent now returns `about` (system prompt has a 4th output field);
`start_render` accepts local-only `description`/`about`, kept in memory (`renderJobs.ts` briefs) and
returned by `get_render_status`. Agent instructions: digest guidance for long documents.

**Phase 3 — Style strip + taste tests: built 2026-11-02, awaiting verification in Copilot.**
`components/StyleStrip.tsx`: one mood card per finetune (hue from genre family, `lib/styleColor.ts`),
**Hear a taste** → `preview_style` (app-only; 8-second instrumental, title `preview:<id>`, rendered once
per style then reused), **Use this**, **Surprise me**, live meter while playing. The Brief's Style chip
opens the strip inline and a pick re-runs the brief; the standalone strip (from `list_finetunes`)
sends `Use the "X" style for the song.` back to Copilot. Style badges now resolve even after a restart
(the server warms the finetunes cache on demand). Agent instructions: browse styles → stop after
`list_finetunes`; treat the "Use the … style" message as the pick.

**Next phase:** 4 Variations / Versions rail / fullscreen polish and agent polish.

**Before testing the card in Copilot:** set `PUBLIC_BASE_URL=https://keepsong-3000.use2.devtunnels.ms`
and a `MEDIA_SIGNING_KEY` in `.env`, run `npm run build:widgets`, restart the server, and provision
the agent again. Then check the server log: only `resources/read ui://…` should arrive without a token.

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
