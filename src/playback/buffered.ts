/**
 * Enhanced buffered prefetch playbook with iOS optimization and gap handling.
 * Uses AudioSessionManager for reliable playback state management.
 */

import type { App, TFile } from "obsidian";
import type { PlaybackSession, TtsProvider, TtsSettings, PrefetchResult } from "../types";
import { AudioSessionManager, type AudioSessionEventListener } from "./session";
import { synthesisInput } from "../tts/input";
import { fileExtFromFormat, playbackRateFromRateSetting } from "../core/helpers";
import { captureToBlob, waitForEndOrAbort } from "../core/audio";
import { cleanupSessionResources as cleanupSessionResourcesHelper } from "./session";
import { notify as notifyUtil } from "../core/notify";
import { debug, warn, error as logError } from "../utils/logger";
import { Platform } from "obsidian";

/**
 * Configuration for enhanced buffered playback.
 */
export interface EnhancedBufferedConfig {
  /** Start playback immediately on first part ready */
  immediateStart?: boolean;
  /** Prefer partial MP3 for smoother progression */
  preferPartialMp3?: boolean;
  /** Max wait time for next (non-first) part (ms) */
  maxWaitForNext?: number;
  /** Max wait time for the very first part (ms) — allows cold starts */
  firstPartTimeoutMs?: number;
  /** Backoff delay when waiting (ms) */
  waitBackoffMs?: number;
  /** Show buffering UI during gaps */
  showBufferingUI?: boolean;
}

/**
 * Enhanced buffered prefetch playback with session management and iOS optimizations.
 * 
 * Key features:
 * - On iOS: force savePerPart=true for reliability
 * - Immediate playback start on first part ready
 * - Smart gap handling with backoff retry
 * - Prefer .partial.mp3 when available
 * - Buffering UI feedback
 */
