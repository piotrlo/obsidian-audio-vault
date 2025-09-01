/**
 * Background prefetch orchestrator for aggressive parallel downloads.
 */

import type { App, TFile } from "obsidian";
import type { AudioManifest, PrefetchResult, TtsProvider, TtsSettings } from "../types";
import { buildSsml } from "../utils/ssml";
import { captureToBlob } from "../core/audio";
import { fileExtFromFormat } from "../core/helpers";
import { writeBinary, readManifest, writeManifest, scanExistingParts } from "../utils/fs";
import { replaceAudioReferencesWithSingle } from "../utils/fs";
import { Mp3Assembler, buildPartialSnapshot } from "../utils/mp3";
import { notify as notifyUtil } from "../core/notify";
import { backgroundPausedNotice, backgroundResumedNotice } from "../core/notify";

/**
 * Prefetch all parts with bounded concurrency and persist results incrementally.
 * Always saves per‑part files to enable offline/restore on iOS. Optionally emits
 * partial merged snapshot updates when MP3 merging is enabled.
 *
 * @param {object} params Configuration object.
 * @param {App} params.app Obsidian app instance.
 * @param {TtsSettings} params.settings Plugin settings.
 * @param {TtsProvider} params.provider Active TTS provider.
 * @param {string[]} params.chunks Text chunks to synthesize.
 * @param {string} params.base Safe base name used for file outputs.
 * @param {string} params.folder Target Audio folder path.
 * @param {TFile} params.file Current note file.
 * @param {string} params.lang BCP‑47 language to use for synthesis.
 * @param {number} [params.concurrency=5] Maximum concurrent downloads.
 * @param {boolean} [params.enablePartialMerge=false] When true and output is MP3, produces partial snapshots.
 * @param {(i: { fetched: number; total: number }) => void} [params.onProgress] Optional progress callback.
 * @param {AbortController} [params.abortController] Optional external abort controller.
 * @returns {Promise<{ tasks: Promise<PrefetchResult>[]; controller: AbortController; onProgress: (cb: (i: { fetched: number; total: number }) => void) => void }>} Prefetch control and tasks.
 */
