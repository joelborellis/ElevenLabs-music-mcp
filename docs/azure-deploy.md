# Deploying keepsong-mcp to Azure Container Apps

The production server runs as the Container App **`keepsong-mcp`** in resource group
`ElevenLabsMusic` (environment `elevenlabs-env`, South Central US), next to the older Python API.
The dev setup (laptop + dev tunnel, `docs/copilot-auth.md`) keeps working alongside it: the
Copilot agent has a **dev** environment pointing at the tunnel and a **prod** environment pointing
at Azure.

```
Copilot prod agent ──► https://keepsong-mcp.politerock-e572f8fa.southcentralus.azurecontainerapps.io/mcp
                             keepsong-mcp (1 replica, 0.5 vCPU / 1 GiB, port 3000, managed identity)
                             ├─► Postgres mcp-registry-postgres        (DATABASE_URL secret)
                             ├─► Blob gtlopenaidemostorage / music     (Storage Blob Data Contributor)
                             └─► OpenAI, ElevenLabs                   (key secrets)
Copilot dev agent  ──► https://keepsong-3000.use2.devtunnels.ms/mcp  (your laptop)
```

Everything is driven by three PowerShell scripts in `deploy/`; resource names live in
`deploy/config.ps1`. Images are built **in the cloud** by `az acr build`, so no local Docker.
The scripts export the repo's tracked files to a temp folder and build from there: `az acr build`
walks the whole tree before honouring `.dockerignore`, and `node_modules` on Windows contains
paths longer than MAX_PATH, which breaks the upload if you build from the repo root. They also set
`PYTHONUTF8=1`: the Windows Azure CLI otherwise crashes on Vite's `✓ built` log line while streaming
the build (the build itself continues in ACR; `az acr task list-runs -r gtlcr` shows its status).
The image is Node 24, matching the laptop toolchain whose npm wrote the lockfiles.

## Prerequisites

- Azure CLI, logged in with an account that can create resources in `ElevenLabsMusic` and assign
  roles on `gtlcr` and `gtlopenaidemostorage` (`az login`).
- The repo committed: the image is tagged with the git SHA.
- The Postgres server `mcp-registry-postgres` already holds the migrated `renders` table (this
  server has been using it from the laptop). If a future change touches `src/db/schema.*.ts`,
  run `npm run db:init` from the laptop against the production `DATABASE_URL` **before**
  deploying — migrations never run at container start.

## 1. First run (once)

```powershell
pwsh deploy/first-run.ps1
```

It builds the image, creates the app with a system-assigned identity, grants that identity
**AcrPull** on the registry and **Storage Blob Data Contributor** on the storage account, switches
image pulls to the identity, prompts for the three secrets (`OPENAI_API_KEY`, `ELEVENLABS_API_KEY`,
`DATABASE_URL`), generates `MEDIA_SIGNING_KEY`, and sets the environment variables. It ends by
printing the MCP URL.

Check it:

```powershell
$fqdn = az containerapp show -g ElevenLabsMusic -n keepsong-mcp --query properties.configuration.ingress.fqdn -o tsv
curl "https://$fqdn/health"                       # {"status":"ok",...}
az containerapp logs show -g ElevenLabsMusic -n keepsong-mcp --tail 20
#   … listening on http://localhost:3000/mcp (auth: Entra ID, 2 audience(s), …, public URL: https://keepsong-mcp…)
```

Test with a token before involving Copilot (same as the README's Inspector section, with the
Azure URL): `az account get-access-token --scope api://6b5abbe7-25c7-414c-bcbd-1b8e4257c246/access_as_user`
→ paste as the `Authorization: Bearer` header in MCP Inspector → `list_finetunes`, then
`get_render_status` on an existing render id. Its `audio_url` is on the Azure host; opening it in a
browser proves blob access through the managed identity and the signed-link route.

## 2. Every deploy

