/**
 * Audio-related helpers extracted from the plugin entrypoint for reuse and testability.
 */

import { mimeFromFormat } from "../tts/azure";

/**
 * Waits until the audio ends or the abort signal fires.
 */
export function waitForEndOrAbort(audioEl: HTMLAudioElement, abortSignal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const onEnded = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      try { audioEl.pause(); } catch {}
      cleanup();
      resolve();
    };
    const cleanup = () => {
      audioEl.removeEventListener("ended", onEnded);
      abortSignal.removeEventListener("abort", onAbort as any);
    };
    audioEl.addEventListener("ended", onEnded, { once: true });
    abortSignal.addEventListener("abort", onAbort as any, { once: true });
  });
}

/**
 * Determines whether MSE streaming is supported for the given output format.
 * Returns both support flag and resolved MIME for convenience.
 */
export function canStream(outputFormat: string): { supported: boolean; mime: string } {
  const mime = mimeFromFormat(outputFormat);
  const supported = typeof MediaSource !== "undefined"
    && (MediaSource as any).isTypeSupported
    && MediaSource.isTypeSupported(mime);
  return { supported, mime };
}


