import { isInstrumental, songTitle } from "./versions";
import type { Song } from "../types";

export interface Variation {
  label: string;
  /** Sent to Copilot as the user; Copilot rewrites the brief with this one change and renders. */
  message: string;
}

const KEEP = "keep everything else the same";

/**
 * One-tap variations on the player. Each is a single follow-up line for the
 * conversation — the card never rebuilds tool inputs itself. Chips that would
 * be no-ops for this song (Instrumental on an instrumental, Extend on a long
 * song, Shorter on a sting) are left out. "Different style" is not here: the
 * card opens the Style strip for it and sends styleMessage() on a pick.
 */
export function variationsFor(song: Song): Variation[] {
  const title = songTitle(song);
  const length = song.duration_ms ?? 0;
  const chips: Variation[] = [];
  if (length === 0 || length > 20_000) {
    chips.push({ label: "Shorter", message: `Make a shorter version of "${title}", ${KEEP}.` });
  }
  if (isInstrumental(song) === false) {
    chips.push({ label: "Instrumental", message: `Make "${title}" instrumental, ${KEEP}.` });
  }
  chips.push({ label: "More energy", message: `Make "${title}" with more energy, ${KEEP}.` });
  if (length === 0 || length < 55_000) {
    chips.push({ label: "Extend to 60s", message: `Extend "${title}" to 60 seconds, ${KEEP}.` });
  }
  return chips;
}

export function styleMessage(song: Song, styleName: string): string {
  return `Make a version of "${songTitle(song)}" in the "${styleName}" style, ${KEEP}.`;
}
