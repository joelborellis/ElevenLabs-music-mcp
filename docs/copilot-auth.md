# Connecting a Microsoft 365 Copilot agent (Entra SSO)

How to set up this server so a declarative agent in Microsoft 365 Copilot, including one with
[MCP Apps widgets](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-mcp-apps),
can call it with **Microsoft Entra single sign-on**. You do this once per environment (dev tunnel,
production).

## How it works

```
User in Copilot ──► Copilot ──► Enterprise token store ──► Entra ID
                       │        (client ab3be6b7-…)         issues a user token for
                       │                                    api://auth-<uuid>/<client-id>
                       ▼
            POST https://<your-host>/mcp   Authorization: Bearer <user token>
                       │
                       ▼
   keepsong-mcp: verifies signature (tenant JWKS), issuer (v1 or v2), audience
   (ENTRA_AUDIENCE list), expiry, and the access_as_user scope → runs the tool
```

The server only **validates** tokens. It never calls Graph or anything else on the user's behalf,
so it needs **no client secret** and no on-behalf-of flow. The ElevenLabs and OpenAI keys stay
on the server.

Copilot gets the token from an **auth config** in the Microsoft Enterprise token store. When
the auth config is created, the Teams developer portal generates a new **Application ID URI**
(`api://auth-<uuid>/<client-id>`). Copilot asks Entra for a token for that URI, so the URI must be
on your Entra app *and* in this server's `ENTRA_AUDIENCE`. Most setup problems come from a
missing or mistyped URI.

## What you need

- An Entra tenant where you can create app registrations, and a Microsoft 365 tenant with
  **Custom App Upload** and **Copilot Access** enabled
