import { afterEach, describe, expect, it, vi } from "vitest";
import { signRenderUrl, verifyRenderSignature } from "../../src/services/media.js";
import { makeTestConfig } from "../helpers.js";

const config = makeTestConfig();

function params(url: string): { exp: string; sig: string } {
  const u = new URL(url);
  return { exp: u.searchParams.get("exp")!, sig: u.searchParams.get("sig")! };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("signed media URLs", () => {
  it("mints a URL on the public base that verifies for the same id", () => {
    const url = signRenderUrl(config, "abc");
    expect(url.startsWith("http://localhost:3000/media/renders/abc?")).toBe(true);
    const { exp, sig } = params(url);
    expect(verifyRenderSignature(config, "abc", exp, sig)).toBe(true);
  });

  it("rejects another id, a tampered signature, and another key", () => {
    const { exp, sig } = params(signRenderUrl(config, "abc"));
    expect(verifyRenderSignature(config, "xyz", exp, sig)).toBe(false);
    expect(verifyRenderSignature(config, "abc", exp, sig.replace(/^./, (c) => (c === "0" ? "1" : "0")))).toBe(
      false,
    );
    expect(verifyRenderSignature(makeTestConfig({ mediaSigningKey: "other" }), "abc", exp, sig)).toBe(false);
  });

  it("rejects an expired link", () => {
    vi.useFakeTimers();
    const { exp, sig } = params(signRenderUrl(config, "abc", 60));
    vi.advanceTimersByTime(61_000);
    expect(verifyRenderSignature(config, "abc", exp, sig)).toBe(false);
  });

  it("rejects missing or malformed parameters", () => {
    expect(verifyRenderSignature(config, "abc", undefined, undefined)).toBe(false);
    expect(verifyRenderSignature(config, "abc", "12x", "zz")).toBe(false);
    expect(verifyRenderSignature(config, "abc", "99999999999", "")).toBe(false);
  });
});
