import { Notice } from "obsidian";
import type { TtsSettings } from "../types";

/**
 * Show a user Notice only if important, otherwise only when debug logs are enabled.
 */
export function notify(settings: TtsSettings | undefined, msg: string, important: boolean = false): void {
  if (important || settings?.debugLogs) {
    try { new Notice(msg); } catch {}
  }
}


