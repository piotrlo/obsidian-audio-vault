/**
 * Streaming playback of a single part using Media Source Extensions.
 */

import type { App, TFile } from "obsidian";
import type { PlaybackSession, TtsProvider, TtsSettings } from "../types";
import { captureToBlob, canStream, waitForEndOrAbort } from "../core/audio";
import { mimeFromFormat } from "../core/helpers";
import { fileExtFromFormat, playbackRateFromRateSetting } from "../core/helpers";
import { writeBinary, upsertAudioReferenceSorted } from "../utils/fs";
import { notify as notifyUtil } from "../core/notify";

export async function playStreamedPartAndSave(params: {
  app: App;
  settings: TtsSettings;
  provider: TtsProvider;
  ssml: string;
  lang: string;
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
  /** Optional hook invoked immediately after network capture completes (before playback finishes). */
  onCaptured?: (blob: Blob) => Promise<void> | void;
}): Promise<void> {
  const { app, settings, provider, ssml, lang, base, part, folder, file, abort, setSession, appendToMerged, savePerPart, onCaptured } = params;

  const streamFormat = settings.outputFormat;
  const streamMime = mimeFromFormat(streamFormat);
  const { supported: mseSupported } = canStream(streamFormat);

  const effectiveLang = (lang && lang.trim()) ? lang : (settings.language || "pl-PL");
  const stream = await provider.synthesize(ssml, streamFormat, effectiveLang, abort.signal);

  // Fallback path when MSE is unavailable or unsupported: capture entire blob, optionally save, no MSE playback.
  if (!mseSupported) {
    const blob = await captureToBlob(stream, undefined, streamFormat);
    const session: PlaybackSession = { abort, audioEl: null, mediaSource: null, sourceBuffer: null, lastBlob: blob, fileBase: base } as any;
    setSession(session);
    // When merging is enabled, append entire blob bytes to the assembler.
    if (appendToMerged) {
      try {
        const ab = await blob.arrayBuffer();
        if (ab && ab.byteLength > 0) appendToMerged(new Uint8Array(ab));
      } catch {}
    }
    // Invoke onCaptured hook early (e.g., to write merged file) without waiting for playback end.
    try { await onCaptured?.(blob); } catch {}
    if (savePerPart !== false) {
      const arrayBuf = await blob.arrayBuffer();
      if (arrayBuf && arrayBuf.byteLength > 0) {
        const ext = fileExtFromFormat(settings.outputFormat);
        const audioPath = `${folder}/${base}_part_${part}.${ext}`;
        await writeBinary(app, audioPath, arrayBuf);
        await upsertAudioReferenceSorted(app, file, audioPath);
      } else {
        try { notifyUtil(settings, `Skipped saving part ${part} (no data)`, true); } catch {}
      }
    }
    return;
  }

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

  // If no data was received, skip saving and return immediately to avoid hanging on playback end.
  if (!blob || blob.size === 0) {
    if (savePerPart !== false) {
      try { notifyUtil(settings, `Skipped saving part ${part} (no data)`, true); } catch {}
    }
    return;
  }

  const wait = waitForEndOrAbort(audioEl, abort.signal);

  // Invoke onCaptured hook early (e.g., to write merged file) without waiting for playback end.
  try { await onCaptured?.(blob); } catch {}

  if (savePerPart !== false) {
    const arrayBuf = await blob.arrayBuffer();
    if (arrayBuf && arrayBuf.byteLength > 0) {
      const ext = fileExtFromFormat(settings.outputFormat);
      const audioPath = `${folder}/${base}_part_${part}.${ext}`;
      await writeBinary(app, audioPath, arrayBuf);
      await upsertAudioReferenceSorted(app, file, audioPath);
    } else {
      try { notifyUtil(settings, `Skipped saving part ${part} (no data)`, true); } catch {}
    }
  }

  await wait.catch(() => undefined);
}


