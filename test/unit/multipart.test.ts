import { describe, expect, it } from "vitest";
import { parseComposeMultipart } from "../../src/services/elevenlabs.js";

const BOUNDARY = "abc123boundary";

function buildMultipart(opts: {
  audio: Buffer;
  json?: Record<string, unknown>;
  filename?: string;
  closingBoundary?: boolean;
  sep?: "\r\n" | "\n";
}): Buffer {
  const sep = opts.sep ?? "\r\n";
  const json = JSON.stringify(opts.json ?? { composition_plan: { chunks: [] }, song_metadata: { title: "T" } });
  const parts: Buffer[] = [
    Buffer.from(
      `--${BOUNDARY}${sep}` +
        `Content-Type: application/json${sep}${sep}` +
        `${json}${sep}` +
        `--${BOUNDARY}${sep}` +
        `Content-Type: audio/mpeg${sep}` +
        `Content-Disposition: attachment; filename="${opts.filename ?? "track.mp3"}"${sep}${sep}`,
    ),
    opts.audio,
  ];
  if (opts.closingBoundary) parts.push(Buffer.from(`${sep}--${BOUNDARY}--${sep}`));
  return Buffer.concat(parts);
}

// Audio bytes deliberately contain CRLF and '{' to catch text-based parsing bugs.
const AUDIO = Buffer.concat([
  Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x0d, 0x0a, 0x7b, 0x00]),
  Buffer.from("binary\r\n\r\nstuff{}"),
]);

describe("parseComposeMultipart", () => {
  it("parses JSON, audio bytes, and filename (boundary from Content-Type header)", () => {
    const body = buildMultipart({ audio: AUDIO, filename: "my_song.mp3" });
    const result = parseComposeMultipart(body, `multipart/mixed; boundary=${BOUNDARY}`);
    expect(result.filename).toBe("my_song.mp3");
    expect(result.json.composition_plan).toEqual({ chunks: [] });
    expect(result.json.song_metadata).toEqual({ title: "T" });
    expect(result.audio.equals(AUDIO)).toBe(true);
  });

  it("falls back to the first body line when no content-type is available (Python parser behavior)", () => {
    const body = buildMultipart({ audio: AUDIO });
    const result = parseComposeMultipart(body, null);
    expect(result.filename).toBe("track.mp3");
    expect(result.audio.equals(AUDIO)).toBe(true);
  });

  it("strips a trailing closing boundary from the audio", () => {
    const body = buildMultipart({ audio: AUDIO, closingBoundary: true });
    const result = parseComposeMultipart(body, `multipart/mixed; boundary="${BOUNDARY}"`);
    expect(result.audio.equals(AUDIO)).toBe(true);
  });

  it("handles LF-only separators", () => {
    const body = buildMultipart({ audio: AUDIO, sep: "\n" });
    const result = parseComposeMultipart(body, null);
    expect(result.audio.equals(AUDIO)).toBe(true);
    expect(result.json.song_metadata).toBeDefined();
  });

  it("rejects an empty body and a body without a second boundary", () => {
    expect(() => parseComposeMultipart(Buffer.alloc(0), null)).toThrow(/Empty response/);
    const single = Buffer.from(`--${BOUNDARY}\r\nContent-Type: application/json\r\n\r\n{}\r\n`);
    expect(() => parseComposeMultipart(single, null)).toThrow(/audio part boundary/);
  });

  it("rejects unparseable JSON", () => {
    const body = Buffer.from(
      `--${BOUNDARY}\r\nContent-Type: application/json\r\n\r\nnot-json\r\n--${BOUNDARY}\r\n\r\naudio`,
    );
    expect(() => parseComposeMultipart(body, null)).toThrow(/Could not parse JSON/);
  });
});
