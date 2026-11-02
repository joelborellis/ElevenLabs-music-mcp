import { useMemo, useState } from "react";
import { Badge, Body1Strong, Button, Caption1, Subtitle2, Text, Tooltip, tokens } from "@fluentui/react-components";
import { Checkmark16Regular, Open16Regular, Pause16Filled, Play16Filled } from "@fluentui/react-icons";
import { formatTime, parseSections, type Section } from "../lib/sections";
import { previousVersion, songTitle, versionLine } from "../lib/versions";
import type { Song } from "../types";
import { useAudio } from "../useAudio";
import { SectionTimeline } from "./SectionTimeline";

interface Props {
  /** The rows to show, newest first. */
  songs: Song[];
  /** Everything known (for "what changed since the previous version"); defaults to `songs`. */
  history?: Song[];
  /** The song open in the player, marked "In the player" (Listen rail only). */
  currentId?: string | null;
  /** "Use this one": sends the pick to Copilot; null when the host can't send messages. */
  onUse: ((song: Song, line: string) => void) | null;
  /** Opens the song in the big player. */
  onOpen?: (song: Song) => void;
  /** Heading; omit for none. */
  heading?: string;
  /** Narrow rail (full-screen side column) vs. the standalone list. */
  compact?: boolean;
}

/**
 * The Versions rail: every take of the song, newest first, each with a mini
 * player, the one thing that changed, and "Use this one". Only one row plays at
 * a time, and starting a row pauses the big player (useAudio is card-wide exclusive).
 */
export function Versions({ songs, history, currentId, onUse, onOpen, heading, compact }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const audio = useAudio(src, { autoPlay: true });
  const all = history ?? songs;

  const rows = useMemo(
    () =>
      songs.map((song) => ({
        song,
        line: versionLine(song, previousVersion(song, all)),
        sections: sectionsOrBar(song),
      })),
    [songs, all],
  );

  const play = (song: Song) => {
    if (!song.audio_url) return;
    if (activeId === song.id && src) {
      audio.toggle();
      return;
    }
    setActiveId(song.id);
    setSrc(song.audio_url);
  };

  if (songs.length === 0) {
    return <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>No songs yet — make one and it shows up here.</Caption1>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {heading && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Subtitle2>{heading}</Subtitle2>
          <Badge appearance="tint">{songs.length}</Badge>
        </div>
      )}
      {audio.error && <Text style={{ color: tokens.colorPaletteRedForeground1 }}>{audio.error}</Text>}
      {rows.map(({ song, line, sections }) => {
        const active = activeId === song.id;
        const playing = active && audio.playing;
        const current = song.id === currentId;
        return (
          <div
            key={song.id}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: 10,
              borderRadius: 8,
              background: tokens.colorNeutralBackground2,
              outline: current ? `2px solid ${tokens.colorBrandStroke1}` : "none",
              outlineOffset: -2,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Button
                size="small"
                shape="circular"
                appearance={playing ? "primary" : "secondary"}
                icon={playing ? <Pause16Filled /> : <Play16Filled />}
                onClick={() => play(song)}
                disabled={!song.audio_url}
                aria-label={playing ? `Pause ${songTitle(song)}` : `Play ${songTitle(song)}`}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Body1Strong block truncate wrap={false}>
                  {songTitle(song)}
                </Body1Strong>
                <Caption1 block truncate wrap={false} style={{ color: tokens.colorNeutralForeground3 }}>
                  {[line, !compact && song.about ? `For: ${song.about}` : null].filter(Boolean).join(" — ")}
                </Caption1>
              </div>
              {current && (
                <Badge appearance="tint" color="brand" size="small">
                  In the player
                </Badge>
              )}
              {onOpen && !current && (
                <Tooltip content="Open in the player" relationship="label">
                  <Button size="small" appearance="subtle" icon={<Open16Regular />} onClick={() => onOpen(song)} />
                </Tooltip>
              )}
            </div>
            <SectionTimeline
              sections={sections}
              timeMs={active ? audio.timeMs : 0}
              onSeek={active ? audio.seek : undefined}
              height={8}
              labels={false}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
                {active ? `${formatTime(audio.timeMs)} / ` : ""}
                {formatTime(song.duration_ms ?? 0)}
              </Caption1>
              {onUse && (
                <Button size="small" shape="circular" icon={<Checkmark16Regular />} onClick={() => onUse(song, line)}>
                  Use this one
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The song's sections, or one block spanning it when there's no plan. */
function sectionsOrBar(song: Song): Section[] {
  const sections = parseSections(song.composition_plan);
  if (sections.length > 0) return sections;
  return [{ index: 0, label: "", lyrics: "", startMs: 0, durationMs: song.duration_ms || 1, styles: [] }];
}