export async function prefetchAllParts(params: {
  app: App;
  settings: TtsSettings;
  provider: TtsProvider;
  chunks: string[];
  base: string;
  folder: string;
  file: TFile;
  lang: string;
  concurrency?: number;
  enablePartialMerge?: boolean;
  finalizeOnComplete?: boolean;
  onProgress?: (info: { fetched: number; total: number }) => void;
  abortController?: AbortController;
}): Promise<{ tasks: Promise<PrefetchResult>[]; controller: AbortController; onProgress: (cb: (i: { fetched: number; total: number }) => void) => void; allDone: Promise<void> }>{
  const { app, settings, provider, chunks, base, folder, file, lang } = params;
  const concurrency = Math.max(1, Math.min(params.concurrency ?? 5, 8));
  const controller = params.abortController ?? new AbortController();
  const ext = fileExtFromFormat(settings.outputFormat);
  const totalParts = chunks.length;
  const mergingEnabled = !!params.enablePartialMerge && /mp3/i.test(settings.outputFormat);
  const assembler = mergingEnabled ? new Mp3Assembler() : null;

  const progressCallbacks: Array<(i: { fetched: number; total: number }) => void> = [];
  const onProgress = (cb: (i: { fetched: number; total: number }) => void) => { progressCallbacks.push(cb); };
  if (params.onProgress) progressCallbacks.push(params.onProgress);

  let manifest: AudioManifest = (await readManifest(app, folder, base)) ?? {
    version: 1,
    ext,
    totalParts,
    fetchedParts: [],
    mergedUntil: 0,
    updatedAt: Date.now(),
  };
  try {
    const existing = await scanExistingParts(app, folder, base, ext);
    const merged = new Set<number>(manifest.fetchedParts);
    for (const n of existing) merged.add(n);
    manifest.fetchedParts = Array.from(merged).sort((a, b) => a - b);
    manifest.updatedAt = Date.now();
    await writeManifest(app, folder, base, manifest);
  } catch {}

  const inFlight: Array<Promise<PrefetchResult>> = new Array(totalParts);
  let fetchedCount = manifest.fetchedParts.length;
  const notifyProgress = () => { for (const cb of progressCallbacks) { try { cb({ fetched: fetchedCount, total: totalParts }); } catch {} } };
  notifyProgress();

  const pendingBuffers = new Map<number, Uint8Array>();
  let nextToMerge = manifest.mergedUntil;

  const makeTask = (idx: number): Promise<PrefetchResult> => {
    const partNum = idx + 1;
    const audioPath = `${folder}/${base}_part_${partNum}.${ext}`;
    if (manifest.fetchedParts.includes(partNum)) {
      return app.vault.adapter.readBinary(audioPath).then((buf) => {
        const mime = /wav|riff/i.test(settings.outputFormat) ? "audio/wav" : "audio/mpeg";
        return { idx, buffer: buf, mime } as PrefetchResult;
      });
    }
    const ssml = buildSsml({ text: chunks[idx], voiceName: settings.voiceName, rate: settings.rate, lang });
    return provider.synthesize(ssml, settings.outputFormat, lang, controller.signal)
      .then(async (stream) => {
        const blob = await captureToBlob(stream, undefined, settings.outputFormat);
        const buffer = await blob.arrayBuffer();
        const mime = blob.type || (/wav|riff/i.test(settings.outputFormat) ? "audio/wav" : "audio/mpeg");

        await writeBinary(app, audioPath, buffer);
        fetchedCount += 1;
        // Update manifest
        try {
          const now = Date.now();
          const mergedParts = new Set<number>(manifest.fetchedParts);
          mergedParts.add(partNum);
          manifest = { ...manifest, fetchedParts: Array.from(mergedParts).sort((a, b) => a - b), updatedAt: now };
          await writeManifest(app, folder, base, manifest);
        } catch {}
        // Optional partial snapshot
        if (assembler) {
          try {
            pendingBuffers.set(partNum, new Uint8Array(buffer));
            // Append in order for all contiguous available parts
            let appended = false;
            while (pendingBuffers.has(nextToMerge + 1)) {
              const nxt = nextToMerge + 1;
              assembler.append(pendingBuffers.get(nxt)!);
              pendingBuffers.delete(nxt);
              nextToMerge = nxt;
              appended = true;
            }
            if (appended) {
              const ab = buildPartialSnapshot(assembler);
              await writeBinary(app, `${folder}/${base}.partial.mp3`, ab);
              manifest.mergedUntil = nextToMerge;
              manifest.updatedAt = Date.now();
              await writeManifest(app, folder, base, manifest);
            }
          } catch {}
        }
        notifyProgress();
        return { idx, buffer, mime } as PrefetchResult;
      });
  };

  let nextToStart = 0;
  while (nextToStart < totalParts && nextToStart < concurrency) {
    inFlight[nextToStart] = makeTask(nextToStart);
    nextToStart += 1;
  }
  for (let idx = 0; idx < totalParts; idx++) {
    if (!inFlight[idx]) {
      inFlight[idx] = (async () => {
        await inFlight[idx - concurrency];
        return makeTask(idx);
      })();
    }
  }

  try {
    if (manifest.fetchedParts.length > 0 && manifest.fetchedParts.length < totalParts) {
      backgroundResumedNotice(settings);
    }
    notifyUtil(settings, `Prefetch started (${totalParts} parts, c=${concurrency})`);
  } catch {}
  controller.signal.addEventListener("abort", () => {
    try {
      if (fetchedCount > 0 && fetchedCount < totalParts) backgroundPausedNotice(settings);
    } catch {}
  }, { once: true });
  const allDone = (async () => {
    try {
      await Promise.allSettled(inFlight);
      if (assembler && params.finalizeOnComplete) {
        const merged = assembler.build();
        if (merged && merged.byteLength > 0) {
          const audioPath = `${folder}/${base}.mp3`;
          const ab = new ArrayBuffer(merged.byteLength);
          new Uint8Array(ab).set(merged);
          await writeBinary(app, audioPath, ab);
          await replaceAudioReferencesWithSingle(app, file, audioPath);
          // Cleanup
          try { await app.vault.adapter.remove(`${folder}/${base}.partial.mp3`); } catch {}
          try { await app.vault.adapter.remove(`${folder}/${base}.manifest.json`); } catch {}
        }
      }
    } catch {}
  })();
  return { tasks: inFlight, controller, onProgress, allDone };
}


