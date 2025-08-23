/**
 * Streaming playback of a single part using Media Source Extensions.
 */

import type { App, TFile } from "obsidian";
import type { PlaybackSession, TtsSettings } from "../types";
import { startHttpStream, captureToBlob, mimeFromFormat } from "../tts/azure";
import { fileExtFromFormat, playbackRateFromRateSetting } from "../core/helpers";
import { waitForEndOrAbort } from "../core/audio";
import { writeBinary, upsertAudioReferenceSorted } from "../utils/fs";
import { notify as notifyUtil } from "../core/notify";

export async function playStreamedPartAndSave(params: {
  app: App;
  settings: TtsSettings;
  ssml: string;
  base: string;
  part: number;
  folder: string;
  file: TFile;
  abort: AbortController;
  setSession: (s: PlaybackSession | null) => void;
}): Promise<void> {
  const { app, settings, ssml, base, part, folder, file, abort, setSession } = params;

  const streamFormat = settings.outputFormat;
  const streamMime = mimeFromFormat(streamFormat);

  const stream = await startHttpStream(
    settings.azureApiKey,
    settings.azureRegion,
    streamFormat,
    ssml,
    abort.signal
  );

  const mediaSource = new MediaSource();
  const objectUrl = URL.createObjectURL(mediaSource);
  const audioEl = new Audio(objectUrl);
  audioEl.playbackRate = playbackRateFromRateSetting(settings.rate);

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
      audioEl.play().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        try { notifyUtil(settings, `Audio play failed (stream): ${msg}`); } catch {}
      });
    }
    drain();
  });
  const onChunk = (u8: Uint8Array) => { queue.push(u8); drain(); };

  const session: PlaybackSession = { abort, audioEl, mediaSource, sourceBuffer, lastBlob: null, fileBase: base, objectUrl };
  setSession(session);

  const blob = await captureToBlob(stream, onChunk, streamFormat);
  setSession({ ...session, lastBlob: blob });
  if (mediaSource.readyState === "open") { try { mediaSource.endOfStream(); } catch {} }

  const wait = waitForEndOrAbort(audioEl, abort.signal);

  const arrayBuf = await blob.arrayBuffer();
  const ext = fileExtFromFormat(settings.outputFormat);
  const audioPath = `${folder}/${base}_part_${part}.${ext}`;
  await writeBinary(app, audioPath, arrayBuf);
  await upsertAudioReferenceSorted(app, file, audioPath);

  await wait.catch(() => undefined);
}


