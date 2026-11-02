# Keepsong Studio — the Copilot card: design and phases

The experience design for the MCP Apps card that this server serves to Microsoft 365 Copilot
(`ui://keepsong/studio.html`, built from `widgets/`). This is the reference for finishing and
extending the card; status per phase is in [checkpoint.md](checkpoint.md).

## Premise

In Copilot the user is already in the middle of making something — a launch brief, a deck, an
announcement, an event page — and Copilot holds that context. The song is a companion to that
artifact, not the product. So the card is built around *moments in a creative process*: the
conversation asks, the card lets the user choose, listen and decide.

Decisions: internal demo/showcase audience (a few polished paths over breadth) · **one evolving
card** rather than a widget per tool · cheap 8-second style tastes, rendered once per style.

## Principles

1. **Conversation asks, widgets decide.** Never rebuild tool inputs as forms. No BPM, finetune ids,
   enum names or JSON on screen.
2. **The card belongs to the artifact.** It says what the song is *for* ("For: Sprout launch, April 15").
3. **Make the wait a feature.** Rendering takes 30 s–2 min: show the song taking shape, never a bare spinner,
   and never block Copilot on a long call (`start_render` + polling).
4. **Taste over parameters.** Styles are cards you can hear; variations are one-tap nudges sent back
   to the conversation, not sliders.
5. **One card, many states**, switched by `structuredContent.kind` of the tool result the host hands it.
6. **Degrade gracefully.** Check every `app.*` capability before use; fall back to a static summary.

## States (`widgets/src/Studio.tsx` → `components/*`)

| `kind` | Component | What it does | Status |
|---|---|---|---|
| `brief` | `Brief.tsx` | Title, description, "For:" line; **Use** / **Vocals** / **Style** flip-chips (re-run `generate_music_prompt` from the card; Vocals is fixed to "instrumental" for the always-instrumental uses); direction preview; **Compose** (`start_render` from the card); nudge chips → `sendMessage` | done |
| `styles` | `StyleStrip.tsx` | One mood card per finetune (hue from genre family, `lib/styleColor.ts`); **Hear a taste** → `preview_style`; **Use this**; **Surprise me**. Inline inside the Brief, or standalone from `list_finetunes` (pick → `sendMessage("Use the "X" style…")`) | done |
| `composing` | `Composing.tsx` | Section timeline from `generate_composition_plan` filling with progress; stage words ("Performing…"); polls `get_render_status` every 3 s | done |
| `song` | `Player.tsx` | Section timeline as the scrub bar (`lib/sections.ts`), current-section sound tags, lyrics panel, Download (`&download=1`), Copy link, full-screen toggle; **variation chips** (`lib/variations.ts`) and **Different style** (inline Style strip) → `sendMessage`; **Versions rail** below (inline) or beside it (full screen) when the song has more than one take | done (Phase 4) |
| `failed` | inline in `Studio.tsx` | Error + **Try again** | done |
| `versions` | `Versions.tsx` | Every take, newest first (`lib/versions.ts`): mini player with a compact section timeline, the one-line difference from the previous take ("instrumental", "shorter, 0:30", "Rock style"), **Open** (→ `get_render_status`, shows it in the player), **Use this one** → `sendMessage('Use "<title>" (<difference>) as the song for <about>.')`. Standalone from `list_renders`, or as the rail inside Listen | done (Phase 4) |
| `preview` | — | Not a state: `preview_style`'s audio URL, consumed by the Style strip | done |

Host facts learned in Copilot (2026-11): tools without `annotations.readOnlyHint: true` get a
Confirm/Cancel prompt built from the tool description (so only `start_render`/`render_music` prompt,
and their first sentence is written for the user); Copilot renders only the **last** tool call's card
in a turn (the agent instructions therefore stop after the brief); `sendMessage` from the card works;
`requestDisplayMode("fullscreen")` works; the widget template is fetched without a user token.

## Phase 4 — built 2026-11-02, awaiting verification in Copilot

1. **Variation chips on the player** (`lib/variations.ts`): *Shorter* (songs over 20 s) · *Instrumental*
   (sung songs only) · *More energy* · *Extend to 60s* (songs under 55 s) · *Different style* (opens the
   Style strip; a pick sends `Make a version of "<title>" in the "<style>" style, keep everything else the
   same.`). Each sends one line via `sendMessage`; Copilot writes the brief with that change and starts the
   render in the same turn (agent instructions, step 5). Server: nothing new.
