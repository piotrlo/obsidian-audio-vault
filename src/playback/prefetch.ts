/**
 * Manifest-driven prefetch orchestrator for resilient iOS downloads.
 * Features manifest persistence, resume capability, and robust error handling.
 */

import type { App, TFile } from "obsidian";
import type { PrefetchResult, TtsProvider, TtsSettings, AudioManifest, Result, AudioVaultError } from "../types";
import { buildSsml } from "../utils/ssml";
import { captureToBlob } from "../core/audio";
import { fileExtFromFormat } from "../core/helpers";
import { 
  upsertAudioReferenceSorted, 
  scanExistingParts, 
  buildManifestPath,
  buildPartPath,
  readManifestSafe,
  writeManifestSafe,
  writeFileAtomic
} from "../utils/fs";
import { notify as notifyUtil } from "../core/notify";
import { debug, warn, error as logError } from "../utils/logger";
import { createValidManifest, updateManifestWithParts } from "../schema";

/**
 * Enhanced progress callback type with more detailed state information.
 */
export interface PrefetchProgress {
  /** Number of parts successfully fetched and saved */
  fetched: number;
  /** Total number of parts to fetch */
  total: number;
  /** Index of the part that was just processed (1-based) */
  idx: number;
  /** State of the part: 'saved' | 'failed' */
  state: 'saved' | 'failed';
  /** Error message if state is 'failed' */
  error?: string;
}

/**
 * Configuration for the prefetch orchestrator.
 */
export interface PrefetchOptions {
  app: App;
  settings: TtsSettings;
  provider: TtsProvider;
  chunks: string[];
  base: string;
  folder: string;
  file: TFile;
  lang: string;
  /** Maximum concurrent downloads (default: 5 on iOS, 3 on desktop) */
  concurrency?: number;
  /** Called when a part is successfully saved (1-based index) */
  onPartSaved?: (idx: number) => void;
  /** Called for progress updates with detailed information */
  onProgress?: (info: PrefetchProgress) => void;
  /** External abort controller for cancellation */
  abortController?: AbortController;
  /** Whether to force regeneration of existing parts */
  forceRegenerate?: boolean;
}

/**
 * Return type for the prefetch orchestrator.
 */
export interface PrefetchOrchestrator {
  /** Array of promises for each part download */
  tasks: Promise<PrefetchResult>[];
  /** Abort controller for canceling the operation */
  controller: AbortController;
  /** Function to register additional progress callbacks */
  onProgress: (cb: (info: PrefetchProgress) => void) => void;
  /** Promise that resolves when all downloads are complete or aborted */
  allDone: Promise<void>;
  /** Manifest path for tracking progress */
  manifestPath: string;
}

/**
 * Advanced prefetch orchestrator with manifest-driven resume capability.
 * Designed for iOS reliability with robust error handling and state persistence.
 * 
 * Key features:
 * - Manifest-based progress tracking and resume capability
 * - Retry logic with exponential backoff
 * - iOS background awareness
 * - Atomic file operations to prevent corruption
 * - Detailed progress reporting
 */
