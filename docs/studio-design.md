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
| `brief` | `Brief.tsx` | Title, description, "For:" line; **Use** / **Vocals** / **Style** flip-chips (re-run `generate_music_prompt` from the card); direction preview; **Compose** (`start_render` from the card); nudge chips → `sendMessage` | done |
| `styles` | `StyleStrip.tsx` | One mood card per finetune (hue from genre family, `lib/styleColor.ts`); **Hear a taste** → `preview_style`; **Use this**; **Surprise me**. Inline inside the Brief, or standalone from `list_finetunes` (pick → `sendMessage("Use the "X" style…")`) | done |
| `composing` | `Composing.tsx` | Section timeline from `generate_composition_plan` filling with progress; stage words ("Performing…"); polls `get_render_status` every 3 s | done |
| `song` | `Player.tsx` | Section timeline as the scrub bar (`lib/sections.ts`), current-section sound tags, lyrics panel, Download (`&download=1`), Copy link, full-screen toggle | done |
| `failed` | inline in `Studio.tsx` | Error + **Try again** | done |
| `versions` | — | Versions rail (placeholder: count only) | **Phase 4** |
| `preview` | — | Not a state: `preview_style`'s audio URL, consumed by the Style strip | done |

Host facts learned in Copilot (2026-11): tools without `annotations.readOnlyHint: true` get a
Confirm/Cancel prompt built from the tool description (so only `start_render`/`render_music` prompt,
and their first sentence is written for the user); Copilot renders only the **last** tool call's card
in a turn (the agent instructions therefore stop after the brief); `sendMessage` from the card works;
`requestDisplayMode("fullscreen")` works; the widget template is fetched without a user token.

## Phase 4 — what's left (not started)

1. **Variation chips on the player**: *Shorter* · *Instrumental* · *More energy* · *Different style* ·
   *Extend to 60s*. Each sends a one-line follow-up via `sendMessage` (e.g. `Make "<title>" instrumental,
   keep everything else the same.`); Copilot rewrites the brief and starts a new render; the new song
   lands in the card. Server: nothing new (the agent instructions already describe variations).
2. **Versions rail** (`kind: versions`, tool `list_renders` already returns `audio_url`, `about`,
   `description`): newest first, mini player per row (reuse `useAudio` + a compact `SectionTimeline`),
   the one-line difference ("instrumental", "30s"), **Use this one** → `sendMessage("Use "<title>" as the
   song for …")`. Shown standalone when Copilot calls `list_renders`, and as a rail inside Listen when
   there is more than one song for the same `about`.
3. **Full-screen layout**: two columns in `displayMode === "fullscreen"` — player + lyrics left,
   Versions rail right (A/B listening); larger timeline (already 44 px).
4. **Vocals chip**: hide it (or show "instrumental" fixed) for `podcast_voiceover_loop`,
   `video_game_action_loop` and `meditation_sleep` — those blueprints are instrumental by definition,
   so the chip currently offers a choice the prompt can't honour.
5. **Agent polish** (`keepsong-copilot/appPackage/instruction.txt`): variations phrasing, and a line
   telling Copilot that a "Use "<title>" as the song" message is the user's pick from the Versions rail.
6. **Widget-host CORS**: check the card's browser console in prod to see whether Copilot's origin is
   `…usercontent.microsoft` or `…microsoft.com`, and drop the other from `CORS_ALLOWED_ORIGINS`
   (both are set for dev and prod).

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