export async function playEnhancedBufferedPrefetch(params: {
  app: App;
  settings: TtsSettings;
  provider: TtsProvider;
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
  /** Optional merger append hook for MP3 bytes; when set, per-part save can be skipped. */
  appendToMerged?: (bytes: Uint8Array) => void;
  /** If false, the function will not persist per-part files/links. On iOS, this is forced to true. */
  savePerPart?: boolean;
  /** Optional prefetch results to consume instead of synthesizing anew. */
  prefetchTasks?: Array<Promise<PrefetchResult>>;
  /** Enhanced buffered playback configuration */
  config?: EnhancedBufferedConfig;
}): Promise<void> {
  const { 
    app, settings, provider, chunks, startIndex, base, lang, folder, file, 
    stopRequested, setSession, writeBinary, upsertAudioReferenceSorted, 
    appendToMerged, prefetchTasks 
  } = params;
  
  // Platform-specific optimizations: iOS requires savePerPart for reliability
  const isiOS = Platform.isIosApp;
  const savePerPart = params.savePerPart !== false || isiOS;
  
const config: Required<EnhancedBufferedConfig> = {
    immediateStart: true,
    preferPartialMp3: true,
    maxWaitForNext: 10000, // 10 seconds for subsequent parts
    firstPartTimeoutMs: 30000, // 30 seconds for the first part (cold start tolerance)
    waitBackoffMs: 150,
    showBufferingUI: true,
    ...params.config,
  };
  
  const abortAll = new AbortController();
  let sessionManager: AudioSessionManager | null = null;
  
  // Legacy session for backward compatibility
  const legacySession: PlaybackSession = { 
    abort: abortAll, 
    audioEl: null, 
    mediaSource: null, 
    sourceBuffer: null, 
    lastBlob: null, 
    fileBase: base 
  };
  setSession(legacySession);
  
  try {
    debug(`Starting enhanced buffered prefetch playback (${chunks.length} parts, iOS=${isiOS})`);
    try { 
      notifyUtil(settings, `Starting enhanced playback (${chunks.length} part(s))...`); 
    } catch {}
    
    // Audio session configuration
    const sessionConfig = {
      playbackRate: playbackRateFromRateSetting(settings.rate),
      volume: 1.0,
      preload: 'auto' as const,
    };
    
    // Session event handlers
    const sessionListeners: AudioSessionEventListener = {
      onStateChange: (state, previousState) => {
        debug(`Session state: ${previousState} -> ${state}`);
        if (state === 'stalled' && config.showBufferingUI) {
          try {
            notifyUtil(settings, "Buffering...", true);
          } catch {}
        }
      },
      onError: (error) => {
        logError('Audio session error:', error);
        try {
          notifyUtil(settings, `Playback error: ${error.message}`);
        } catch {}
      },
      onBuffering: (isBuffering) => {
        if (isBuffering && config.showBufferingUI) {
          try {
            notifyUtil(settings, "Buffering...", true);
          } catch {}
        }
      },
    };
    
    sessionManager = new AudioSessionManager(sessionConfig, sessionListeners);
    
    const prefetchWindow = provider.noSynthesisRetry ? 1 : 3;
    const ext = fileExtFromFormat(settings.outputFormat);
    
    const makeTask = (idx: number) => {
if (Array.isArray(prefetchTasks) && prefetchTasks[idx] !== undefined) {
        return prefetchTasks[idx]
          .then(async (r) => {
            if (provider.noSynthesisRetry && r.error) throw new Error(r.error);
            // Some prefetch tasks resolve empty when parts already exist on disk via manifest.
            if (!r.buffer || r.buffer.byteLength === 0) {
              const partPath = `${folder}/${base}_part_${idx + 1}.${ext}`;
              try {
                const data = await app.vault.adapter.readBinary(partPath);
                const ab = data as ArrayBuffer;
                const mime = /(wav|riff)/i.test(settings.outputFormat) ? "audio/wav" : "audio/mpeg";
                debug(`Loaded part ${idx + 1} from disk due to empty prefetch buffer`);
                return { buffer: ab, mime, idx };
              } catch (error) {
                if (provider.noSynthesisRetry) throw error;
                // If not found on disk, fall back to synthesizing now
                debug(`Prefetch buffer empty and file missing; fallback synthesis for part ${idx + 1}`);
                const input = synthesisInput(provider, chunks[idx], settings, lang);
                const stream = await provider.synthesize(input, settings.outputFormat, lang, abortAll.signal);
                const blob = await captureToBlob(stream, undefined, settings.outputFormat);
                const buffer = await blob.arrayBuffer();
                const mime = blob.type || (/(wav|riff)/i.test(settings.outputFormat) ? "audio/wav" : "audio/mpeg");
                return { buffer, mime, idx };
              }
            }
            return { buffer: r.buffer, mime: r.mime, idx };
          })
          .catch(async (error) => {
            if (provider.noSynthesisRetry) throw error;
            debug(`Fallback synthesis for part ${idx + 1}`);
            const input = synthesisInput(provider, chunks[idx], settings, lang);
            const stream = await provider.synthesize(input, settings.outputFormat, lang, abortAll.signal);
            const blob = await captureToBlob(stream, undefined, settings.outputFormat);
            const buffer = await blob.arrayBuffer();
            const mime = blob.type || (/(wav|riff)/i.test(settings.outputFormat) ? "audio/wav" : "audio/mpeg");
            return { buffer, mime, idx };
          });
      }
      
      debug(`Direct synthesis for part ${idx + 1}`);
      const input = synthesisInput(provider, chunks[idx], settings, lang);
      return provider.synthesize(input, settings.outputFormat, lang, abortAll.signal)
        .then(async (stream) => {
          const blob = await captureToBlob(stream, undefined, settings.outputFormat);
          const buffer = await blob.arrayBuffer();
          const mime = blob.type || (/(wav|riff)/i.test(settings.outputFormat) ? "audio/wav" : "audio/mpeg");
          return { buffer, mime, idx };
        });
    };
    
    const tasks: Array<Promise<{ buffer: ArrayBuffer; mime: string; idx: number }>> = new Array(chunks.length);
    let started = startIndex;
    
    // Start initial window of tasks
    while (started < Math.min(startIndex + prefetchWindow, chunks.length)) {
      tasks[started] = makeTask(started);
      started += 1;
    }
    
    let partIdx = startIndex;
    let isFirstPart = true;
    
    while (partIdx < chunks.length && !stopRequested() && !abortAll.signal.aborted) {
      // Maintain prefetch window
      while (started < chunks.length && started - partIdx < prefetchWindow) {
        tasks[started] = makeTask(started);
        started += 1;
      }
      
      try {
        // Check for .partial.mp3 preference first
        let audioPath: string | null = null;
        let audioData: ArrayBuffer | null = null;
        
        if (config.preferPartialMp3 && !provider.noSynthesisRetry) {
          const partialPath = `${folder}/${base}.partial.${ext}`;
          try {
            const partialExists = await app.vault.adapter.exists(partialPath);
            if (partialExists) {
              debug(`Using partial file: ${partialPath}`);
              audioPath = partialPath;
              // Don't load buffer for file-based playback
            }
          } catch {
            debug('Partial file not available, falling back to part chaining');
          }
        }
        
// Fall back to individual parts
        if (!audioPath) {
          // Wait for part to be ready or timeout
          const timeoutMs = (partIdx === startIndex) ? config.firstPartTimeoutMs : config.maxWaitForNext;
          const partData = await Promise.race([
            tasks[partIdx],
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error(`Part timeout (${timeoutMs}ms)`)), timeoutMs);
            })
          ]).catch(async (error) => {
            if (partIdx > startIndex && !provider.noSynthesisRetry) {
              // Not the first part, try to continue
              warn(`Part ${partIdx + 1} failed or timed out:`, error);
              return null;
            } else {
              // First part failed; surface a clearer message
              const msg = error instanceof Error ? error.message : String(error);
              warn(`First part timed out after ${timeoutMs}ms; aborting start`, msg);
              throw error;
            }
          });
          
          if (!partData) {
            // Skip this part and try next
            partIdx += 1;
            continue;
          }
          
          const { buffer, mime } = partData;
          if (!buffer || buffer.byteLength === 0) {
            throw new Error(`Empty audio buffer for part ${partIdx + 1}`);
          }
          
          audioData = buffer;
          
          // Create blob URL for playback
          const blob = new Blob([buffer], { type: mime });
          audioPath = URL.createObjectURL(blob);
        }
        
        // Start playback with session manager
        try {
          await sessionManager.startWithPart(audioPath);
          
          // Update legacy session for compatibility
          legacySession.audioEl = sessionManager.audio;
          legacySession.objectUrl = audioPath.startsWith('blob:') ? audioPath : undefined;
          setSession({ ...legacySession });
          
          if (config.immediateStart || isFirstPart) {
            debug(`Starting immediate playback for part ${partIdx + 1}`);
            await sessionManager.play();
            
            if (isFirstPart) {
              const startDelay = Date.now();
              try {
                notifyUtil(settings, `Playback started`, true);
                debug(`First part playback started after ${Date.now() - startDelay}ms`);
              } catch {}
              isFirstPart = false;
            }
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          logError(`Audio play failed for part ${partIdx + 1}:`, msg);
          try {
            notifyUtil(settings, `Audio play failed: ${msg}`);
          } catch {}
          
          // Clean up blob URL if we created one
          if (audioPath?.startsWith('blob:')) {
            try {
              URL.revokeObjectURL(audioPath);
            } catch {}
          }
          
          // Try to continue with next part
          partIdx += 1;
          continue;
        }
        
        // Handle part data (append to merged, save to disk)
        if (audioData) {
          if (appendToMerged) {
            try {
              appendToMerged(new Uint8Array(audioData));
            } catch (error) {
              warn('Failed to append to merged:', error);
            }
          }
          
          if (savePerPart) {
            try {
              const partPath = `${folder}/${base}_part_${partIdx + 1}.${ext}`;
              await writeBinary(app, partPath, audioData);
              await upsertAudioReferenceSorted(app, file, partPath);
              debug(`Saved part ${partIdx + 1} to ${partPath}`);
            } catch (error) {
              warn(`Failed to save part ${partIdx + 1}:`, error);
            }
          }
        }
        
        // Wait for current part to finish or be aborted
        try {
          if (sessionManager.audio) {
            await waitForEndOrAbort(sessionManager.audio, abortAll.signal);
          }
        } catch (error) {
          debug('Playback interrupted:', error);
        }
        
        // Handle end of part - check if we should wait for next or continue
        if (partIdx < chunks.length - 1 && !stopRequested() && !abortAll.signal.aborted) {
          // Not the last part, check if next part is ready
          const nextPartIdx = partIdx + 1;
          if (nextPartIdx < tasks.length) {
            const isNextReady = await Promise.race([
              tasks[nextPartIdx].then(() => true),
              new Promise<boolean>(resolve => setTimeout(() => resolve(false), config.waitBackoffMs))
            ]);
            
            if (!isNextReady && config.showBufferingUI) {
              try {
                notifyUtil(settings, "Buffering next part...", true);
              } catch {}
              
              // Wait with exponential backoff up to cap
              let waitTime = config.waitBackoffMs;
              const maxWait = Math.min(config.maxWaitForNext, 5000);
              const startWait = Date.now();
              
              while (waitTime <= maxWait && !stopRequested() && !abortAll.signal.aborted) {
                await new Promise(resolve => setTimeout(resolve, waitTime));
                
                const isNowReady = await Promise.race([
                  tasks[nextPartIdx].then(() => true),
                  new Promise<boolean>(resolve => setTimeout(() => resolve(false), 50))
                ]);
                
                if (isNowReady) {
                  debug(`Next part became ready after ${Date.now() - startWait}ms`);
                  break;
                }
                
                waitTime = Math.min(waitTime * 1.5, maxWait);
              }
            }
          }
        }
        
        // Clean up blob URL if we created one
        if (audioPath?.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(audioPath);
          } catch {}
        }
        
        if (stopRequested() || abortAll.signal.aborted) break;
        partIdx += 1;
        
      } catch (error) {
        logError(`Error processing part ${partIdx + 1}:`, error);
        
        // Try to continue with next part unless it's the first
        if (partIdx === startIndex || provider.noSynthesisRetry) {
          throw error; // Can't continue if first part fails
        }
        
        partIdx += 1;
      }
    }
    
    debug(`Enhanced buffered playback completed (processed ${partIdx - startIndex} parts)`);
    
  } finally {
    try {
      debug('Cleaning up enhanced buffered playback');
      abortAll.abort();
    } catch {}
    
    try {
      if (sessionManager) {
        sessionManager.dispose();
        sessionManager = null;
      }
    } catch {}
    
    try {
      await cleanupSessionResourcesHelper(null, true);
    } catch {}
    
    setSession(null);
  }
}

/**
 * Legacy buffered prefetch playback function for backward compatibility.
 * @deprecated Use playEnhancedBufferedPrefetch instead
 */
export async function playBufferedPrefetch(params: {
  app: App;
  settings: TtsSettings;
  provider: TtsProvider;
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
  appendToMerged?: (bytes: Uint8Array) => void;
  savePerPart?: boolean;
  prefetchTasks?: Array<Promise<PrefetchResult>>;
}): Promise<void> {
  // Forward to enhanced implementation
  return playEnhancedBufferedPrefetch({
    ...params,
    config: {
      immediateStart: true,
      preferPartialMp3: false, // Maintain legacy behavior
      maxWaitForNext: 5000,
      waitBackoffMs: 150,
      showBufferingUI: false, // Maintain legacy behavior
    },
  });
}
