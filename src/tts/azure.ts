/**
 * Azure TTS over HTTPS streaming and helpers.
 */

/**
 * Resolve a MIME type based on Azure output format string.
 *
 * @param {string} outputFormat Azure format.
 * @returns {string} MIME type.
 */
export function mimeFromFormat(outputFormat: string): string {
  return /riff|wav/i.test(outputFormat) ? "audio/wav" : "audio/mpeg";
}

/**
 * Start Azure AI Speech HTTP streaming for a chunk of SSML.
 *
 * @param {string} apiKey Azure API key.
 * @param {string} region Azure region.
 * @param {string} outputFormat Azure output format string.
 * @param {string} ssml SSML payload.
 * @param {AbortSignal} abortSignal Abort signal.
 * @returns {Promise<ReadableStream<Uint8Array>>} Readable byte stream.
 */
export async function startHttpStream(
  apiKey: string,
  region: string,
  outputFormat: string,
  ssml: string,
  abortSignal: AbortSignal
): Promise<ReadableStream<Uint8Array>> {
  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const fmt = outputFormat && outputFormat.trim() ? outputFormat.trim() : "audio-24khz-48kbitrate-mono-mp3";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      accept: "*/*",
      "Ocp-Apim-Subscription-Key": apiKey,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": fmt
    },
    body: ssml,
    signal: abortSignal
  });
  if (!res.ok || !res.body) {
    let detail = "";
    try { detail = await res.text(); } catch {}
    throw new Error(`TTS stream failed: ${res.status}${detail ? ` - ${detail}` : ""}`);
  }
  return res.body as ReadableStream<Uint8Array>;
}

/**
 * Capture a byte stream into a Blob while optionally invoking a per-chunk callback.
 *
 * @param {ReadableStream<Uint8Array>} stream Input stream.
 * @param {(chunk: Uint8Array) => void | undefined} onChunk Optional per-chunk callback.
 * @param {string} outputFormat Azure format to determine MIME.
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
  const mime = mimeFromFormat(outputFormat || "audio-24khz-48kbitrate-mono-mp3");
  return new Blob([out], { type: mime });
}

