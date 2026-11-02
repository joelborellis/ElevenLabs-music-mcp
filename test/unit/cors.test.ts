import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { createCorsMiddleware } from "../../src/http/cors.js";

function request(origin?: string): Request {
  return { method: "POST", headers: origin ? { origin } : {} } as unknown as Request;
}

const response = { set: () => response, vary: () => response, status: () => response, end: () => response } as unknown as Response;

describe("CORS origin logging", () => {
  it("logs each distinct origin once, saying whether it is allowed", () => {
    const lines: string[] = [];
    const cors = createCorsMiddleware(["https://widget.usercontent.microsoft"], (line) => lines.push(line));
    const next = () => {};
    cors(request("https://widget.usercontent.microsoft"), response, next);
    cors(request("https://widget.usercontent.microsoft"), response, next);
    cors(request("https://other.example"), response, next);
    cors(request(), response, next);
    expect(lines).toEqual([
      "CORS: first request from origin https://widget.usercontent.microsoft (allowed)",
      "CORS: first request from origin https://other.example (not in CORS_ALLOWED_ORIGINS)",
    ]);
  });
});
