import { Body1, Caption1, ProgressBar, Subtitle1, tokens } from "@fluentui/react-components";
import { directionLines, stageWord } from "../lib/blueprints";
import type { Section } from "../lib/sections";
import { totalDuration } from "../lib/sections";
import type { ComposingData } from "../types";
import { SectionTimeline } from "./SectionTimeline";

interface Props {
  data: ComposingData;
  /** Sections from generate_composition_plan, once fetched; null while loading / unavailable. */
  sections: Section[] | null;
}

/**
 * Composing: make the wait a feature. The structure appears first (the plan is
 * free and fast), then fills in as the render progresses, with the stage in
 * producer's words and the brief's direction still on screen.
 */
export function Composing({ data, sections }: Props) {
  const percent = data.progress?.percent ?? 5;
  const total = sections ? totalDuration(sections) : 0;
  const lines = directionLines(data.prompt, 2);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <Subtitle1 block>{data.title || "Your song is taking shape"}</Subtitle1>
        {data.description && (
          <Body1 block style={{ color: tokens.colorNeutralForeground2 }}>
            {data.description}
          </Body1>
        )}
        {data.about && (
          <Caption1 block style={{ marginTop: 4, color: tokens.colorNeutralForeground3 }}>
            For: {data.about}
          </Caption1>
        )}
      </div>

      {sections && sections.length > 0 && total > 0 ? (
        <SectionTimeline sections={sections} timeMs={(percent / 100) * total} />
      ) : (
        <ProgressBar value={percent / 100} />
      )}

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Caption1 style={{ color: tokens.colorBrandForeground1 }}>{stageWord(data.progress?.stage)}…</Caption1>
        <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{percent}%</Caption1>
      </div>

      {lines.length > 0 && (
        <Caption1 block style={{ color: tokens.colorNeutralForeground3 }}>
          {lines.join(" ")}
        </Caption1>
      )}
      {data.finetune_name && (
        <Caption1 block style={{ color: tokens.colorNeutralForeground3 }}>
          Style: {data.finetune_name}
        </Caption1>
      )}
    </div>
  );
}
