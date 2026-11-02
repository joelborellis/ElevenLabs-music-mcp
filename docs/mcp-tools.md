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
- `Upstream Error (bad gateway): …` — ElevenLabs unreachable/failed during `list_finetunes` or the finetune lookup in `generate_music_prompt` (preserves the Python app's unique 502 mapping)
- `Internal Server Error: …` — anything unexpected

## Typical call sequence

```
list_finetunes  →  generate_music_prompt  →  start_render  →  get_render_status (poll)  →  play audio_url
 (pick a style)    (finetune + presets → brief)  (same finetune_id;    (progress → song)         or read keepsong://renders/{id}
                                                 returns id at once)
                   generate_composition_plan     render_music = the blocking alternative for clients without a UI
                   (optional: prompt → chunks, free)
```

Every stage is independently callable — a client may skip straight to
`render_music` with a hand-written prompt or hand-built chunks. In Microsoft 365
Copilot the same tools render the **Keepsong Studio card** (see the `ui://`
resource below), and the card polls `get_render_status` by itself.

---

## Tool: `generate_music_prompt`

Turns a **finetune** plus two presets and an optional freeform narrative into a
polished text prompt for ElevenLabs' `music_v2_5` model. Internally runs an
OpenAI agent (gpt-5.6 with web search) constrained to structured output; the
system prompt in `prompts/generate_music_prompt.md` defines how the inputs
translate into musical direction.

Each input owns a different part of the track:

- **Finetune** (`finetune_id`) — the *sound*: genre, tempo, groove, harmony,
  instrumentation, vocal character. The server looks the finetune up and hands
  the agent its name, primary genre and tags; the agent derives the style from
  those. Pick one with `list_finetunes` first.
- **Project blueprint** — the *form*: use case, duration, looping, structure,
  vocal mode, lyric plan.
- **Delivery & control** — how *prescriptive* the prompt is, transitions, mix
  aesthetic.
- **Narrative** — lyrics, names, story and emotional intent, but never genre.

Pass the returned `finetune_id` to `render_music` so the audio is rendered with
the same style the prompt was written for.

**Example prompt that triggers it:**
> "I need music for a 30-second ad for my coffee brand, in that Indie Dance
> style we have. It's for our spring campaign launch. Can you put together a
> solid music prompt for that?"

(The model calls `list_finetunes`, picks the "Indie Dance" `id`, maps
"30-second ad" → `ad_brand_fast_hook`, picks `balanced_studio` as the sensible
default, and passes the campaign detail as `user_narrative`.)

### Input

| Field | Type | Required | Notes |
|---|---|---|---|
| `project_blueprint` | enum | yes | `ad_brand_fast_hook` (30s ad) · `podcast_voiceover_loop` (60s instrumental bed) · `video_game_action_loop` (90s instrumental) · `meditation_sleep` (auto length, instrumental) · `standalone_song_mini` (90s song with sung lyrics) |
| `finetune_id` | string | yes | From `list_finetunes`; must be a completed finetune. Sets the genre/sound |
| `delivery_and_control` | enum | yes | `exploratory_iterate` · `balanced_studio` (recommended default) · `blueprint_plan_first` · `live_one_take` · `isolation_stems` — controls how prescriptive the generated prompt is |
| `instrumental_only` | boolean | no (default `false`) | `true` forces instrumental and strips all sung-lyrics references, overriding everything else |
| `user_narrative` | string \| null | no | Freeform story/occasion/people details. When present it is **mandatory primary creative context** for story and emotion (never genre) — the agent may use web search to fetch URLs found in it. For `standalone_song_mini` only, a target length stated here (e.g. "about 30 seconds") overrides the 90s default |

### Output

```json
{
  "prompt": "Create a 30-second bright nu-disco ad spot at 122 BPM ...",
  "title": "Spring Roast Groove",            // 3–6 words
  "description": "A 30-second nu-disco ...",  // 1–2 sentences
  "about": "Spring Roast launch, 14 March",   // what the song is for, from the narrative; null if none
  "finetune_id": "lh6n3z81aznqz0ohl9pn",      // → render_music.finetune_id
  "finetune_name": "Indie Dance",
  "sound_profile": "indie_dance",             // slug sent to the agent
  "request_id": "uuid",
  "timestamp": "2026-07-30T17:58:00.000Z",
  "input_parameters": { ...the validated request echoed back... }
}
```

`prompt` is what you feed into `generate_composition_plan` or `render_music`.
The prompt, title and description describe the music only; they never mention
the finetune or its name.

### Failure modes

Unknown or still-training finetune → `Validation Error`. ElevenLabs unreachable
during the finetune lookup → `Upstream Error`, unless the finetune is already in
the `list_finetunes` cache, in which case the prompt is generated from the
cached name alone. Missing system-prompt file → `Configuration Error` (deploy
problem). Agent failure or malformed structured output → `Generation Error`. No
retries are performed.

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
  "finetune_id": "lh6n3z81aznqz0ohl9pn",     // null when no finetune was used
  "finetune_strength": null,
  "audio_url": "https://<public-base>/media/renders/1ece3fa7-…?exp=…&sig=…",  // signed, valid 1 hour
  "request_id": "uuid",
  "timestamp": "2026-07-30T…Z"
}
```

Note: `download_url`/`stream_url` are **MCP resource URIs**, not HTTP URLs.
`audio_url` is a short-lived signed HTTPS link for players that can't read MCP
resources — the Copilot card's `<audio>` element — see `GET /media/renders/{id}`
at the end of this document.

---

## Tool: `start_render`

`render_music` without the wait: **identical inputs** (plus the local-only
`description` and `about` from the brief, which the card shows while composing
and on the finished song), but the call returns as soon as the `processing` row
exists and the render carries on in the background. This is what the Keepsong Studio card uses, so Copilot never blocks
on a minutes-long call (or trips a gateway timeout). Prefer it whenever a card
is shown; use `render_music` from clients that want to block.

### Output

```json
{
  "id": "1ece3fa7-…",                 // poll get_render_status with this
  "status": "processing",
  "request_id": "uuid",
  "title": "Spring Roast Groove",
  "prompt": "…",
  "finetune_id": "lh6n3z81aznqz0ohl9pn",
  "progress": { "stage": "validated", "percent": 10, "message": "Request validated" }
}
```

Validation errors (same cross-field rules as `render_music`) are returned
immediately; anything that fails *after* the row exists shows up as
`status: "failed"` in `get_render_status`. Progress is held in memory per
process (single-replica assumption — see `docs/checkpoint.md` for the Azure note).

---

## Tool: `get_render_status`

Polling companion to `start_render`, and recovery for `render_music`.

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

- `status: "complete"` → the **full** `render_music` response shape (above), including `audio_url`.
- `processing` → `{ "id", "status": "processing", "progress": { "stage", "percent", "message" } | null, "title", "prompt", "finetune_id" }`.
  `progress` is present only for renders started with `start_render` in this process.
- `failed` → `{ "id", "status": "failed", "error": "…" }`.
- Unknown id → tool error `Render not found: <id>`.

---

## Tool: `list_finetunes`

Lists ElevenLabs **finetunes** — custom-trained style models (e.g. "Rock
Français") that set the sound for `generate_music_prompt` and `render_music`
via `finetune_id`. The server proxies this so
clients never hold the ElevenLabs API key.

**Example prompt that triggers it:**
> "What custom music styles do we have available? I'd love something with a
> French rock feel for this track."

(The model lists the finetunes, spots "Rock Français", and carries its `id`
into `generate_music_prompt` and then `render_music`.)

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

## Tool: `list_renders`

Returns up to `limit` (1–50, default 20) recent **completed** songs, newest
first, each in the `render_music` response shape (with `audio_url`), excluding
style previews (titles starting `preview:`). Two callers: the model, to find a
song the user names in a later chat ("show me Spring Into Bright" →
`list_renders` → `get_render_status` with its id), and the Keepsong Studio
card, for its Versions rail.

---

## Tool: `preview_style` (app-only)

Hidden from the model (`_meta.ui.visibility: ["app"]`): the Style strip calls it
when the user taps **Hear a taste**. Renders an **8-second instrumental** sample
in the given finetune (prompt built from the finetune's genre and tags,
`force_instrumental`, title `preview:<finetune_id>`) and returns
`{ finetune_id, audio_url, duration_ms, cached }`. The second tap on the same
style finds the earlier row by title and reuses it — one render per style,
ever. Previews never appear in `list_renders` or the Versions rail.

---

## Resource: `keepsong://renders/{id}`