2. **Versions rail** (`components/Versions.tsx`, `lib/versions.ts`). Takes belong together when their
   "For:" line matches, else their title (case and punctuation ignored). `about` lives only in server
   memory, so after a restart the **title** is what links takes; the agent instructions tell Copilot to
   keep the title and `about` unchanged for a variation. Shown standalone for `list_renders`, and inside
   Listen when the song has more than one take (the card calls `list_renders` quietly once per song).
3. **Full-screen layout**: player + lyrics left, Versions rail right (`auto-fit` grid, so a narrow
   full screen stacks); max width 1280 px. `useAudio` is card-wide exclusive: playing a take pauses the
   big player and vice versa, which is what makes A/B listening work.
4. **Vocals chip**: fixed "Vocals: instrumental" (with a tooltip) for `podcast_voiceover_loop`,
   `video_game_action_loop` and `meditation_sleep`; Compose sends `force_instrumental` for those too.
5. **Agent polish** (`keepsong-copilot/appPackage/instruction.txt`): step 5 rewritten for the variation
   lines (same turn, same blueprint/finetune/narrative, keep title + about, `music_length_ms` for length);
   new step 6 for browsing versions and for the `Use "<title>" … as the song` pick. New conversation
   starter "Our songs so far". **Re-provision both agents** (dev and prod) to pick these up.
6. **Widget-host CORS**: the server now logs `CORS: first request from origin <origin> (allowed | not in
   CORS_ALLOWED_ORIGINS)` once per distinct origin (`src/http/cors.ts`). After the next deploy, read it
   with `az containerapp logs show -n keepsong-mcp -g ElevenLabsMusic --tail 200` and drop the unused
   entry. If the line never appears, the card makes no direct browser requests to the server (tool calls
   go through the host, audio loads without CORS) and either entry can go.
   **Finding (2026-11-02, dev tunnel inspector):** no request carries an `Origin` header. The card's tool
   calls reach the server from Copilot's backend, and audio loads through a plain `Audio` element (no
   `crossOrigin`), so CORS is not exercised today. To pick the entry to keep, read the card iframe's
   `src` host in the browser dev tools; it only starts to matter if the card ever uses `fetch` or Web
   Audio analysis (which needs `crossOrigin` audio) against this server.
   **Settled (2026-11-02):** the card's iframe in Copilot is served from `https://widget-renderer.usercontent.microsoft`,
   so the suffix is `.usercontent.microsoft`. Dev `.env` already lists only that form; drop the
   `.usercontent.microsoft.com` entry from prod's `CORS_ALLOWED_ORIGINS` (`az containerapp update --set-env-vars`).

**To verify in Copilot (dev agent):** make a song → tap *Instrumental* → Confirm → the new take
composes and lands with a two-row Versions rail → play each row (the other pauses) → full screen shows
the rail beside the player → *Use this one* → Copilot shows that take and confirms it. Also: a background
bed brief shows the fixed Vocals chip; "Show me the songs we've made so far" shows the standalone list.

Nice-to-haves after that: light/dark theme pass (Fluent tokens are used throughout; verify in Copilot's
dark theme), a `plan` state (section timeline for `generate_composition_plan` called on its own), and
persisting `renderJobs` progress/briefs on the `renders` row before scaling past one replica.

## Where things are

- Widget source: `widgets/src/` (Vite + React 18 + Fluent UI v9 → `assets/studio.html`, single file).
  `npm run build:widgets`; the server re-reads the file per request, so no restart in dev.
- Server side of the card: `src/mcp/ui.ts` (resource + CSP), `src/mcp/tools.ts` (`registerAppTool`,
  `toolUi(kind, …)`, `start_render`, `preview_style`, `list_renders`), `src/services/renderJobs.ts`
  (in-memory progress + briefs), `src/services/media.ts` + `GET /media/renders/:id` (signed audio).
- Tests: `test/unit/studio.test.ts` (tool wiring, async render, previews), `widgetSections.test.ts`,
  `widgetBlueprints.test.ts`.