- [Microsoft 365 Agents Toolkit](https://aka.ms/M365AgentsToolkit) 6.12 or later in VS Code
- [Dev tunnels CLI](https://learn.microsoft.com/azure/developer/dev-tunnels/get-started) for local
  development, and [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) for test tokens

## 1. Give the server a stable public URL

The auth config is tied to a **Base URL**, so the URL must not change between runs. Use a
*persistent* dev tunnel, not a temporary one:

```bash
devtunnel user login
devtunnel create keepsong -a          # -a: anonymous tunnel access; the server does the auth
devtunnel port create keepsong -p 3000
devtunnel host keepsong               # prints https://<tunnel-id>-3000.<region>.devtunnels.ms
```

Your MCP URL is that host plus `/mcp`, e.g. `https://<tunnel-id>-3000.<region>.devtunnels.ms/mcp`.
In production, use the Azure Container Apps URL instead and repeat steps 3–7 for it.

## 2. Register the Entra app

In the [Microsoft Entra admin center](https://entra.microsoft.com/) → **App registrations** →
**New registration**:

1. **Name**: e.g. `keepsong-mcp`. **Supported account types**: *Accounts in this organizational
   directory only* (single tenant). Leave the redirect URI empty for now. Register.
   Note the **Application (client) ID** and **Directory (tenant) ID**.
2. **Expose an API** → **Add** next to *Application ID URI* → accept `api://<client-id>`.
3. **Expose an API** → **Add a scope**: name `access_as_user`, *Admins and users* can consent,
   fill in the display names and descriptions, state *Enabled*.
4. **Expose an API** → **Add a client application** for each of these, ticking `access_as_user`:
   - `ab3be6b7-f5df-413d-ac2d-abf1e3fd9c0b`: the Microsoft Enterprise token store (Copilot)
   - `04b07795-8ddb-461a-bbee-02f9e1bf7b46`: Azure CLI (only needed for test tokens in step 8)
5. **Authentication** → **Add a platform** → **Web** → redirect URI
   `https://teams.microsoft.com/api/platform/v1.0/oAuthConsentRedirect`.
6. **Manifest** → **Microsoft Graph App Manifest (New)** tab → inside the `"api"` object set
   `"requestedAccessTokenVersion": 2` and save. (This is the new-format name for the old AAD Graph
   `accessTokenAcceptedVersion`; edit only the new tab, it syncs to the old one. The server accepts
   both v1 and v2 tokens, but v2 makes the `aud` claim the client ID, which is easier to reason about.)

## 3. Scaffold the agent with auth turned off

Agents Toolkit can't use Entra SSO when it fetches your tools during setup. Run the server without
auth **for this step only**:

```bash
AUTH_ENABLED=false npm run dev        # in .env, or inline
```

In VS Code: **Agents Toolkit** → **Create a New Agent/App** → **Declarative Agent** →
**Add an Action** → **Start with an MCP Server**. Then:

- **MCP server URL**: your URL from step 1, including `/mcp`
- **Authentication type**: **Entra SSO**
- **Client ID**: the client ID from step 2

The toolkit creates the auth config in the token store and writes it into the agent's
`appPackage/ai-plugin.json`:

```json
"auth": { "type": "OAuthPluginVault", "reference_id": "<auth config ID>" }
```

## 4. Add the generated Application ID URI

1. Open the [Teams developer portal](https://dev.teams.microsoft.com/tools) → **Tools** →
   **Microsoft Entra SSO client ID registration** → open the registration the toolkit created.
   Check that **Base URL** matches your MCP URL. Copy the **Application ID URI**
   (`api://auth-<uuid>/<client-id>`).
   This is also where you can restrict the registration to your organization or to the published app ID.
2. Back in the Entra admin center → your app → **Manifest** → **Microsoft Graph App Manifest (New)**
   tab. Add the URI to the top-level `identifierUris` alongside the existing one:

   ```json
   "identifierUris": [
     "api://<client-id>",
     "api://auth-<uuid>/<client-id>"
   ]
   ```

   Use the manifest editor: the **Expose an API** page can add only one URI and shows only the
   first one in the list.

## 5. Configure the server

In `.env`:

```bash
AUTH_ENABLED=true
ENTRA_TENANT_ID=<tenant-id>
# v2 tokens use the client ID as aud; v1 tokens use whichever URI was requested — list all three
ENTRA_AUDIENCE=<client-id>,api://<client-id>,api://auth-<uuid>/<client-id>
ENTRA_REQUIRED_SCOPE=            # blank = access_as_user
CORS_ALLOWED_ORIGINS=https://<hash>.widget-renderer.usercontent.microsoft.com
```

Copilot renders MCP Apps widgets on a host derived from your MCP server's domain. Generate it
with the [Widget Host URL Generator](https://aka.ms/mcpwidgeturlgenerator) from your MCP URL.
Every server URL (dev tunnel, production) has a different widget host. You can list several,
comma-separated.

Restart the server. The startup line should read
`auth: Entra ID, 3 audience(s), scope: access_as_user, CORS origins: 1`.

## 6. Provision and try it in Copilot

In Agents Toolkit → **Lifecycle** → **Provision**, then open
[m365.cloud.microsoft/chat](https://m365.cloud.microsoft/chat), select the agent, and ask something
that uses a tool, e.g. *"What music finetunes do we have?"*. The first time, Copilot asks you to
**sign in** / allow the connection. After that, calls succeed without prompting.

## 7. Test without Copilot

Get a user token from the Azure CLI (pre-authorized in step 2.4):

```bash
az login --tenant <tenant-id>
az account get-access-token --scope api://<client-id>/access_as_user --query accessToken -o tsv
```

- **MCP Inspector**: transport *Streamable HTTP*, URL `http://localhost:3000/mcp`, and paste the
  token as the bearer token under **Authentication**. Calls should work; remove the token and you
  get 401.
- **Smoke test**: `MCP_TOKEN=<token> npx tsx test/smoke/smoke-mcp-e2e.ts` (costs ElevenLabs credits).
- **CORS preflight**:
  `curl -i -X OPTIONS -H "Origin: https://<widget-host>" -H "Access-Control-Request-Method: POST" http://localhost:3000/mcp`
  should return 204 with `Access-Control-Allow-Origin`.

## Troubleshooting

The 401/403 responses explain the reason in `error.message`, and the server log shows every failure.

| Symptom | Cause | Fix |
|---|---|---|
| 401 `unexpected "aud" claim value` | The token's audience isn't in `ENTRA_AUDIENCE`, usually the Teams-generated `api://auth-…` URI is missing or mistyped | Decode the token (e.g. jwt.ms), copy its `aud` exactly into `ENTRA_AUDIENCE`, restart |
| 401 `unexpected "iss" claim value` | Token from another tenant, or `ENTRA_TENANT_ID` is wrong | Use the Directory (tenant) ID of the tenant users sign in to |
| 401 `Missing bearer token` from Copilot | The agent's `ai-plugin.json` has no `OAuthPluginVault` auth, or the server was scaffolded with auth off and never switched to SSO | Re-check step 3; the `auth` block must reference the auth config ID |
| 403 `missing the access_as_user scope` | Token was requested without the scope, or it's an app-only token | Check the scope in step 2.3 and the auth config's **Scope** in the Teams developer portal |
| Sign-in prompt loops, or `AADSTS65001` consent errors | Redirect URI or pre-authorized client missing | Re-check steps 2.4 and 2.5 |
| `AADSTS500011` / resource not found | The `api://auth-…` URI isn't on the Entra app | Re-check step 4.2 |
| Widget console shows CORS errors | Widget host not in `CORS_ALLOWED_ORIGINS`, or generated from a different server URL | Regenerate it from the exact MCP URL Copilot uses |
| 405 on `GET /mcp` | Expected: the server is stateless and has no standalone event stream | Nothing to fix; MCP clients fall back to POST |

## References

- [MCP apps in Microsoft 365 Copilot](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-mcp-apps)
- [Configure Microsoft Entra SSO authentication](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-authentication-entra-sso)
- [Build a plugin from an MCP server](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/build-mcp-plugins)
- [Microsoft's MCP interactive UI samples](https://github.com/microsoft/mcp-interactiveUI-samples) (the expense-submission sample uses Entra SSO)
