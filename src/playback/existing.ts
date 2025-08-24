/**
 * Playback of existing local audio parts without regeneration.
 */

import type { App, TAbstractFile } from "obsidian";
import type { PlaybackSession, TtsSettings } from "../types";
import { mimeFromFormat } from "../core/helpers";
import { fileExtFromFormat, playbackRateFromRateSetting } from "../core/helpers";
import { waitForEndOrAbort } from "../core/audio";
import { cleanupSessionResources as cleanupSessionResourcesHelper } from "./session";
import { notify as notifyUtil } from "../core/notify";

export async function tryPlayExistingParts(params: {
  app: App;
  settings: TtsSettings;
  base: string;
  folder: string;
  stopRequested: () => boolean;
  setSession: (s: PlaybackSession | null) => void;
}): Promise<boolean> {
  const { app, settings, base, folder, stopRequested, setSession } = params;

  // Prefer merged single MP3 if enabled and present
  if (settings.mergeParts && /mp3/i.test(settings.outputFormat)) {
    const mergedPath = `${folder}/${base}.mp3`;
    try {
      const exists = await app.vault.adapter.exists(mergedPath);
      if (exists) {
        const data = await app.vault.adapter.readBinary(mergedPath);
        const mime = mimeFromFormat(settings.outputFormat);
        const blob = new Blob([data], { type: mime });
        const url = URL.createObjectURL(blob);
        const audioEl = new Audio(url);
        audioEl.playbackRate = playbackRateFromRateSetting(settings.rate);
        const abort = new AbortController();
        const session: PlaybackSession = { abort, audioEl, mediaSource: null, sourceBuffer: null, lastBlob: blob, fileBase: base, objectUrl: url };
        setSession(session);
        try { notifyUtil(settings, "Rozpoczynam odtwarzanie istniejącego pliku (scalony)", true); } catch {}
        try { await audioEl.play(); } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          try { notifyUtil(settings, `Audio play failed (existing merged): ${msg}`); } catch {}
        }
        await waitForEndOrAbort(audioEl, abort.signal);
        await cleanupSessionResourcesHelper(session);
        setSession(null);
        if (!stopRequested()) { try { notifyUtil(settings, "Finished playing existing audio."); } catch {} }
        return true;
      }
    } catch {}
  }

  const extExisting = fileExtFromFormat(settings.outputFormat);
  const existingPaths: string[] = [];
  for (let i = 1; i < 10000; i++) {
    const p = `${folder}/${base}_part_${i}.${extExisting}`;
    const ok = await app.vault.adapter.exists(p);
    if (!ok) break;
    existingPaths.push(p);
  }
  if (!existingPaths.length) return false;

  try {
    try { notifyUtil(settings, `Rozpoczynam odtwarzanie istniejących plików (${existingPaths.length} części)...`, true); } catch {}
    for (let i = 0; i < existingPaths.length; i++) {
      if (stopRequested()) break;
      const p = existingPaths[i];
      const data = await app.vault.adapter.readBinary(p);
      const mime = mimeFromFormat(settings.outputFormat);
      const blob = new Blob([data], { type: mime });
      const url = URL.createObjectURL(blob);
      const audioEl = new Audio(url);
      audioEl.playbackRate = playbackRateFromRateSetting(settings.rate);
      const abort = new AbortController();
      const session: PlaybackSession = { abort, audioEl, mediaSource: null, sourceBuffer: null, lastBlob: blob, fileBase: base, objectUrl: url };
      setSession(session);
      try { await audioEl.play(); } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        try { notifyUtil(settings, `Audio play failed (existing): ${msg}`); } catch {}
      }
      await waitForEndOrAbort(audioEl, abort.signal);
      await cleanupSessionResourcesHelper(session);
      setSession(null);
    }
    if (!stopRequested()) { try { notifyUtil(settings, "Finished playing existing audio."); } catch {} }
    return true;
  } catch {
    return false;
  }
}


