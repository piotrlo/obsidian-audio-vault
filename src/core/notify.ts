import type { TtsSettings } from "../types";

/**
 * Show a user Notice only if important, otherwise only when debug logs are enabled.
 */
export function notify(settings: TtsSettings | undefined, msg: string, important: boolean = false): void {
  if (!(important || settings?.debugLogs)) return;
  try {
    // Fire-and-forget dynamic import to avoid hard runtime dependency in tests
    void import("obsidian").then((mod) => {
      try { new mod.Notice(msg); } catch {}
    }).catch(() => {});
  } catch {}
}


