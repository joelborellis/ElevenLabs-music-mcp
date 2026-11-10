import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { AppConfig } from "../config.js";
import { ConfigurationError } from "../config.js";

/** Caller identity, set on res.locals.auth for every authenticated request. */
export interface AuthContext {
  oid: string;
  tid: string | undefined;
  name: string | undefined;
  scopes: string[];
}

/**
 * Entra ID resource-server validation (spec §7): verify inbound bearer JWTs
 * against the tenant JWKS, checking iss / aud / exp, in front of the MCP
 * transport — not inside tool handlers. This server only VALIDATES tokens
 * (hence jose, not @azure/msal-node, which is for acquiring them).
 * Authorization is uniform: any valid token from the tenant may call any tool.
 *
 * Shaped for Microsoft 365 Copilot's Entra SSO: the token store requests a
 * token for the Teams-generated Application ID URI (api://auth-<uuid>/<client-id>),
 * so several audiences are accepted, and both v1 and v2 issuers are accepted
 * because the token version depends on the app registration's
 * accessTokenAcceptedVersion.
 */
export function createEntraAuthMiddleware(config: AppConfig): RequestHandler {
  const tenantId = config.entraTenantId;
  const audiences = config.entraAudiences;
  if (!tenantId || audiences.length === 0) {
    throw new ConfigurationError("Entra auth requires ENTRA_TENANT_ID and ENTRA_AUDIENCE.");
  }
  // v1 and v2 tokens are signed with the same tenant keys.
  const jwks = createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`),
  );
  const issuers = [
    `https://login.microsoftonline.com/${tenantId}/v2.0`,
    `https://sts.windows.net/${tenantId}/`,
  ];
  const requiredScope = config.entraRequiredScope;
  const allowedAppRole = config.entraAllowedAppRole;
  const realm = config.appName;

  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      // RFC 6750 §3.1: no error code when the request carried no credentials.
      reject(res, 401, `Bearer realm="${realm}"`, "Missing bearer token");
      return;
    }
    jwtVerify(header.slice("Bearer ".length), jwks, {
      issuer: issuers,
      audience: audiences,
      clockTolerance: "60s",
    })
      .then(({ payload }) => {
        const auth = toAuthContext(payload);
        if (!auth) {
          reject(res, 401, `Bearer realm="${realm}", error="invalid_token"`, "Token has no oid claim");
          return;
        }
        // App-only tokens carry `roles`, not `scp`: they pass only with the
        // configured app role (ENTRA_ALLOWED_APP_ROLE), otherwise they fail here.
        const roles = Array.isArray(payload.roles) ? payload.roles : [];
        const hasAppRole = allowedAppRole !== undefined && roles.includes(allowedAppRole);
        if (requiredScope && !auth.scopes.includes(requiredScope) && !hasAppRole) {
          reject(
            res,
            403,
            `Bearer realm="${realm}", error="insufficient_scope", scope="${requiredScope}"`,
            `Token is missing the ${requiredScope} scope`,
          );
          return;
        }
        res.locals.auth = auth;
        next();
      })
      .catch((err: unknown) => {
        reject(
          res,
          401,
          `Bearer realm="${realm}", error="invalid_token"`,
          err instanceof Error ? err.message : "Invalid token",
        );
      });
  };
}

function toAuthContext(payload: JWTPayload): AuthContext | undefined {
  const oid = typeof payload.oid === "string" ? payload.oid : undefined;
  if (!oid) return undefined;
  const str = (value: unknown) => (typeof value === "string" ? value : undefined);
  return {
    oid,
    tid: str(payload.tid),
    name: str(payload.preferred_username) ?? str(payload.upn) ?? str(payload.name),
    scopes: (str(payload.scp) ?? "").split(" ").filter(Boolean),
  };
}

/** JSON-RPC-shaped error body (as in Microsoft's Copilot MCP samples) + RFC 6750 challenge. */
function reject(res: Response, status: 401 | 403, challenge: string, detail: string): void {
  res
    .status(status)
    .set("WWW-Authenticate", challenge)
    .json({
      jsonrpc: "2.0",
      error: { code: -32001, message: `${status === 401 ? "Unauthorized" : "Forbidden"}: ${detail}` },
      id: null,
    });
}
