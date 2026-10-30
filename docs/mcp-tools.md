# Keepsong MCP — Tool & Resource Reference

This server speaks the **Model Context Protocol (MCP)**, which works differently
from a REST API. Understanding that difference first makes the rest of this
document read naturally.

## How MCP tools differ from HTTP endpoints

| | REST endpoint | MCP tool |
|---|---|---|
| Caller | Any HTTP client, hand-written code | An AI client/agent (Claude, Copilot agent mode, Teams/Agent 365, …) that *decides on its own* when to call the tool |
| Discovery | You read docs / OpenAPI | The client calls `tools/list` at runtime and receives every tool's name, description, and JSON input schema. The **description is part of the API** — it's what the model reads to decide when and how to use the tool |
| Transport | One HTTP verb + URL per operation | One endpoint (`POST /mcp`, JSON-RPC) or stdio; the operation is named in the `tools/call` payload |
| Input validation | Query/path/body params, `422` on failure | Arguments are one JSON object validated against the advertised schema; invalid input comes back as a *tool error result*, not an HTTP status |
| Response | Status code + body | A result object containing `content` (here: one `text` block holding pretty-printed JSON). Errors set `isError: true` with a human-readable message — there are no 4xx/5xx per tool |
| Streaming/progress | WebSocket or SSE endpoint | Built in: if the caller includes a `progressToken` in the request `_meta`, the server emits `notifications/progress` events during the call |
| File downloads | `GET` with `Content-Disposition` | **Resources**: a URI (`keepsong://renders/{id}`) read via `resources/read`, returning base64 bytes + mimeType |

Because errors are text results rather than status codes, this server prefixes
every error message with its class so both the model and an operator can tell
failures apart:

