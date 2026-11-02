import { useState } from "react";
import {
  Body1,
  Button,
  Caption1,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Spinner,
  Subtitle1,
  Tooltip,
  tokens,
} from "@fluentui/react-components";
import { ChevronDown12Regular, MusicNote2Play20Filled, Sparkle16Regular } from "@fluentui/react-icons";
import { directionLines, USES, useLabel } from "../lib/blueprints";
import type { BriefData, Finetune } from "../types";
import { StyleStrip } from "./StyleStrip";

export interface BriefPatch {
  project_blueprint?: string;
  instrumental_only?: boolean;
  finetune_id?: string;
}

interface Props {
  data: BriefData;
  /** Non-null while a server call is in flight (text is shown). */
  busy: string | null;
  onRegenerate: (patch: BriefPatch) => void;
  onCompose: () => void;
  /** Sends a follow-up to the conversation; null when the host can't. */
  onNudge: ((text: string) => void) | null;
  /** Style strip: null = closed, [] = loading, list = open. */
  styles: Finetune[] | null;
  onOpenStyles: () => void;
  onTaste: (style: Finetune) => Promise<string | null>;
  dark: boolean;
}

const NUDGES = ["More playful", "More cinematic", "More emotional", "Shorter and punchier"];

/**
 * The Brief: a producer's note, not a form. Flip-chips re-run the brief with
 * one change; Compose starts the render from the card; nudges go back to the
 * conversation so Copilot rewrites with the user's delta.
 */
export function Brief({ data, busy, onRegenerate, onCompose, onNudge, styles, onOpenStyles, onTaste, dark }: Props) {
  const [showAll, setShowAll] = useState(false);
  const input = data.input_parameters ?? {};
  const instrumental = input.instrumental_only === true;
  const lines = directionLines(data.prompt, 3);
  const disabled = busy !== null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, position: "relative" }}>
      <div>
        <Subtitle1 block>{data.title || "Untitled"}</Subtitle1>
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

      {/* Flip-chips: the three choices that matter, in human words. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <Button size="small" shape="circular" disabled={disabled} icon={<ChevronDown12Regular />} iconPosition="after">
              Use: {useLabel(input.project_blueprint)}
            </Button>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {USES.map((use) => (
                <MenuItem key={use.id} onClick={() => onRegenerate({ project_blueprint: use.id })}>
                  {use.label}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>

        <Button
          size="small"
          shape="circular"
          disabled={disabled}
          onClick={() => onRegenerate({ instrumental_only: !instrumental })}
        >
          Vocals: {instrumental ? "instrumental" : "sung"}
        </Button>

        <Tooltip content="Hear other styles and switch" relationship="description">
          <Button
            size="small"
            shape="circular"
            appearance={styles ? "primary" : "secondary"}
            disabled={disabled}
            icon={<ChevronDown12Regular />}
            iconPosition="after"
            onClick={onOpenStyles}
          >
            Style: {data.finetune_name ?? "chosen for you"}
          </Button>
        </Tooltip>
      </div>

      {styles && (
        <div style={{ padding: 12, borderRadius: 8, background: tokens.colorNeutralBackground2 }}>
          {styles.length === 0 ? (
            <Spinner size="tiny" label="Loading styles…" />
          ) : (
            <StyleStrip
              styles={styles}
              dark={dark}
              selectedId={data.finetune_id}
              onTaste={onTaste}
              onPick={(style) => onRegenerate({ finetune_id: style.id })}
              disabled={disabled}
            />
          )}
        </div>
      )}

      {/* Direction preview: what the music will do, from the prompt itself. */}
      {lines.length > 0 && (
        <div style={{ padding: 12, borderRadius: 8, background: tokens.colorNeutralBackground2 }}>
          <Caption1 block style={{ color: tokens.colorNeutralForeground3, marginBottom: 4 }}>
            Direction
          </Caption1>
          <Body1 block style={{ whiteSpace: "pre-line" }}>
            {showAll ? data.prompt : lines.join(" ")}
          </Body1>
          <Button appearance="transparent" size="small" onClick={() => setShowAll((v) => !v)} style={{ paddingLeft: 0 }}>
            {showAll ? "Show less" : "Show full direction"}
          </Button>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <Button appearance="primary" icon={<MusicNote2Play20Filled />} onClick={onCompose} disabled={disabled}>
          Compose
        </Button>
        {onNudge &&
          NUDGES.map((nudge) => (
            <Button
              key={nudge}
              size="small"
              shape="circular"
              appearance="subtle"
              icon={<Sparkle16Regular />}
              disabled={disabled}
              onClick={() => onNudge(`Rewrite the brief for "${data.title ?? "the song"}": ${nudge.toLowerCase()}. Keep everything else the same.`)}
            >
              {nudge}
            </Button>
          ))}
      </div>

      {busy && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: tokens.colorNeutralBackgroundAlpha2,
            borderRadius: 8,
          }}
        >
          <Spinner size="small" label={busy} />
        </div>
      )}
    </div>
  );
}
