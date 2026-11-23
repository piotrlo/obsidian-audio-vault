export async function downloadPart(
  synthesize: (signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>,
  signal: AbortSignal,
  idleMs = 30_000,
): Promise<ArrayBuffer> {
  signal.throwIfAborted();
  const part = new AbortController();
  const cancel = () => part.abort(signal.reason);
  signal.addEventListener("abort", cancel, { once: true });
  let phase = "waiting for Cartesia";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resetTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(() => part.abort(new Error(`Timed out while ${phase} (no progress).`)), idleMs);
  };
  resetTimeout();
  try {
    const stream = await synthesize(part.signal);
    phase = "downloading audio from Cartesia";
    resetTimeout();
    const reader = stream.getReader();
    const cancelRead = () => void reader.cancel().catch(() => {});
    part.signal.addEventListener("abort", cancelRead, { once: true });
    try {
      if (part.signal.aborted) cancelRead();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        part.signal.throwIfAborted();
        if (done) break;
        if (!value.byteLength) continue;
        resetTimeout();
        chunks.push(value);
        size += value.byteLength;
      }
      if (!size) throw new Error("Cartesia returned empty audio.");
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes.buffer;
    } finally {
      part.signal.removeEventListener("abort", cancelRead);
      reader.releaseLock();
    }
  } catch (error) {
    if (part.signal.aborted) throw part.signal.reason;
    if (error instanceof TypeError || (error instanceof Error && error.name === "NetworkError")) {
      throw new Error(`Connection failed while ${phase}. Cartesia may have processed the request; check usage before retrying.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
