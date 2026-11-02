/**
 * Shapes of `structuredContent` the server sends (src/mcp/tools.ts, toolUi()).
 * `kind` picks the card state. Kept loose on purpose: the card must keep
 * working when the server adds fields.
 */
export type StudioKind = "brief" | "styles" | "plan" | "composing" | "song" | "failed" | "versions";

export interface Progress {
  stage: string;
  percent: number;
  message: string;
}

export interface Finetune {
  id: string;
  name?: string | null;
  tags?: string[];
  primary_genre?: string | null;
  status?: string | null;
}

/** Result of preview_style (never shown as a card state; consumed by the Style strip). */
export interface PreviewData {
  kind: "preview";
  finetune_id: string;
  audio_url?: string | null;
  duration_ms?: number | null;
  cached?: boolean;
}

export interface SongMetadata {
  title?: string;
  description?: string;
  genres?: string[];
  languages?: string[];
  [key: string]: unknown;
}

export interface Song {
  id: string;
  title?: string | null;
  prompt?: string | null;
  description?: string | null;
  about?: string | null;
  audio_url?: string | null;
  duration_ms?: number | null;
  finetune_id?: string | null;
  finetune_name?: string | null;
  composition_plan?: {
    chunks?: Array<{ text?: string; duration_ms?: number; positive_styles?: string[] }>;
  } | null;
  song_metadata?: SongMetadata | null;
  timestamp?: string;
}

export interface BriefInput {
  project_blueprint?: string;
  delivery_and_control?: string;
  instrumental_only?: boolean;
  user_narrative?: string | null;
}

export interface BriefData {
  kind: "brief";
  prompt: string;
  title?: string | null;
  description?: string | null;
  about?: string | null;
  finetune_id: string;
  finetune_name?: string | null;
  input_parameters?: BriefInput;
}

export interface StylesData {
  kind: "styles";
  finetunes: Finetune[];
}

export interface ComposingData extends Partial<Song> {
  kind: "composing";
  id: string;
  status: "processing";
  progress?: Progress | null;
}

export interface FailedData extends Partial<Song> {
  kind: "failed";
  id: string;
  error?: string | null;
}

export interface SongData extends Song {
  kind: "song";
}

export interface VersionsData {
  kind: "versions";
  renders: Song[];
}

export type StudioData =
  | BriefData
  | StylesData
  | ComposingData
  | FailedData
  | SongData
  | VersionsData
  | PreviewData
  | { kind: "plan"; [key: string]: unknown };

declare global {
  interface Window {
    __KEEPSONG_BASE_URL__?: string;
  }
}
