import { formatTime, parseSections } from "./sections";
import type { Song } from "../types";

/**
 * Versions: songs that belong to the same project (same "For:" line, or the
 * same title) and how each one differs from the one before it.
 *
 * `about` and `description` live in the server's memory only (renderJobs.ts),
 * so after a restart the title is what still ties variations together — the
 * agent instructions ask Copilot to keep both unchanged for a variation.
 */

/** Lowercase, punctuation-free, single-spaced — so "Sprout launch!" matches "sprout launch". */
export function normalize(text: string | null | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function songTitle(song: Song): string {
  return song.title || song.song_metadata?.title || "Your song";
}

/** Same project: same non-empty "about", or same non-empty title. */
export function sameProject(a: Song, b: Song): boolean {
  const aboutA = normalize(a.about);
  const aboutB = normalize(b.about);
  if (aboutA && aboutA === aboutB) return true;
  const titleA = normalize(a.title || a.song_metadata?.title);
  const titleB = normalize(b.title || b.song_metadata?.title);
  return titleA !== "" && titleA === titleB;
}

/** No sung lines anywhere in the plan → instrumental. Unknown (no plan) → null. */
export function isInstrumental(song: Song): boolean | null {
  const sections = parseSections(song.composition_plan);
  if (sections.length === 0) return null;
  return !sections.some((s) => s.lyrics);
}

function newestFirst(songs: Song[]): Song[] {
  return [...songs].sort((a, b) => Date.parse(b.timestamp ?? "") - Date.parse(a.timestamp ?? "") || 0);
}

/** The versions of `song`'s project among `songs` (always including `song`), newest first. */
export function versionsOf(song: Song, songs: Song[]): Song[] {
  const group = songs.filter((s) => s.id === song.id || sameProject(s, song));
  if (!group.some((s) => s.id === song.id)) group.push(song);
  return newestFirst(group);
}

/** The version made just before `song` in the same project, if any. */
export function previousVersion(song: Song, songs: Song[]): Song | undefined {
  const group = versionsOf(song, songs);
  return group[group.findIndex((s) => s.id === song.id) + 1];
}

const LENGTH_TOLERANCE_MS = 3000;

/**
 * One line a producer would say about this version: what changed since the
 * previous one ("instrumental · shorter, 0:30"), or — for a first version —
 * what it is ("0:30 · Indie Dance · sung").
 */
export function versionLine(song: Song, previous?: Song): string {
  const vocals = isInstrumental(song);
  if (!previous) {
    return [
      song.duration_ms ? formatTime(song.duration_ms) : null,
      song.finetune_name,
      vocals === null ? null : vocals ? "instrumental" : "sung",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  const changes: string[] = [];
  const before = isInstrumental(previous);
  if (vocals !== null && before !== null && vocals !== before) changes.push(vocals ? "instrumental" : "with vocals");
  const now = song.duration_ms ?? 0;
  const then = previous.duration_ms ?? 0;
  if (now && then && Math.abs(now - then) > LENGTH_TOLERANCE_MS) {
    changes.push(`${now < then ? "shorter" : "longer"}, ${formatTime(now)}`);
  }
  if (song.finetune_id && previous.finetune_id && song.finetune_id !== previous.finetune_id) {
    changes.push(song.finetune_name ? `${song.finetune_name} style` : "new style");
  }
  return changes.length > 0 ? changes.join(" · ") : "new take";
}

/** The message "Use this one" sends to Copilot. Names the version so Copilot can find it. */
export function useThisOneMessage(song: Song, line: string): string {
  const detail = line && line !== "new take" ? ` (${line})` : "";
  const forWhat = song.about ? ` for ${song.about}` : "";
  return `Use "${songTitle(song)}"${detail} as the song${forWhat}.`;
}
