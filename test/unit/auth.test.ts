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

const config = makeTestConfig({
  authEnabled: true,
  entraTenantId: "11111111-2222-3333-4444-555555555555",
  entraAudience: "api://keepsong-mcp",
});

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  mockedVerify.mockReset();
});

describe("createEntraAuthMiddleware", () => {
  it("requires tenant and audience config", () => {
    expect(() => createEntraAuthMiddleware(makeTestConfig({ authEnabled: true }))).toThrow(
      ConfigurationError,
    );
  });

  it("rejects a missing bearer token with 401 + WWW-Authenticate", async () => {
    const middleware = createEntraAuthMiddleware(config);
    const res = mockRes();
    const next = vi.fn();
    middleware({ headers: {} } as Request, res, next);
    await flush();
    expect(res.statusCode).toBe(401);
    expect(res.headers["WWW-Authenticate"]).toContain("invalid_token");
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an invalid token with 401", async () => {
    mockedVerify.mockRejectedValue(new Error("signature verification failed"));
    const middleware = createEntraAuthMiddleware(config);
    const res = mockRes();
    const next = vi.fn();
    middleware({ headers: { authorization: "Bearer bad-token" } } as Request, res, next);
    await flush();
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() for a valid token and verifies iss/aud", async () => {
    mockedVerify.mockResolvedValue({} as never);
    const middleware = createEntraAuthMiddleware(config);
    const res = mockRes();
    const next = vi.fn();
    middleware({ headers: { authorization: "Bearer good-token" } } as Request, res, next);
    await flush();
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
    expect(mockedVerify).toHaveBeenCalledWith(
      "good-token",
      expect.anything(),
      expect.objectContaining({
        issuer: `https://login.microsoftonline.com/${config.entraTenantId}/v2.0`,
        audience: config.entraAudience,
      }),
    );
  });
});
