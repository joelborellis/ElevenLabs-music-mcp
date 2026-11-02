import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Caption1,
  FluentProvider,
  Spinner,
  Subtitle1,
  Text,
  tokens,
  webDarkTheme,
  webLightTheme,
} from "@fluentui/react-components";
import { Brief, type BriefPatch } from "./components/Brief";
import { Composing } from "./components/Composing";
import { Player } from "./components/Player";
import { StyleStrip } from "./components/StyleStrip";
import { Versions } from "./components/Versions";
import { alwaysInstrumental, renderLengthMs } from "./lib/blueprints";
import { parseSections, type Section } from "./lib/sections";
import { useThisOneMessage, versionsOf } from "./lib/versions";
import type { BriefData, FailedData, Finetune, Song } from "./types";
import { useStudioApp } from "./useStudioApp";

const POLL_MS = 3000;
const HISTORY_LIMIT = 30;

/**
 * Keepsong Studio: one card, several states, chosen by `structuredContent.kind`
 * of whichever tool result the host hands us: Brief → Composing → Listen, plus
 * the Style strip (standalone or inside the Brief / player) and Versions
 * (standalone from list_renders, or a rail inside Listen when the song has
 * more than one take — beside the player in full screen, for A/B listening).
 */
export function Studio() {
  const { app, data, theme, displayMode, isConnected, error, callTool, callToolQuiet, sendMessage } =
    useStudioApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ id: string; sections: Section[] } | null>(null);
  const [styles, setStyles] = useState<Finetune[] | null>(null); // null = strip closed
  const [history, setHistory] = useState<{ songId: string; songs: Song[] } | null>(null);
  const dark = theme === "dark";
  const songId = data?.kind === "song" ? data.id : null;

  // --- Composing: poll until the render is a song (or failed). get_render_status
  // is read-only, so Copilot runs it without a confirmation prompt.
  useEffect(() => {
    if (data?.kind !== "composing") return;
    const id = data.id;
    const timer = setInterval(() => {
      void callTool("get_render_status", { render_id: id }).catch(() => {
        /* transient; next tick retries */
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [data, callTool]);

  // --- Composing: fetch the structure once per render so it shows before audio exists.
  useEffect(() => {
    if (data?.kind !== "composing" || !data.prompt || plan?.id === data.id) return;
    const id = data.id;
    const prompt = data.prompt;
    const length = renderLengthMs(prompt, undefined);
    void callToolQuiet("generate_composition_plan", { prompt, ...(length ? { music_length_ms: length } : {}) })
      .then((result) => {
        if (result && result.kind === "plan") setPlan({ id, sections: parseSections(result as never) });
      })
      .catch(() => setPlan({ id, sections: [] })); // fall back to a plain progress bar
  }, [data, plan, callToolQuiet]);

  // A new state (or a different song) closes the strip.
  useEffect(() => {
    setStyles(null);
  }, [data?.kind, songId]);

  // --- Listen: load recent songs once per song, for its Versions rail. Quiet:
  // the rail is decoration, so a failure just leaves it out.
  useEffect(() => {
    if (!songId || history?.songId === songId) return;
    void callToolQuiet("list_renders", { limit: HISTORY_LIMIT })
      .then((result) => setHistory({ songId, songs: result?.kind === "versions" ? result.renders : [] }))
      .catch(() => setHistory({ songId, songs: [] }));
  }, [songId, history, callToolQuiet]);

  /** The current song's takes (newest first); the card's copy of it wins (it carries the brief). */
  const takes = useMemo(() => {
    if (data?.kind !== "song" || history?.songId !== data.id) return [];
    return versionsOf(data, history.songs.filter((s) => s.id !== data.id));
  }, [data, history]);

  const run = useCallback(async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, []);

  // --- Brief actions.
  const regenerate = (brief: BriefData, patch: BriefPatch) => {
    const input = brief.input_parameters ?? {};
    setStyles(null);
    void run("Rewriting the brief…", () =>
      callTool("generate_music_prompt", {
        project_blueprint: input.project_blueprint ?? "standalone_song_mini",
        finetune_id: brief.finetune_id,
        delivery_and_control: input.delivery_and_control ?? "balanced_studio",
        instrumental_only: input.instrumental_only ?? false,
        user_narrative: input.user_narrative ?? null,
        ...patch,
      }),
    );
  };

  const compose = (brief: BriefData) => {
    const input = brief.input_parameters ?? {};
    const length = renderLengthMs(brief.prompt, input.project_blueprint);
    void run("Starting the session…", () =>
      callTool("start_render", {
        prompt: brief.prompt,
        finetune_id: brief.finetune_id,
        title: brief.title ?? null,
        description: brief.description ?? null,
        about: brief.about ?? null,
        force_instrumental: input.instrumental_only === true || alwaysInstrumental(input.project_blueprint),
        ...(length ? { music_length_ms: length } : {}),
      }),
    );
  };

  const retry = (failed: FailedData) => {
    if (!failed.prompt) return;
    void run("Trying again…", () =>
      callTool("start_render", {
        prompt: failed.prompt,
        finetune_id: failed.finetune_id ?? null,
        title: failed.title ?? null,
        description: failed.description ?? null,
        about: failed.about ?? null,
      }),
    );
  };

  // --- Styles.
  const openStyles = () => {
    if (styles) {
      setStyles(null);
      return;
    }
    setStyles([]); // loading
    callToolQuiet("list_finetunes", {})
      .then((result) => setStyles(result?.kind === "styles" ? result.finetunes : null))
      .catch((err) => {
        setStyles(null);
        setNotice(err instanceof Error ? err.message : String(err));
      });
  };

  const taste = useCallback(
    async (style: Finetune): Promise<string | null> => {
      const result = await callToolQuiet("preview_style", { finetune_id: style.id });
      return result?.kind === "preview" ? (result.audio_url ?? null) : null;
    },
    [callToolQuiet],
  );

  const nudge = app?.sendMessage
    ? (text: string) => {
        void sendMessage(text).then((ok) => {
          if (!ok) setNotice("Copilot didn't accept the message. Type it in the chat instead.");
        });
      }
    : null;

  /** Versions: "Use this one" tells Copilot which take is the song. */
  const useTake = nudge
    ? (song: Song, line: string) => nudge(useThisOneMessage(song, line))
    : null;

  /** Versions: open a take in the big player (read-only, no prompt). */
  const openTake = (song: Song) => {
    void run("Opening…", () => callTool("get_render_status", { render_id: song.id }));
  };

  /** Standalone strip (from list_finetunes): the pick goes back to the conversation. */
  const pickStandalone = (style: Finetune) => {
    const text = `Use the "${style.name ?? style.id}" style for the song.`;
    if (nudge) nudge(text);
    else setNotice(`Tell Copilot: ${text}`);
  };

  const fullscreen = displayMode === "fullscreen";
  const rail = takes.length > 1;
  const sideBySide = fullscreen && data?.kind === "song" && rail;
  const heading = data?.kind === "styles" ? "Pick a sound" : data?.kind === "versions" ? "Your songs" : "Keepsong Studio";

  return (
    <FluentProvider theme={dark ? webDarkTheme : webLightTheme} style={{ background: "transparent" }}>
      <div
        style={{
          padding: fullscreen ? 24 : 16,
          maxWidth: fullscreen ? (sideBySide ? 1280 : 960) : undefined,
          margin: fullscreen ? "0 auto" : undefined,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {(!data || data.kind === "styles" || data.kind === "versions" || data.kind === "plan") && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Subtitle1>{heading}</Subtitle1>
            {(!data || data.kind === "plan") && (
              <Badge appearance="tint">{data?.kind ?? (isConnected ? "ready" : "connecting")}</Badge>
            )}
          </div>
        )}
        {error && <Text style={{ color: tokens.colorPaletteRedForeground1 }}>{error.message}</Text>}
        {notice && <Text style={{ color: tokens.colorPaletteRedForeground1 }}>{notice}</Text>}
        {busy && (data?.kind === "song" || data?.kind === "versions") && <Spinner size="tiny" label={busy} />}

        {!data ? (
          isConnected ? (
            <Caption1>Waiting for Copilot…</Caption1>
          ) : (
            <Spinner size="tiny" label="Connecting" />
          )
        ) : data.kind === "brief" ? (
          <Brief
            data={data}
            busy={busy}
            onRegenerate={(patch) => regenerate(data, patch)}
            onCompose={() => compose(data)}
            onNudge={nudge}
            styles={styles}
            onOpenStyles={openStyles}
            onTaste={taste}
            dark={dark}
          />
        ) : data.kind === "composing" ? (
          <Composing data={data} sections={plan?.id === data.id ? plan.sections : null} />
        ) : data.kind === "song" ? (
          <div
            style={
              sideBySide
                ? { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24, alignItems: "start" }
                : { display: "flex", flexDirection: "column", gap: 16 }
            }
          >
            <Player
              song={data}
              app={app}
              displayMode={displayMode}
              onVariation={nudge}
              styles={styles}
              onOpenStyles={openStyles}
              onTaste={taste}
              dark={dark}
            />
            {rail && (
              <Versions
                songs={takes}
                currentId={data.id}
                onUse={useTake}
                onOpen={busy ? undefined : openTake}
                heading="Versions"
                compact={sideBySide}
              />
            )}
          </div>
        ) : data.kind === "failed" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Subtitle1 block>{data.title || "That one didn't work"}</Subtitle1>
            <Text style={{ color: tokens.colorPaletteRedForeground1 }}>{data.error ?? "The render failed."}</Text>
            <div>
              <Button appearance="primary" onClick={() => retry(data)} disabled={busy !== null || !data.prompt}>
                {busy ?? "Try again"}
              </Button>
            </div>
          </div>
        ) : data.kind === "styles" ? (
          <StyleStrip styles={data.finetunes} dark={dark} onTaste={taste} onPick={pickStandalone} pickLabel="Use this" />
        ) : data.kind === "versions" ? (
          <Versions songs={data.renders} onUse={useTake} onOpen={busy ? undefined : openTake} />
        ) : (
          <Caption1>Received: {data.kind}</Caption1>
        )}
      </div>
    </FluentProvider>
  );
}