```powershell
pwsh deploy/deploy.ps1            # commit first; tags the image with the git SHA
pwsh deploy/deploy.ps1 -Force     # ship an uncommitted tree (tag gets a -dirty suffix)
```

Builds, updates the app, waits for the new revision to be healthy, and prints a rollback command
(`az containerapp revision activate … ; az containerapp ingress traffic set …`). Widget changes are
part of the image (`build:widgets` runs in the Dockerfile), so they also ship this way.

## 3. Copilot: the prod agent

In the agent project (`keepsong-copilot`) the MCP URL is the `MCP_SERVER_URL` variable in
`env/.env.dev` (tunnel) and `env/.env.prod` (Azure); `m365agents.yml` and `ai-plugin.json` read it.

1. Agents Toolkit → **Lifecycle → Provision** with environment **prod**. This creates a second Teams
   app (`keepsong-copilotprod`) and a second Entra SSO auth config whose id lands in `env/.env.prod`.
2. Teams developer portal → **Microsoft Entra SSO client ID registration** → the new (prod)
   registration → copy its **Application ID URI** (`api://auth-<uuid>/6b5abbe7-…`).
3. Entra admin center → app `keepsong-mcp` → **Manifest** (Microsoft Graph tab) → append that URI to
   `identifierUris` (keep the existing two) → Save.
4. Generate the widget host for the Azure URL at https://aka.ms/mcpwidgeturlgenerator.
5. Tell the server about both:

   ```powershell
   pwsh deploy/set-auth.ps1 -AudienceUri "api://auth-<uuid>/6b5abbe7-25c7-414c-bcbd-1b8e4257c246" -WidgetHost "https://<hash>.widget-renderer.usercontent.microsoft"
   ```

   (It appends to `ENTRA_AUDIENCE` and `CORS_ALLOWED_ORIGINS`; if the generator and the docs disagree
   on `.microsoft` vs `.microsoft.com`, run it twice with both hosts, as was done for dev.)
6. In https://m365.cloud.microsoft/chat pick **keepsong-copilotprod** and run the golden path with
   the laptop's server stopped: brief → Compose → player; hear a style taste.

Switching back to dev for widget work: start `npm run dev` + `devtunnel host keepsong` and use the
**dev** agent. The two agents, auth configs and server settings are independent.

## Operations

- **Logs:** `az containerapp logs show -g ElevenLabsMusic -n keepsong-mcp --follow`
  (401/403 lines carry the reason, as locally).
- **Secrets:** `az containerapp secret set -g ElevenLabsMusic -n keepsong-mcp --secrets openai-key=…`
  then `az containerapp update … --set-env-vars OPENAI_API_KEY=secretref:openai-key` (already wired;
  setting the secret again is enough, followed by a restart revision).
- **Env vars:** `az containerapp update -g ElevenLabsMusic -n keepsong-mcp --set-env-vars NAME=value`.
- **Rollback:** printed by `deploy.ps1`; or `az containerapp revision list` to pick one.
- **Cost:** one always-on 0.5 vCPU / 1 GiB replica on the Consumption plan, plus ACR Standard
  (already there) and the existing storage/Postgres.

## Constraints to know

- **Single replica, by design.** Live render progress and the brief shown on the card are held in
  process memory (`src/services/renderJobs.ts`). `max-replicas` is 1; raising it needs those two
  maps persisted on the `renders` row first (one migration + two small code changes).
- **Ingress timeout (~240 s).** The Copilot path uses `start_render`, which returns at once, so it
  is unaffected. The blocking `render_music` can be cut off on long renders from other MCP
  clients; its description already tells them to poll `get_render_status`.
- **Restart = new signing key? No.** `MEDIA_SIGNING_KEY` is a stored secret, so signed audio links
  survive restarts and redeploys (they still expire after one hour).
- **The finetunes cache and the composition-plan cache are per process**; a redeploy just means one
  extra upstream call.
