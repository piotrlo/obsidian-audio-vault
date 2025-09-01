import type { TtsSettings } from "../types";

/**
 * Show a user Notice only if important, otherwise only when debug logs are enabled.
 */
export function notify(settings: TtsSettings | undefined, msg: string, important: boolean = false): void {
  if (!(important || settings?.debugLogs)) return;
  // Prefer CJS require when available (plugin runtime), fallback to dynamic import.
  try {
     
    const mod = require("obsidian");
    try { new mod.Notice(msg); return; } catch {}
  } catch {}
  try {
    void import("obsidian").then((mod) => {
      try { new mod.Notice(msg); } catch {}
    }).catch(() => {});
  } catch {}
}

/**
 * Notice: network paused; background downloads will continue from downloaded parts.
 */
export function backgroundPausedNotice(settings: TtsSettings | undefined): void {
  notify(settings, "Network paused; playback will continue from downloaded parts. Open Obsidian to resume downloads.", true);
}

/**
 * Notice: resumed background downloads on iOS.
 */
export function backgroundResumedNotice(settings: TtsSettings | undefined): void {
  notify(settings, "Resumed background downloads (iOS)", true);
}


