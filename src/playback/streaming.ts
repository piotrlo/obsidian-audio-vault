/**
 * Streaming playback of a single part using Media Source Extensions.
 */

import type { App, TFile } from "obsidian";
import type { PlaybackSession, TtsProvider, TtsSettings } from "../types";
import { captureToBlob } from "../core/audio";
import { mimeFromFormat } from "../core/helpers";
import { fileExtFromFormat, playbackRateFromRateSetting } from "../core/helpers";
import { waitForEndOrAbort } from "../core/audio";
import { writeBinary, upsertAudioReferenceSorted } from "../utils/fs";
import { notify as notifyUtil } from "../core/notify";

export async function playStreamedPartAndSave(params: {
  app: App;
  settings: TtsSettings;
  provider: TtsProvider;
  ssml: string;
  base: string;
  part: number;
  folder: string;
  file: TFile;
  abort: AbortController;
  setSession: (s: PlaybackSession | null) => void;
  /** Optional merger append hook for MP3 bytes; when set, per-part save can be skipped. */
  appendToMerged?: (bytes: Uint8Array) => void;
  /** If false, the function will not persist per-part files/links. */
  savePerPart?: boolean;
}): Promise<void> {
  const { app, settings, provider, ssml, base, part, folder, file, abort, setSession, appendToMerged, savePerPart } = params;

  const streamFormat = settings.outputFormat;
  const streamMime = mimeFromFormat(streamFormat);

  const stream = await provider.synthesize(ssml, streamFormat, "", abort.signal);

  const mediaSource = new MediaSource();
  const objectUrl = URL.createObjectURL(mediaSource);
  const audioEl = new Audio(objectUrl);
  audioEl.playbackRate = playbackRateFromRateSetting(settings.rate);

  try { notifyUtil(settings, `Starting playback (streaming) — part ${part}`, true); } catch {}

  await new Promise<void>((res) => mediaSource.addEventListener("sourceopen", () => res(), { once: true }));
  const sourceBuffer = mediaSource.addSourceBuffer(streamMime);

  const queue: Uint8Array[] = [];
  let draining = false;
  let startedPlayback = false;
  const drain = () => {
    if (draining || sourceBuffer.updating) return;
    const next = queue.shift();
    if (!next) return;
    try {
      const copy = new Uint8Array(next.byteLength);
      copy.set(next);
      sourceBuffer.appendBuffer(copy.buffer);
      draining = true;
    } catch {
      draining = false;
    }
  };
  sourceBuffer.addEventListener('updateend', () => {
    draining = false;
    if (!startedPlayback) {
      startedPlayback = true;
      audioEl.play().then(() => {
        try { notifyUtil(settings, "Playback started", true); } catch {}
      }).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        try { notifyUtil(settings, `Audio play failed (stream): ${msg}`); } catch {}
      });
    }
    drain();
  });
  const onChunk = (u8: Uint8Array) => { queue.push(u8); drain(); try { appendToMerged?.(u8); } catch {} };

  const session: PlaybackSession = { abort, audioEl, mediaSource, sourceBuffer, lastBlob: null, fileBase: base, objectUrl };
  setSession(session);

  const blob = await captureToBlob(stream, onChunk, streamFormat);
  setSession({ ...session, lastBlob: blob });
  if (mediaSource.readyState === "open") { try { mediaSource.endOfStream(); } catch {} }

  const wait = waitForEndOrAbort(audioEl, abort.signal);

  if (savePerPart !== false) {
    const arrayBuf = await blob.arrayBuffer();
    if (arrayBuf && arrayBuf.byteLength > 0) {
      const ext = fileExtFromFormat(settings.outputFormat);
      const audioPath = `${folder}/${base}_part_${part}.${ext}`;
      await writeBinary(app, audioPath, arrayBuf);
      await upsertAudioReferenceSorted(app, file, audioPath);
    } else {
      try { notifyUtil(settings, `Pominięto zapis części ${part} (brak danych)`, true); } catch {}
    }
  }

  await wait.catch(() => undefined);
}