The MCP way to get audio bytes (the other is the signed `audio_url`, described
at the end of this document). This replaces the Python app's
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

## Resource: `ui://keepsong/studio.html` — the Keepsong Studio card

An [MCP Apps](https://modelcontextprotocol.github.io/ext-apps/) resource
(`text/html;profile=mcp-app`): one self-contained HTML bundle built from
`widgets/` (`npm run build:widgets` → `assets/studio.html`). Every widget tool
(`generate_music_prompt`, `list_finetunes`, `start_render`, `get_render_status`,
`list_renders`) advertises it via `_meta.ui.resourceUri`, so hosts that support
MCP Apps — Microsoft 365 Copilot — render the card inline instead of raw JSON.

Widget tools return their JSON twice: as the `text` block the model reads, and
as `structuredContent` with a `kind` the card switches on:

| `kind` | From | Card state |
|---|---|---|
| `brief` | `generate_music_prompt` | The brief: title, description, style, direction |
| `styles` | `list_finetunes` | Style strip |
| `plan` | `generate_composition_plan` | Section timeline while composing |
| `composing` | `start_render`; `get_render_status` while processing | Progress |
| `song` | `get_render_status` when complete | Player |
| `failed` | `get_render_status` when failed | Error + retry |
| `versions` | `list_renders` | Versions rail |
| `preview` | `preview_style` (app-only) | Not a state: the Style strip plays the returned `audio_url` |

The resource's `_meta.ui.csp` allows `PUBLIC_BASE_URL` as a connect and resource
domain so the card can play `audio_url`. Copilot reads this one resource
**without** a user token — the server permits tokenless `resources/read` for
`ui://` URIs only; every tool and the `keepsong://` resource stay behind auth.

---

## Not tools: `GET /health` and `GET /media/renders/{id}`

- **`GET /health`** — plain, unauthenticated liveness endpoint for container
  probes: `{ "status": "ok", "name": …, "version": … }`.
- **`GET /media/renders/{id}?exp=<unix seconds>&sig=<hmac>`** — streams a
  completed render's audio for players that can't read MCP resources (the
  Copilot card's `<audio>`). Authenticated by the signature — HMAC-SHA256 over
  `id.exp` with `MEDIA_SIGNING_KEY`, one-hour expiry — rather than a bearer
  token, because browsers can't attach one to media requests. Supports `Range`
  for scrubbing. `403` on a bad or expired link, `404` for unknown or
  incomplete renders. Links are minted only by the server (`audio_url` in tool
  results); nobody can construct one without the key.
