/**
 * Buffered prefetch playback with fixed concurrency window.
 */

import type { App, TFile } from "obsidian";
import type { PlaybackSession, TtsSettings } from "../types";
import { buildSsml } from "../utils/ssml";
import { fetchTtsAudio } from "../tts/azure";
import { fileExtFromFormat, playbackRateFromRateSetting } from "../core/helpers";
import { waitForEndOrAbort } from "../core/audio";
import { cleanupSessionResources as cleanupSessionResourcesHelper } from "./session";
import { notify as notifyUtil } from "../core/notify";

export async function playBufferedPrefetch(params: {
  app: App;
  settings: TtsSettings;
  chunks: string[];
  startIndex: number;
  base: string;
  lang: string;
  folder: string;
  file: TFile;
  stopRequested: () => boolean;
  setSession: (s: PlaybackSession | null) => void;
  writeBinary: (app: App, path: string, buffer: ArrayBuffer) => Promise<void>;
  upsertAudioReferenceSorted: (app: App, file: TFile, audioPath: string) => Promise<void>;
}): Promise<void> {
  const { app, settings, chunks, startIndex, base, lang, folder, file, stopRequested, setSession, writeBinary, upsertAudioReferenceSorted } = params;

  const abortAll = new AbortController();
  setSession({ abort: abortAll, audioEl: null, mediaSource: null, sourceBuffer: null, lastBlob: null, fileBase: base });

  try {
    try { notifyUtil(settings, `Starting buffered prefetch playback (${chunks.length} part(s))...`); } catch {}

    const prefetchWindow = 3;
    const ext = fileExtFromFormat(settings.outputFormat);

    const makeTask = (idx: number) => {
      const ssml = buildSsml({ text: chunks[idx], voiceName: settings.voiceName, rate: settings.rate, lang });
      return fetchTtsAudio(
        settings.azureApiKey,
        settings.azureRegion,
        settings.outputFormat,
        ssml,
        abortAll.signal
      ).then(({ buffer, mime }) => ({ buffer, mime, idx }));
    };

    const tasks: Array<Promise<{ buffer: ArrayBuffer; mime: string; idx: number }>> = new Array(chunks.length);
    let started = startIndex;
    while (started < Math.min(startIndex + prefetchWindow, chunks.length)) { tasks[started] = makeTask(started); started += 1; }

    let partIdx = startIndex;
    while (partIdx < chunks.length && !stopRequested() && !abortAll.signal.aborted) {
      while (started < chunks.length && started - partIdx < prefetchWindow) { tasks[started] = makeTask(started); started += 1; }

      const { buffer, mime } = await tasks[partIdx];
      if (!buffer || buffer.byteLength === 0) { throw new Error("Empty audio buffer"); }

      const blob = new Blob([buffer], { type: mime });
      const url = URL.createObjectURL(blob);
      const audioEl = new Audio(url);
      audioEl.playbackRate = playbackRateFromRateSetting(settings.rate);

      const session: PlaybackSession = { abort: abortAll, audioEl, mediaSource: null, sourceBuffer: null, lastBlob: blob, fileBase: base, objectUrl: url };
      setSession(session);

      try { await audioEl.play(); } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        try { notifyUtil(settings, `Audio play failed (buffered): ${msg}`); } catch {}
      }

      const audioPath = `${folder}/${base}_part_${partIdx + 1}.${ext}`;
      await writeBinary(app, audioPath, buffer);
      await upsertAudioReferenceSorted(app, file, audioPath);

      try { await waitForEndOrAbort(audioEl, abortAll.signal); } catch {}
      await cleanupSessionResourcesHelper(session);
      setSession({ ...session, audioEl: null });

      if (stopRequested() || abortAll.signal.aborted) break;
      partIdx += 1;
    }
  } finally {
    try { abortAll.abort(); } catch {}
    try { await cleanupSessionResourcesHelper(null, true); } catch {}
    setSession(null);
  }
}


