import { describe, expect, it } from "vitest";
import { ConfigurationError, loadConfig, validateStartupConfig } from "../../src/config.js";

const base = { OPENAI_API_KEY: "sk-test" };

describe("auth config", () => {
  it("parses ENTRA_AUDIENCE as a trimmed comma-separated list", () => {
    const config = loadConfig({ ...base, ENTRA_AUDIENCE: " cid , api://cid,, api://auth-x/cid " });
    expect(config.entraAudiences).toEqual(["cid", "api://cid", "api://auth-x/cid"]);
  });

  it("keeps a single-value ENTRA_AUDIENCE working", () => {
    expect(loadConfig({ ...base, ENTRA_AUDIENCE: "api://keepsong" }).entraAudiences).toEqual([
      "api://keepsong",
    ]);
  });

  it("defaults the required scope to access_as_user, also when blank", () => {
    expect(loadConfig(base).entraRequiredScope).toBe("access_as_user");
    expect(loadConfig({ ...base, ENTRA_REQUIRED_SCOPE: "" }).entraRequiredScope).toBe(
      "access_as_user",
    );
  });

  it("disables the scope check with ENTRA_REQUIRED_SCOPE=none", () => {
    expect(loadConfig({ ...base, ENTRA_REQUIRED_SCOPE: "none" }).entraRequiredScope).toBeUndefined();
    expect(loadConfig({ ...base, ENTRA_REQUIRED_SCOPE: "Music.Use" }).entraRequiredScope).toBe(
      "Music.Use",
    );
  });

  it("parses CORS_ALLOWED_ORIGINS as a list, empty by default", () => {
    expect(loadConfig(base).corsAllowedOrigins).toEqual([]);
    expect(
      loadConfig({ ...base, CORS_ALLOWED_ORIGINS: "https://a.example,https://b.example" })
        .corsAllowedOrigins,
    ).toEqual(["https://a.example", "https://b.example"]);
  });

  it("fails startup when auth is on without tenant or audiences", () => {
    const noAudience = loadConfig({ ...base, AUTH_ENABLED: "true", ENTRA_TENANT_ID: "tid" });
    expect(() => validateStartupConfig(noAudience)).toThrow(ConfigurationError);

    const ok = loadConfig({
      ...base,
      AUTH_ENABLED: "true",
      ENTRA_TENANT_ID: "tid",
      ENTRA_AUDIENCE: "cid",
    });
    expect(() => validateStartupConfig(ok)).not.toThrow();
  });
});
