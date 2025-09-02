/**
 * Background prefetch orchestrator for aggressive parallel downloads.
 */

import type { App, TFile } from "obsidian";
import type { PrefetchResult, TtsProvider, TtsSettings } from "../types";
import { buildSsml } from "../utils/ssml";
import { captureToBlob } from "../core/audio";
import { fileExtFromFormat } from "../core/helpers";
import { writeBinary, upsertAudioReferenceSorted } from "../utils/fs";
import { notify as notifyUtil } from "../core/notify";

/**
 * Prefetch all parts with bounded concurrency and persist results incrementally.
 * Always saves per‑part files to enable offline/restore on iOS. Simplified: no manifest,
 * no partial snapshots — just a worker‑pool and per‑part writes.
 *
 * @param {object} params Configuration object.
 * @param {App} params.app Obsidian app instance.
 * @param {TtsSettings} params.settings Plugin settings.
 * @param {TtsProvider} params.provider Active TTS provider.
 * @param {string[]} params.chunks Text chunks to synthesize.
 * @param {string} params.base Safe base name used for file outputs.
 * @param {string} params.folder Target Audio folder path.
 * @param {TFile} params.file Current note file (unused, kept for signature stability).
 * @param {string} params.lang BCP‑47 language to use for synthesis.
 * @param {number} [params.concurrency=5] Maximum concurrent downloads.
 * @param {(idx: number) => void} [params.onPartSaved] Callback fired when a part file is saved (1‑based index).
 * @param {(i: { fetched: number; total: number }) => void} [params.onProgress] Optional progress callback.
 * @param {AbortController} [params.abortController] Optional external abort controller.
 * @returns {Promise<{ tasks: Promise<PrefetchResult>[]; controller: AbortController; onProgress: (cb: (i: { fetched: number; total: number }) => void) => void; allDone: Promise<void> }>} Prefetch control and tasks.
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
  onPartSaved?: (idx: number) => void;
  onProgress?: (info: { fetched: number; total: number }) => void;
  abortController?: AbortController;
}): Promise<{ tasks: Promise<PrefetchResult>[]; controller: AbortController; onProgress: (cb: (i: { fetched: number; total: number }) => void) => void; allDone: Promise<void> }>{
  const { app, settings, provider, chunks, base, folder, lang } = params;
  const concurrency = Math.max(1, Math.min(params.concurrency ?? 5, 8));
  const controller = params.abortController ?? new AbortController();
  const ext = fileExtFromFormat(settings.outputFormat);
  const totalParts = chunks.length;

  const progressCallbacks: Array<(i: { fetched: number; total: number }) => void> = [];
  const onProgress = (cb: (i: { fetched: number; total: number }) => void) => { progressCallbacks.push(cb); };
  if (params.onProgress) progressCallbacks.push(params.onProgress);
  let fetchedCount = 0;
  const notifyProgress = () => { for (const cb of progressCallbacks) { try { cb({ fetched: fetchedCount, total: totalParts }); } catch {} } };

  const tasks: Array<Promise<PrefetchResult>> = new Array(totalParts);
  type Resolver = (value: PrefetchResult | PromiseLike<PrefetchResult>) => void;
  const resolvers: Resolver[] = new Array(totalParts);
  for (let i = 0; i < totalParts; i++) {
    tasks[i] = new Promise<PrefetchResult>((resolve) => { resolvers[i] = resolve; });
  }

  const queue: number[] = Array.from({ length: totalParts }, (_, i) => i);

  const worker = async (): Promise<void> => {
    while (queue.length && !controller.signal.aborted) {
      const idx = queue.shift();
      if (idx === undefined) break;
      const partNum = idx + 1;
      try {
        const ssml = buildSsml({ text: chunks[idx], voiceName: settings.voiceName, rate: settings.rate, lang });
        const stream = await provider.synthesize(ssml, settings.outputFormat, lang, controller.signal);
        const blob = await captureToBlob(stream, undefined, settings.outputFormat);
        const buffer = await blob.arrayBuffer();
        const mime = blob.type || (/wav|riff/i.test(settings.outputFormat) ? "audio/wav" : "audio/mpeg");
        const audioPath = `${folder}/${base}_part_${partNum}.${ext}`;
        await writeBinary(app, audioPath, buffer);
        try { await upsertAudioReferenceSorted(app, params.file, audioPath); } catch {}
        fetchedCount += 1;
        notifyProgress();
        if (typeof params.onPartSaved === "function") { try { params.onPartSaved(partNum); } catch {} }
        resolvers[idx]({ idx, buffer, mime });
      } catch {
        const empty = new Uint8Array();
        const mime = /wav|riff/i.test(settings.outputFormat) ? "audio/wav" : "audio/mpeg";
        resolvers[idx]({ idx, buffer: empty.buffer, mime });
      }
    }
  };

  try { notifyUtil(settings, `Prefetch started (${totalParts} parts, c=${concurrency})`); } catch {}
  const workers = Array.from({ length: Math.min(concurrency, totalParts) }, () => worker());
  const allDone = Promise.allSettled(workers).then(() => {});
  return { tasks, controller, onProgress, allDone };
}


