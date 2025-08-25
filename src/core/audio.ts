/**
 * Audio-related helpers extracted from the plugin entrypoint for reuse and testability.
 */

import { mimeFromFormat } from "../core/helpers";

/**
 * Waits until the audio ends or the abort signal fires.
 */
export function waitForEndOrAbort(audioEl: HTMLAudioElement, abortSignal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (abortSignal.aborted) {
      try { audioEl.pause(); } catch {}
      return resolve();
    }
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

/**
 * Capture a byte stream into a Blob while optionally invoking a per-chunk callback.
 *
 * @param {ReadableStream<Uint8Array>} stream Input stream.
 * @param {(chunk: Uint8Array) => void | undefined} onChunk Optional per-chunk callback.
 * @param {string} outputFormat Format string for MIME detection.
 * @returns {Promise<Blob>} Final Blob.
 */
export async function captureToBlob(
  stream: ReadableStream<Uint8Array>,
  onChunk: ((chunk: Uint8Array) => void) | undefined,
  outputFormat: string
): Promise<Blob> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      if (onChunk) onChunk(value);
      chunks.push(value);
    }
  }
  const totalLen = chunks.reduce((n, a) => n + a.byteLength, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  const mime = mimeFromFormat(outputFormat);
  return new Blob([out], { type: mime });
}