- `Validation Error: …` — bad input (the equivalent of the old 422s)
- `Configuration Error: …` — the *server* is misconfigured (missing API key, missing prompt file)
- `Generation Error: …` — the upstream generation itself failed
- `Upstream Error (bad gateway): …` — ElevenLabs unreachable/failed during `list_finetunes` (preserves the Python app's unique 502 mapping)
- `Internal Server Error: …` — anything unexpected

## Typical call sequence

```
generate_music_prompt  →  generate_composition_plan  →  render_music  →  read keepsong://renders/{id}
        (presets → prompt text)     (prompt → chunks)        ↑                    (audio bytes)
                                          list_finetunes ────┘  (optional style steering)
                                          get_render_status ←── (recovery if render_music times out)
```

Every stage is independently callable — a client may skip straight to
`render_music` with a hand-written prompt or hand-built chunks.

---

## Tool: `generate_music_prompt`

Turns a **three-choice preset selection** plus an optional freeform narrative
into a polished text prompt for ElevenLabs' music models (`music_v2` / `music_v2_5`). Internally runs
an OpenAI agent (gpt-5.6 with web search) constrained to structured output; the
359-line system prompt in `prompts/generate_music_prompt.md` defines exactly
how presets translate into musical direction.

> **Do not confuse** `sound_profile` (a hardcoded product preset used only
> here) with ElevenLabs **finetunes** (server-side style models selected at
> *render* time via `finetune_id`). They are unrelated.

**Example prompt that triggers it:**
> "I need music for a 30-second ad for my coffee brand — something bright,
> poppy and electronic. It's for our spring campaign launch. Can you put
> together a solid music prompt for that?"

(The model maps "30-second ad" → `ad_brand_fast_hook`, "bright, poppy,
electronic" → `bright_pop_electro`, picks `balanced_studio` as the sensible
default, and passes the campaign detail as `user_narrative`.)

### Input

| Field | Type | Required | Notes |
|---|---|---|---|
| `project_blueprint` | enum | yes | `ad_brand_fast_hook` (30s ad) · `podcast_voiceover_loop` (60s instrumental bed) · `video_game_action_loop` (90s instrumental) · `meditation_sleep` (auto length, instrumental) · `standalone_song_mini` (90s song with sung lyrics) |
| `sound_profile` | enum | yes | `bright_pop_electro` · `dark_trap_night` · `lofi_cozy` · `epic_cinematic` · `indie_live_band` |
| `delivery_and_control` | enum | yes | `exploratory_iterate` · `balanced_studio` (recommended default) · `blueprint_plan_first` · `live_one_take` · `isolation_stems` — controls how prescriptive the generated prompt is |
| `instrumental_only` | boolean | no (default `false`) | `true` forces instrumental and strips all sung-lyrics references, overriding everything else |
| `user_narrative` | string \| null | no | Freeform story/occasion/people details. When present it is **mandatory primary creative context**, not flavor — the agent may use web search to fetch URLs found in it. For `standalone_song_mini` only, a target length stated here (e.g. "about 30 seconds") overrides the 90s default |

### Output

```json
{
  "prompt": "Create a 30-second bright pop-electro ad ...",
  "title": "Bright Brand Spark",            // 3–6 words
  "description": "A 30-second bright ...",  // 1–2 sentences
  "request_id": "uuid",
  "timestamp": "2026-07-30T17:58:00.000Z",
  "input_parameters": { ...the validated request echoed back... }
}
```

`prompt` is what you feed into `generate_composition_plan` or `render_music`.

### Failure modes

Missing system-prompt file → `Configuration Error` (deploy problem). Agent
failure or malformed structured output → `Generation Error`. No retries are
performed.

---

## Tool: `generate_composition_plan`

Turns a text prompt into a structured, section-by-section `music_v2_5`
composition plan — a "recipe" of **chunks** the render stage can execute.
Calls ElevenLabs' plan endpoint (free of credit cost, but rate-limited).

**Example prompt that triggers it:**
> "Before we render that, break it down into sections — intro, verse, chorus —
> so I can see the structure and tweak the timing first."

(Also triggered standalone: "Plan out a 45-second lofi track section by
section." The model passes the prompt text and lets the duration be parsed
from it.)

### Input

| Field | Type | Required | Notes |
|---|---|---|---|
| `prompt` | string | yes | Non-empty |
| `music_length_ms` | int 1000–300000 \| null | no | Duration resolution priority: **(1)** this value if provided → **(2)** a duration parsed from the prompt text (`"30-second"`, `"30 seconds"`, `"2 minutes"`, `"1.5 minute"`, case-insensitive, clamped to 1–300s) → **(3)** default 30000. Note the floor here is **1000**, unlike `render_music`'s **3000** |

### Output

```json
{
  "chunks": [
    {
      "text": "[Intro]",                  // section marker and/or lyrics
      "positive_styles": ["indie pop", "clean electric guitar riff"],
      "negative_styles": ["vocals", "heavy reverb"],
      "duration_ms": 4000,
      "context_adherence": "high"         // optional
    }
  ]
}
```

Chunks are **open objects**: any additional fields ElevenLabs introduces
(e.g. `conditioning_ref`, `condition_strength`) are preserved end-to-end, both
here and when chunks are passed back into `render_music`.

---

## Tool: `render_music`

The workhorse: generates **actual audio** via ElevenLabs from **either** a text
prompt **or** composition-plan chunks — never both. Persists the audio to blob
storage and its metadata to the database, and returns a durable render `id`.

**Example prompt that triggers it:**
> "That plan looks great — go ahead and generate the audio. Call it 'Spring
> Launch Spot'."

(Or directly, skipping the earlier stages: "Render me an 8-second upbeat
pop-electro sting, instrumental, as an mp3." The model chooses prompt mode
with `music_length_ms: 8000` and `force_instrumental: true`. Adding "use that
French rock style we found" makes it attach the `finetune_id` from an earlier
`list_finetunes` call.)

### Input

| Field | Type | Required | Notes |
|---|---|---|---|
| `prompt` | string \| null | one of prompt/chunks | Text-prompt mode |
| `chunks` | Chunk[] | one of prompt/chunks | Plan mode (same chunk shape as `generate_composition_plan` returns — you can pass its output straight through) |
| `music_length_ms` | int 3000–300000 \| null | no | **Prompt mode only**; rejected when combined with `chunks` |
| `model_id` | string | no (default `"music_v2_5"`) | `"music_v2"` also works. `music_v2`-trained finetunes work with either model |
| `finetune_id` | string \| null | no | From `list_finetunes`; steers the style with a custom-trained model. Works in both modes |
| `finetune_strength` | number 0.0–1.0 \| null | no | Only valid together with `finetune_id`; ElevenLabs defaults to 1.0 (full strength) |
| `force_instrumental` | boolean | no (default `false`) | Guarantees instrumental output (prompt mode) |
| `store_for_inpainting` | boolean | no (default `false`) | Makes ElevenLabs retain the song server-side for later inpainting |
| `with_timestamps` | boolean | no (default `false`) | Adds word-level timing (`words_timestamps`) to the response metadata |
| `sign_with_c2pa` | boolean | no (default `false`) | C2PA-signs the output (mp3 only) |
| `output_format` | string \| null | no | e.g. `"mp3_44100_128"`, `"pcm_44100"`; omit to let the API choose |
| `title` | string \| null | no | **Local only — never sent to ElevenLabs.** Used to name the stored file (sanitized: lowercased, spaces→`_`, punctuation stripped, truncated, `_<8 hex>.mp3` appended) |

**Cross-field rules** (violations return a `Validation Error`):
1. Exactly one of `prompt` / `chunks` must be provided.
2. `music_length_ms` requires `prompt`.
3. `finetune_strength` requires `finetune_id`.

**Plan-mode validation** (prompt mode is validated by ElevenLabs itself):
at least one chunk; every chunk ≥ 3000ms; total duration 3000–300000ms (ElevenLabs' 5-minute limit).

### Progress notifications

Renders take seconds to a few minutes. If the caller includes a
`progressToken` in the request's `_meta` (MCP clients typically do this by
passing an `onprogress` callback), the server emits `notifications/progress`
through these stages:

| Stage | Progress |
|---|---|
| `validating` / `validated` | 5 / 10 |
| `generating` | 15 → 65, +5 every 2s while ElevenLabs works (simulated — the API offers no real progress signal) |
| `processing` | 75 |
| `saving` (blob upload) | 90 |
| `extracting` (metadata) | 95 |
| `complete` | 100 |

Without a token the call simply blocks until done.

### Durability — why the returned `id` matters

The metadata row is written with `status: "processing"` **before** ElevenLabs
is called, then updated to `complete` or `failed`. If your connection or a
gateway timeout kills the call mid-render, the render itself continues —
recover the result with `get_render_status` instead of re-submitting (which
would spend credits twice).

### Output

```json
{
  "id": "1ece3fa7-…",                       // durable handle
  "filename": "my_track_95772461.mp3",
  "file_path": "https://<account>.blob.core.windows.net/music/…",  // informational
  "download_url": "keepsong://renders/1ece3fa7-…",  // read via MCP resource
  "stream_url":   "keepsong://renders/1ece3fa7-…",
  "content_type": "audio/mpeg",
  "file_size_bytes": 128776,
  "duration_ms": 8000,
  "composition_plan": { "chunks": [ … ] },   // as returned/adjusted by ElevenLabs
  "song_metadata": { "title": …, "genres": … },
  "request_id": "uuid",
  "timestamp": "2026-07-30T…Z"
}
```

Note: `download_url`/`stream_url` are **MCP resource URIs**, not HTTP URLs —
this deployment exposes audio exclusively through the resource (see below).

---

## Tool: `get_render_status`

Recovery/polling companion to `render_music`.

**Example prompt that triggers it:**
> "Hmm, that render seemed to hang and never came back — did it actually
> finish? Don't re-run it, just check."

(The model polls with the `id` it received before the connection dropped,
instead of re-submitting and spending credits twice.)

### Input

| Field | Type | Required |
|---|---|---|
| `render_id` | string | yes |

### Output

- `status: "complete"` → the **full** `render_music` response shape (above).
- Otherwise → `{ "id": "…", "status": "processing" | "failed", "error": "…" | null }`.
- Unknown id → tool error `Render not found: <id>`.

---

## Tool: `list_finetunes`

Lists ElevenLabs **finetunes** — custom-trained style models (e.g. "Rock
Français") usable as `render_music`'s `finetune_id`. The server proxies this so
clients never hold the ElevenLabs API key.

**Example prompt that triggers it:**
> "What custom music styles do we have available? I'd love something with a
> French rock feel for this track."

(The model lists the finetunes, spots "Rock Français", and can carry its `id`
into the next `render_music` call.)

### Input

| Field | Type | Required | Notes |
|---|---|---|---|
| `model_id` | string \| null | no | e.g. `"music_v2"` — filtered **client-side** on the cached page |
| `visibility` | `private` \| `workspace` \| `public` \| null | no | Sent upstream |
| `created_by` | `self` \| `workspace` \| `elevenlabs` \| null | no | Sent upstream |
| `include_incomplete` | boolean | no (default `false`) | By default only `status === "completed"` finetunes are returned |
| `cursor` | string \| null | no | Pagination cursor from a previous response |
| `page_size` | int 1–100 \| null | no | Upstream page size |
| `refresh` | boolean | no (default `false`) | Bypass the cache |

Results are cached in memory per upstream parameter set (`FINETUNES_CACHE_TTL`,
default 300s; `0` disables). `model_id` and the completed-filter are applied
per request *after* the cache, so one upstream fetch serves many filter
combinations.

### Output

```json
{
  "finetunes": [
    {
      "id": "lh6n3z81aznqz0ohl9pn",     // → render_music.finetune_id
      "name": "Rock Français",
      "tags": ["rock"],
      "primary_genre": "rock",
      "model_id": "music_v2",
      "created_at": "2026-01-01T00:00:00.000Z",
      "visibility": "public",
      "created_by": "elevenlabs",
      "status": "completed",
      "training_progress": 1.0,
      "failure_reason": null
    }
  ],
  "count": 37,          // count AFTER client-side filtering
  "has_more": false,    // reflects the upstream, UNFILTERED page
  "next_cursor": null
}
```

---

## Resource: `keepsong://renders/{id}`

The only way audio bytes leave this server (there are no HTTP download/stream
routes in this deployment). This replaces the Python app's
`GET /render/download/{id}` and `GET /render/stream/{id}` — the
attachment-vs-inline distinction has no MCP equivalent; a resource read simply
returns the bytes.

**Example prompt that triggers it:**
> "Grab the audio from that last render and save it to my project folder." —
> or, without an id in hand: "Show me the tracks we've rendered recently"
> (which triggers `resources/list` first).

- **`resources/list`** — browses recent completed renders (newest first, up to
  50), each with its URI, a display name (title → filename → id), duration, and
  mimeType. Useful for "what have I rendered lately?" without knowing an id.
- **`resources/read`** with `keepsong://renders/{id}` — resolves the id in the
  database, verifies the blob still exists in storage, and returns:

```json
{
  "contents": [
    { "uri": "keepsong://renders/1ece3fa7-…", "mimeType": "audio/mpeg", "blob": "<base64>" }
  ]
}
```

Errors (unknown id, incomplete render, missing blob) are reported as resource
read failures with a specific message.

---

## Not tools: `GET /health`

A plain, unauthenticated HTTP liveness endpoint for container probes —
`{ "status": "ok", "name": …, "version": … }`. Everything else on this server
is MCP.
