import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppConfig } from "../config.js";
import { ConfigurationError } from "../config.js";

/**
 * Entra ID resource-server validation (spec §7): verify inbound bearer JWTs
 * against the tenant JWKS, checking iss / aud / exp, in front of the MCP
 * transport — not inside tool handlers. This server only VALIDATES tokens
 * (hence jose, not @azure/msal-node, which is for acquiring them).
 * Authorization is uniform: any valid token from the tenant may call any tool.
 */
export function createEntraAuthMiddleware(config: AppConfig): RequestHandler {
  const tenantId = config.entraTenantId;
  const audience = config.entraAudience;
  if (!tenantId || !audience) {
    throw new ConfigurationError("Entra auth requires ENTRA_TENANT_ID and ENTRA_AUDIENCE.");
  }
  const jwks = createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`),
  );
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;

  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      reject(res, "Missing bearer token");
      return;
    }
    jwtVerify(header.slice("Bearer ".length), jwks, { issuer, audience })
      .then(() => next())
      .catch((err: unknown) => {
        reject(res, err instanceof Error ? err.message : "Invalid token");
      });
  };
}

function reject(res: Response, detail: string): void {
  res
    .status(401)
    .set("WWW-Authenticate", 'Bearer error="invalid_token"')
    .json({ error: "unauthorized", detail });
}
