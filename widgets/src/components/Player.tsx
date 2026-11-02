import { useMemo, useState } from "react";
import {
  Badge,
  Body1,
  Button,
  Caption1,
  Input,
  Subtitle1,
  Text,
  Tooltip,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowDownload20Regular,
  FullScreenMaximize20Regular,
  FullScreenMinimize20Regular,
  Link20Regular,
  Pause24Filled,
  Play24Filled,
} from "@fluentui/react-icons";
import type { App } from "@modelcontextprotocol/ext-apps/react";
import { formatTime, parseSections, sectionAt } from "../lib/sections";
import type { Song } from "../types";
import { useAudio } from "../useAudio";
import { SectionTimeline } from "./SectionTimeline";

interface Props {
  song: Song;
  app: App | null;
  displayMode: string;
}

/** The Listen state: structure-as-scrub-bar player, lyrics, download. */
export function Player({ song, app, displayMode }: Props) {
  const sections = useMemo(() => parseSections(song.composition_plan), [song.composition_plan]);
  const { playing, timeMs, durationMs, error, toggle, seek } = useAudio(song.audio_url);
  const [copied, setCopied] = useState(false);
  const [showUrl, setShowUrl] = useState(false);

  const meta = song.song_metadata ?? {};
  const title = song.title || meta.title || "Your song";
  const description = meta.description;
  const genres = Array.isArray(meta.genres) ? meta.genres.slice(0, 3) : [];
  const total = durationMs || song.duration_ms || 0;
  const current = sectionAt(sections, timeMs);
  const hasLyrics = sections.some((s) => s.lyrics);
  const fullscreen = displayMode === "fullscreen";

  const download = () => {
    if (!song.audio_url) return;
    const url = `${song.audio_url}&download=1`;
    if (app?.openLink) void app.openLink({ url });
    else window.open(url, "_blank", "noopener");
  };

  const copyLink = async () => {
    if (!song.audio_url) return;
    try {
      await navigator.clipboard.writeText(song.audio_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShowUrl(true); // sandboxed iframes may deny clipboard access
    }
  };

  const toggleFullscreen = () => {
    if (!app?.requestDisplayMode) return;
    void app.requestDisplayMode({ mode: fullscreen ? "inline" : "fullscreen" });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Subtitle1 block>{title}</Subtitle1>
          {description && (
            <Body1 block style={{ color: tokens.colorNeutralForeground2 }}>
              {description}
            </Body1>
          )}
        </div>
        {app?.requestDisplayMode && (
          <Tooltip content={fullscreen ? "Exit full screen" : "Full screen"} relationship="label">
            <Button
              appearance="subtle"
              icon={fullscreen ? <FullScreenMinimize20Regular /> : <FullScreenMaximize20Regular />}
              onClick={toggleFullscreen}
            />
          </Tooltip>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {total > 0 && <Badge appearance="tint">{formatTime(total)}</Badge>}
        {song.finetune_name && <Badge appearance="tint" color="brand">{song.finetune_name}</Badge>}
        {genres.map((g) => (
          <Badge key={g} appearance="outline">
            {g}
          </Badge>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <Button
          appearance="primary"
          shape="circular"
          size="large"
          icon={playing ? <Pause24Filled /> : <Play24Filled />}
          onClick={toggle}
          disabled={!song.audio_url}
          aria-label={playing ? "Pause" : "Play"}
        />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {sections.length > 0 ? (
            <SectionTimeline sections={sections} timeMs={timeMs} onSeek={seek} height={fullscreen ? 44 : 28} />
          ) : (
            <SectionTimeline
              sections={[{ index: 0, label: "", lyrics: "", startMs: 0, durationMs: total || 1, styles: [] }]}
              timeMs={timeMs}
              onSeek={seek}
              labels={false}
            />
          )}
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
              {current ? current.label : ""}
              {current?.styles.length ? ` · ${current.styles.slice(0, 2).join(" · ")}` : ""}
            </Caption1>
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
              {formatTime(timeMs)} / {formatTime(total)}
            </Caption1>
          </div>
        </div>
      </div>

      {error && <Text style={{ color: tokens.colorPaletteRedForeground1 }}>{error}</Text>}

      {hasLyrics && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: 12,
            borderRadius: 8,
            background: tokens.colorNeutralBackground2,
            maxHeight: fullscreen ? "none" : 180,
            overflowY: "auto",
          }}
        >
          {sections
            .filter((s) => s.lyrics)
            .map((s) => (
              <div key={s.index}>
                <Caption1 block style={{ color: current?.index === s.index ? tokens.colorBrandForeground1 : tokens.colorNeutralForeground3 }}>
                  {s.label}
                </Caption1>
                <Body1 block style={{ whiteSpace: "pre-line" }}>
                  {s.lyrics}
                </Body1>
              </div>
            ))}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <Button icon={<ArrowDownload20Regular />} onClick={download} disabled={!song.audio_url}>
          Download
        </Button>
        <Button icon={<Link20Regular />} onClick={() => void copyLink()} disabled={!song.audio_url}>
          {copied ? "Copied" : "Copy link"}
        </Button>
        {showUrl && song.audio_url && (
          <Input readOnly value={song.audio_url} style={{ flex: 1, minWidth: 200 }} onFocus={(e) => e.target.select()} />
        )}
      </div>
    </div>
  );
}