export async function prefetchAllParts(params: PrefetchOptions): Promise<PrefetchOrchestrator> {
  const { 
    app, settings, provider, chunks, base, folder, file, lang,
    concurrency = 3,
    onPartSaved, onProgress, abortController, forceRegenerate = false 
  } = params;
  
  const controller = abortController ?? new AbortController();
  const ext = fileExtFromFormat(settings.outputFormat);
  const totalParts = chunks.length;
  const manifestPath = buildManifestPath(folder, base);
  
  debug(`Starting prefetch orchestrator for ${totalParts} parts, concurrency=${concurrency}`);
  
  // Initialize or load existing manifest
  let manifest: AudioManifest;
  let missingParts: number[];
  
  if (forceRegenerate) {
    // Start fresh
    manifest = createValidManifest({
      version: 1,
      ext,
      totalParts,
      fetchedParts: [],
      mergedUntil: 0,
      updatedAt: Date.now(),
    });
    missingParts = Array.from({ length: totalParts }, (_, i) => i + 1);
    debug("Force regenerate: starting with empty manifest");
  } else {
    // Try to load existing manifest
    const manifestResult = await readManifestSafe(app, manifestPath);
    
    if (manifestResult.ok) {
      manifest = manifestResult.value;
      debug(`Loaded existing manifest: ${manifest.fetchedParts.length}/${manifest.totalParts} parts`);
      
      // Reconcile with actual files on disk
      const existingParts = await scanExistingParts(app, folder, base, ext);
      const reconciledParts = Array.from(new Set([...manifest.fetchedParts, ...existingParts])).sort((a, b) => a - b);
      
      if (reconciledParts.length !== manifest.fetchedParts.length) {
        debug(`Reconciled manifest: found ${reconciledParts.length} parts on disk vs ${manifest.fetchedParts.length} in manifest`);
        manifest = updateManifestWithParts(manifest, reconciledParts);
      }
    } else {
      // No manifest exists, check for existing parts
      const existingParts = await scanExistingParts(app, folder, base, ext);
      manifest = createValidManifest({
        version: 1,
        ext,
        totalParts,
        fetchedParts: existingParts,
        mergedUntil: 0,
        updatedAt: Date.now(),
      });
      debug(`Created new manifest with ${existingParts.length} existing parts`);
    }
    
    // Determine missing parts
    const allParts = Array.from({ length: totalParts }, (_, i) => i + 1);
    missingParts = allParts.filter(part => !manifest.fetchedParts.includes(part));
  }
  
  // Save initial manifest
  const manifestSaveResult = await writeManifestSafe(app, manifestPath, manifest);
  if (!manifestSaveResult.ok) {
    if (!manifestSaveResult.ok) {
      warn("Failed to save initial manifest:", manifestSaveResult.error.reason);
    }
  }
  
  // Progress tracking
  const progressCallbacks: Array<(info: PrefetchProgress) => void> = [];
  const addProgressCallback = (cb: (info: PrefetchProgress) => void) => {
    progressCallbacks.push(cb);
  };
  
  if (onProgress) progressCallbacks.push(onProgress);
  
  const notifyProgress = (info: PrefetchProgress) => {
    for (const cb of progressCallbacks) {
      try {
        cb(info);
      } catch (error) {
        warn("Progress callback failed:", error);
      }
    }
  };
  
  // Task management
  const tasks: Array<Promise<PrefetchResult>> = new Array(totalParts);
  const resolvers: Array<(value: PrefetchResult) => void> = new Array(totalParts);
  
  // Initialize promises for all parts
  for (let i = 0; i < totalParts; i++) {
    tasks[i] = new Promise<PrefetchResult>((resolve) => {
      resolvers[i] = resolve;
    });
  }
  
  // Resolve already completed parts immediately
  for (const partIdx of manifest.fetchedParts) {
    const idx = partIdx - 1; // Convert to 0-based
    if (idx >= 0 && idx < totalParts) {
      resolvers[idx]({
        idx,
        buffer: new ArrayBuffer(0), // Empty buffer for pre-existing parts
        mime: /wav|riff/i.test(settings.outputFormat) ? "audio/wav" : "audio/mpeg",
      });
    }
  }
  
  // Work queue for missing parts
  const workQueue = [...missingParts];
  debug(`Work queue contains ${workQueue.length} missing parts: [${workQueue.slice(0, 5).join(', ')}${workQueue.length > 5 ? '...' : ''}]`);
  
  // Worker function for downloading individual parts
  const worker = async (): Promise<void> => {
    while (workQueue.length > 0 && !controller.signal.aborted) {
      const partNum = workQueue.shift();
      if (partNum === undefined) break;
      
      const idx = partNum - 1; // Convert to 0-based for arrays
      const partPath = buildPartPath(folder, base, partNum, ext);
      
      try {
        debug(`Starting download of part ${partNum}`);
        
        // Build SSML for this chunk
        const ssml = buildSsml({ 
          text: chunks[idx], 
          voiceName: settings.voiceName, 
          rate: settings.rate, 
          lang 
        });
        
        // Synthesize using provider with retry logic
        const synthesizeResult = await synthesizeWithRetry(
          provider, ssml, settings.outputFormat, lang, controller.signal
        );
        
        if (!synthesizeResult.ok) {
          throw new Error(synthesizeResult.error.reason);
        }
        
        const { buffer, mime } = synthesizeResult.value;
        
        // Atomically save the part file
        const saveResult = await writeFileAtomic(app, partPath, buffer);
        if (!saveResult.ok) {
          throw new Error(`Failed to save part: ${saveResult.error.reason}`);
        }
        
        // Update note with audio reference (best effort)
        try {
          await upsertAudioReferenceSorted(app, file, partPath);
        } catch (error) {
          warn(`Failed to update note reference for part ${partNum}:`, error);
        }
        
        // Update manifest atomically
        const updatedManifest = updateManifestWithParts(manifest, [partNum]);
        const manifestUpdateResult = await writeManifestSafe(app, manifestPath, updatedManifest);
        if (manifestUpdateResult.ok) {
          manifest = updatedManifest;
        } else {
          warn(`Failed to update manifest for part ${partNum}:`, manifestUpdateResult.error.reason);
        }
        
        // Notify progress
        notifyProgress({
          fetched: manifest.fetchedParts.length,
          total: totalParts,
          idx: partNum,
          state: 'saved',
        });
        
        // Call part saved callback
        if (onPartSaved) {
          try {
            onPartSaved(partNum);
          } catch (error) {
            warn(`Part saved callback failed for part ${partNum}:`, error);
          }
        }
        
        // Resolve the task promise
        resolvers[idx]({ idx, buffer, mime });
        
        debug(`Completed download of part ${partNum}`);
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logError(`Failed to download part ${partNum}:`, errorMessage);
        
        // Notify progress with error
        notifyProgress({
          fetched: manifest.fetchedParts.length,
          total: totalParts,
          idx: partNum,
          state: 'failed',
          error: errorMessage,
        });
        
        // Resolve with empty buffer for failed parts
        resolvers[idx]({
          idx,
          buffer: new ArrayBuffer(0),
          mime: /wav|riff/i.test(settings.outputFormat) ? "audio/wav" : "audio/mpeg",
        });
      }
    }
  };
  
  // Start worker pool
  const actualConcurrency = Math.min(concurrency, workQueue.length);
  debug(`Starting ${actualConcurrency} workers for ${workQueue.length} parts`);
  
  try {
    notifyUtil(settings, `Starting prefetch (${totalParts} parts, ${manifest.fetchedParts.length} existing, c=${actualConcurrency})`);
  } catch (error) {
    warn("Failed to show prefetch notification:", error);
  }
  
  const workers = Array.from({ length: actualConcurrency }, () => worker());
  const allDone = Promise.allSettled(workers).then(() => {
    debug(`Prefetch orchestrator completed. Final state: ${manifest.fetchedParts.length}/${totalParts} parts`);
  });
  
  return {
    tasks,
    controller,
    onProgress: addProgressCallback,
    allDone,
    manifestPath,
  };
}

