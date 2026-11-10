import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jwtVerify } from "jose";
import { ConfigurationError } from "../../src/config.js";
import { createEntraAuthMiddleware } from "../../src/auth/entra.js";
import { makeTestConfig } from "../helpers.js";

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({}) as unknown),
  jwtVerify: vi.fn(),
}));

const mockedVerify = vi.mocked(jwtVerify);

function mockRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    locals: {} as Record<string, unknown>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    set(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as typeof res & Response;
}

const tenantId = "11111111-2222-3333-4444-555555555555";
const clientId = "99999999-8888-7777-6666-555555555555";
const config = makeTestConfig({
  authEnabled: true,
  entraTenantId: tenantId,
  entraAudiences: [clientId, `api://${clientId}`, `api://auth-abc/${clientId}`],
});

const userPayload = {
  oid: "user-oid-1",
  tid: tenantId,
  preferred_username: "joel@example.com",
  scp: "User.Read access_as_user",
};

async function call(
  headers: Record<string, string>,
  cfg = config,
): Promise<{ res: ReturnType<typeof mockRes>; next: ReturnType<typeof vi.fn> }> {
  const middleware = createEntraAuthMiddleware(cfg);
  const res = mockRes();
  const next = vi.fn();
  middleware({ headers } as Request, res, next);
  await new Promise((resolve) => setImmediate(resolve));
  return { res, next };
}

beforeEach(() => {
  mockedVerify.mockReset();
});

describe("createEntraAuthMiddleware", () => {
  it("requires tenant and at least one audience", () => {
    expect(() => createEntraAuthMiddleware(makeTestConfig({ authEnabled: true }))).toThrow(
      ConfigurationError,
    );
  });

  it("challenges a missing token with 401 and no error code (RFC 6750)", async () => {
    const { res, next } = await call({});
    expect(res.statusCode).toBe(401);
    expect(res.headers["WWW-Authenticate"]).toBe(`Bearer realm="${config.appName}"`);
    expect(res.body).toMatchObject({ jsonrpc: "2.0", error: { code: -32001 }, id: null });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an invalid token with 401 invalid_token", async () => {
    mockedVerify.mockRejectedValue(new Error("signature verification failed"));
    const { res, next } = await call({ authorization: "Bearer bad-token" });
    expect(res.statusCode).toBe(401);
    expect(res.headers["WWW-Authenticate"]).toContain('error="invalid_token"');
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts v1 and v2 issuers and every configured audience", async () => {
    mockedVerify.mockResolvedValue({ payload: userPayload } as never);
    const { next } = await call({ authorization: "Bearer good-token" });
    expect(next).toHaveBeenCalledOnce();
    expect(mockedVerify).toHaveBeenCalledWith(
      "good-token",
      expect.anything(),
      expect.objectContaining({
        issuer: [
          `https://login.microsoftonline.com/${tenantId}/v2.0`,
          `https://sts.windows.net/${tenantId}/`,
        ],
        audience: config.entraAudiences,
      }),
    );
  });

  it("exposes the caller on res.locals.auth", async () => {
    mockedVerify.mockResolvedValue({ payload: userPayload } as never);
    const { res } = await call({ authorization: "Bearer good-token" });
    expect(res.locals.auth).toEqual({
      oid: "user-oid-1",
      tid: tenantId,
      name: "joel@example.com",
      scopes: ["User.Read", "access_as_user"],
    });
  });

  it("rejects a token without the required scope (incl. app-only tokens) with 403", async () => {
    mockedVerify.mockResolvedValue({ payload: { oid: "app-oid", roles: ["Tasks.Read"] } } as never);
    const { res, next } = await call({ authorization: "Bearer app-token" });
    expect(res.statusCode).toBe(403);
    expect(res.headers["WWW-Authenticate"]).toContain('error="insufficient_scope"');
    expect(res.headers["WWW-Authenticate"]).toContain('scope="access_as_user"');
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts an app-only token carrying the allowed app role", async () => {
    mockedVerify.mockResolvedValue({ payload: { oid: "agent-oid", roles: ["Mcp.Invoke"] } } as never);
    const { res, next } = await call(
      { authorization: "Bearer app-token" },
      { ...config, entraAllowedAppRole: "Mcp.Invoke" },
    );
    expect(next).toHaveBeenCalledOnce();
    expect(res.locals.auth).toMatchObject({ oid: "agent-oid", scopes: [] });
  });

  it("rejects an app-only token with a different role even when a role is allowed", async () => {
    mockedVerify.mockResolvedValue({ payload: { oid: "app-oid", roles: ["Tasks.Read"] } } as never);
    const { res, next } = await call(
      { authorization: "Bearer app-token" },
      { ...config, entraAllowedAppRole: "Mcp.Invoke" },
    );
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("skips the scope check when no scope is required", async () => {
    mockedVerify.mockResolvedValue({ payload: { oid: "app-oid" } } as never);
    const { next } = await call(
      { authorization: "Bearer app-token" },
      { ...config, entraRequiredScope: undefined },
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects a token without an oid claim", async () => {
    mockedVerify.mockResolvedValue({ payload: { scp: "access_as_user" } } as never);
    const { res, next } = await call({ authorization: "Bearer odd-token" });
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
