import { Notice } from "obsidian";
import type { TtsSettings } from "../types";

/**
 * Show a user Notice only if important, otherwise only when debug logs are enabled.
 */
export function notify(settings: TtsSettings | undefined, msg: string, important: boolean = false): void {
  if (!(important || settings?.debugLogs)) return;
  new Notice(msg);
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


