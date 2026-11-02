import { useEffect } from "react";
import {
  Badge,
  Body1,
  Caption1,
  FluentProvider,
  ProgressBar,
  Spinner,
  Subtitle1,
  Text,
  tokens,
  webDarkTheme,
  webLightTheme,
} from "@fluentui/react-components";
import type { App } from "@modelcontextprotocol/ext-apps/react";
import { Player } from "./components/Player";
import { useStudioApp } from "./useStudioApp";
import type { StudioData } from "./types";

const POLL_MS = 3000;

/**
 * Keepsong Studio: one card, several states, chosen by `structuredContent.kind`
 * of whichever tool result the host hands us. Listen (`song`) is the real
 * thing; the other states are still placeholders until their phase lands.
 */
export function Studio() {
  const { app, data, theme, displayMode, isConnected, error, callTool } = useStudioApp();

  // While a render is in flight, keep asking the server until it is a song (or failed).
  // get_render_status is read-only, so Copilot runs it without a confirmation prompt.
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

  const fullscreen = displayMode === "fullscreen";

  return (
    <FluentProvider theme={theme === "dark" ? webDarkTheme : webLightTheme} style={{ background: "transparent" }}>
      <div
        style={{
          padding: fullscreen ? 24 : 16,
          maxWidth: fullscreen ? 960 : undefined,
          margin: fullscreen ? "0 auto" : undefined,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {data?.kind !== "song" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Subtitle1>Keepsong Studio</Subtitle1>
            <Badge appearance="tint">{data?.kind ?? (isConnected ? "ready" : "connecting")}</Badge>
          </div>
        )}
        {error && <Text style={{ color: tokens.colorPaletteRedForeground1 }}>{error.message}</Text>}
        <Body data={data} connected={isConnected} app={app} displayMode={displayMode} />
      </div>
    </FluentProvider>
  );
}

function Body({
  data,
  connected,
  app,
  displayMode,
}: {
  data: StudioData | null;
  connected: boolean;
  app: App | null;
  displayMode: string;
}) {
  if (!data) {
    return connected ? <Caption1>Waiting for Copilot…</Caption1> : <Spinner size="tiny" label="Connecting" />;
  }
  switch (data.kind) {
    case "song":
      return <Player song={data} app={app} displayMode={displayMode} />;
    case "brief":
      return (
        <>
          <Subtitle1>{data.title ?? "Untitled"}</Subtitle1>
          {data.description && <Body1>{data.description}</Body1>}
          <Caption1>Style: {data.finetune_name ?? data.finetune_id}</Caption1>
        </>
      );
    case "styles":
      return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {data.finetunes.map((f) => (
            <Badge key={f.id} appearance="outline" size="large">
              {f.name ?? f.id}
            </Badge>
          ))}
        </div>
      );
    case "composing":
      return (
        <>
          <Body1>{data.title ?? "Your song is taking shape"}</Body1>
          <ProgressBar value={(data.progress?.percent ?? 5) / 100} />
          <Caption1>
            {data.progress?.message ?? "Starting…"}
            {data.progress ? ` · ${data.progress.percent}%` : ""}
          </Caption1>
        </>
      );
    case "failed":
      return (
        <Text style={{ color: tokens.colorPaletteRedForeground1 }}>
          Render failed: {data.error ?? "unknown error"}
        </Text>
      );
    case "versions":
      return <Caption1>{data.renders.length} song(s)</Caption1>;
    default:
      return <Caption1>Received: {data.kind}</Caption1>;
  }
}