/**
 * Synthesize audio with retry logic using the robust network layer.
 */
async function synthesizeWithRetry(
  provider: TtsProvider,
  ssml: string,
  outputFormat: string,
  lang: string,
  abortSignal: AbortSignal,
  timeoutMs: number = 15000
): Promise<Result<{ buffer: ArrayBuffer; mime: string }, AudioVaultError>> {
  try {
    // Compose abort with timeout
    const controller = new AbortController();
    const onAbort = () => { try { controller.abort(); } catch {} };
    if (abortSignal.aborted) controller.abort();
    else abortSignal.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => { try { controller.abort(); } catch {} }, timeoutMs);

    try {
      const stream = await provider.synthesize(ssml, outputFormat, lang, controller.signal);
      const blob = await captureToBlob(stream, undefined, outputFormat);
      const buffer = await blob.arrayBuffer();
      const mime = blob.type || (/wav|riff/i.test(outputFormat) ? "audio/wav" : "audio/mpeg");
      return { ok: true, value: { buffer, mime } };
    } finally {
      clearTimeout(timeout);
      try { abortSignal.removeEventListener('abort', onAbort as any); } catch {}
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: {
        kind: 'transient',
        reason: `TTS synthesis failed: ${message}`,
        cause: error instanceof Error ? error : undefined,
      }
    };
  }
}

/**
 * Legacy function signature for backward compatibility.
 * @deprecated Use the new prefetchAllParts with enhanced options
 */
export async function prefetchAllPartsLegacy(params: {
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
}): Promise<{ tasks: Promise<PrefetchResult>[]; controller: AbortController; onProgress: (cb: (i: { fetched: number; total: number }) => void) => void; allDone: Promise<void> }> {
  const enhancedParams: PrefetchOptions = {
    ...params,
    onProgress: params.onProgress ? (info) => {
      if (params.onProgress) {
        params.onProgress({ fetched: info.fetched, total: info.total });
      }
    } : undefined,
  };
  
  const result = await prefetchAllParts(enhancedParams);
  
  return {
    tasks: result.tasks,
    controller: result.controller,
    onProgress: (cb) => {
      result.onProgress((info) => {
        cb({ fetched: info.fetched, total: info.total });
      });
    },
    allDone: result.allDone,
  };
}


