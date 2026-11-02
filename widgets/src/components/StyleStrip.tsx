import { useState } from "react";
import { Badge, Body1Strong, Button, Caption1, Spinner, Text, tokens } from "@fluentui/react-components";
import { Checkmark16Regular, Pause16Filled, Play16Filled, Sparkle16Regular } from "@fluentui/react-icons";
import { hueFor, styleSurface } from "../lib/styleColor";
import type { Finetune } from "../types";
import { useAudio } from "../useAudio";

interface Props {
  styles: Finetune[];
  dark: boolean;
  selectedId?: string | null;
  /** Fetches (and caches) the 8-second taste; resolves to its audio URL. */
  onTaste: (style: Finetune) => Promise<string | null>;
  onPick: (style: Finetune) => void;
  pickLabel?: string;
  disabled?: boolean;
}

/**
 * The Style strip: one mood card per finetune. Hear a taste (one 8-second
 * sample per style, ever), then Use this — or Surprise me.
 */
export function StyleStrip({ styles, dark, selectedId, onTaste, onPick, pickLabel = "Use this", disabled }: Props) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audio = useAudio(src);
  const isPlaying = (id: string) => playingId === id && audio.playing;

  const taste = async (style: Finetune) => {
    if (playingId === style.id && src) {
      audio.toggle();
      return;
    }
    setError(null);
    setLoadingId(style.id);
    try {
      const url = await onTaste(style);
      if (!url) throw new Error("No sample came back.");
      setPlayingId(style.id);
      setSrc(url === src ? `${url}#${Date.now()}` : url); // force a fresh element on repeat
      // Playback starts once the new element is ready; the user tapped, so autoplay is allowed.
      setTimeout(() => audio.toggle(), 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingId(null);
    }
  };

  const surprise = () => {
    const pool = styles.filter((s) => s.id !== selectedId);
    const pick = pool[Math.floor(Math.random() * pool.length)] ?? styles[0];
    if (pick) onPick(pick);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
          Tap ▶ to hear an eight-second taste of each style.
        </Caption1>
        <Button size="small" appearance="subtle" icon={<Sparkle16Regular />} onClick={surprise} disabled={disabled}>
          Surprise me
        </Button>
      </div>
      {error && <Text style={{ color: tokens.colorPaletteRedForeground1 }}>{error}</Text>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10 }}>
        {styles.map((style) => {
          const { background, accent } = styleSurface(hueFor(style), dark);
          const selected = style.id === selectedId;
          const playing = isPlaying(style.id);
          return (
            <div
              key={style.id}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: 12,
                borderRadius: 10,
                background,
                borderLeft: `4px solid ${accent}`,
                outline: selected ? `2px solid ${tokens.colorBrandStroke1}` : "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Body1Strong style={{ flex: 1, minWidth: 0 }}>{style.name ?? style.id}</Body1Strong>
                {playing && <Meter color={accent} />}
              </div>
              {style.primary_genre && (
                <Caption1 style={{ color: tokens.colorNeutralForeground2 }}>{style.primary_genre}</Caption1>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {(style.tags ?? []).slice(0, 3).map((tag) => (
                  <Badge key={tag} size="small" appearance="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
                <Button
                  size="small"
                  shape="circular"
                  icon={loadingId === style.id ? <Spinner size="extra-tiny" /> : playing ? <Pause16Filled /> : <Play16Filled />}
                  onClick={() => void taste(style)}
                  disabled={disabled || loadingId !== null}
                  aria-label={playing ? "Pause taste" : "Hear a taste"}
                />
                <Button
                  size="small"
                  shape="circular"
                  appearance={selected ? "secondary" : "primary"}
                  icon={selected ? <Checkmark16Regular /> : undefined}
                  onClick={() => onPick(style)}
                  disabled={disabled || selected}
                >
                  {selected ? "Chosen" : pickLabel}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Four bouncing bars — keyframes live in studio.html. */
function Meter({ color }: { color: string }) {
  return (
    <span className="ks-meter" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} style={{ background: color, animationDelay: `${i * 0.12}s` }} />
      ))}
    </span>
  );
}
