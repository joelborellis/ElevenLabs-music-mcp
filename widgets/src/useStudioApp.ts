import { useCallback, useEffect, useState } from "react";
import { useApp, type App } from "@modelcontextprotocol/ext-apps/react";
import type { StudioData } from "./types";

type ToolResultLike = {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
};

/** structuredContent when present, else the JSON text block older hosts send. */
export function dataFromResult(result: ToolResultLike): StudioData | null {
  const structured = result.structuredContent as { kind?: unknown } | undefined;
  if (structured && typeof structured.kind === "string") return structured as StudioData;
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { kind?: unknown };
    return typeof parsed.kind === "string" ? (parsed as StudioData) : null;
  } catch {
    return null;
  }
}

function errorText(result: ToolResultLike): string {
  return result.content?.find((c) => c.type === "text")?.text ?? "The server reported an error.";
}

/**
 * Connects to the host (Copilot), tracks the latest tool result as card data,
 * and exposes the host theme. Handlers are attached in onAppCreated so the
 * initial tool result — which arrives right after connect() — is never missed.
 */
export function useStudioApp() {
  const [data, setData] = useState<StudioData | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [displayMode, setDisplayMode] = useState<string>("inline");

  const { app, isConnected, error } = useApp({
    appInfo: { name: "Keepsong Studio", version: "0.2.0" },
    capabilities: {},
    onAppCreated: (created: App) => {
      created.ontoolresult = (result) => {
        const next = dataFromResult(result as ToolResultLike);
        if (next) setData(next);
      };
      created.onhostcontextchanged = (ctx) => {
        if (ctx.theme) setTheme(ctx.theme);
        if (ctx.displayMode) setDisplayMode(ctx.displayMode);
      };
    },
  });

  useEffect(() => {
    if (!isConnected || !app) return;
    const ctx = app.getHostContext();
    if (ctx?.theme) setTheme(ctx.theme);
    if (ctx?.displayMode) setDisplayMode(ctx.displayMode);
  }, [app, isConnected]);

  /** Call a server tool and return its card data WITHOUT showing it (e.g. a plan fetched for the timeline). */
  const callToolQuiet = useCallback(
    async (name: string, args: Record<string, unknown> = {}): Promise<StudioData | null> => {
      if (!app) throw new Error("Not connected to the host yet.");
      const result = (await app.callServerTool({ name, arguments: args })) as ToolResultLike;
      if (result.isError) throw new Error(errorText(result));
      return dataFromResult(result);
    },
    [app],
  );

  /** Call a server tool and, when it returns card data, show it. */
  const callTool = useCallback(
    async (name: string, args: Record<string, unknown> = {}): Promise<StudioData | null> => {
      const next = await callToolQuiet(name, args);
      if (next) setData(next);
      return next;
    },
    [callToolQuiet],
  );

  /** Put a message into the conversation as the user (nudges, "use this one"). False if unsupported. */
  const sendMessage = useCallback(
    async (text: string): Promise<boolean> => {
      if (!app?.sendMessage) return false;
      try {
        const result = await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
        return !result.isError;
      } catch {
        return false;
      }
    },
    [app],
  );

  return { app, isConnected, error, data, setData, theme, displayMode, callTool, callToolQuiet, sendMessage };
}
