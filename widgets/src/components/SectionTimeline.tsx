import { Caption1, tokens } from "@fluentui/react-components";
import type { Section } from "../lib/sections";
import { totalDuration } from "../lib/sections";

interface Props {
  sections: Section[];
  /** Playhead position; omit for a static (non-playing) timeline. */
  timeMs?: number;
  /** Clicking a section seeks to its start. */
  onSeek?: (ms: number) => void;
  /** Block height in px. */
  height?: number;
  /** Show the section labels under the blocks. */
  labels?: boolean;
}

/**
 * The song's structure as proportional blocks — intro / verse / chorus sized
 * by duration — doubling as the scrub bar: each block fills with the brand
 * colour as the playhead moves through it.
 */
export function SectionTimeline({ sections, timeMs = 0, onSeek, height = 28, labels = true }: Props) {
  const total = totalDuration(sections);
  if (sections.length === 0 || total === 0) return null;

  return (
    <div style={{ display: "flex", gap: 3, width: "100%" }}>
      {sections.map((section) => {
        const width = (section.durationMs / total) * 100;
        const fill = Math.min(1, Math.max(0, (timeMs - section.startMs) / Math.max(1, section.durationMs)));
        const active = fill > 0 && fill < 1;
        return (
          <div
            key={section.index}
            style={{ flex: `0 0 ${width}%`, minWidth: 0, cursor: onSeek ? "pointer" : "default" }}
            onClick={onSeek ? () => onSeek(section.startMs) : undefined}
            title={[section.label, ...section.styles.slice(0, 4)].join(" · ")}
            role={onSeek ? "button" : undefined}
          >
            <div
              style={{
                position: "relative",
                height,
                borderRadius: 6,
                overflow: "hidden",
                background: tokens.colorNeutralBackground3,
                outline: active ? `2px solid ${tokens.colorBrandStroke1}` : "none",
                outlineOffset: -2,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  width: `${fill * 100}%`,
                  background: tokens.colorBrandBackground,
                  transition: "width 120ms linear",
                }}
              />
            </div>
            {labels && (
              <Caption1
                block
                truncate
                wrap={false}
                style={{ marginTop: 4, color: tokens.colorNeutralForeground3, textAlign: "center" }}
              >
                {section.label}
              </Caption1>
            )}
          </div>
        );
      })}
    </div>
  );
}
