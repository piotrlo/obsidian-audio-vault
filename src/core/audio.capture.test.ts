import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { captureToBlob, canStream } from "./audio";

function makeStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) { controller.enqueue(chunks[i++]); }
      else { controller.close(); }
    }
  });
}

describe("core/audio", () => {
  it("captureToBlob concatenates chunks and sets MIME", async () => {
    const a = new Uint8Array([1,2,3]);
    const b = new Uint8Array([4,5]);
    const blob = await captureToBlob(makeStream([a,b]), undefined, "audio-24khz-48kbitrate-mono-mp3");
    expect(blob.type).toContain("audio/mpeg");
    const buf = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(buf)).toEqual([1,2,3,4,5]);
  });

  it("canStream returns supported when MediaSource supports given MIME", () => {
    const orig = (globalThis as any).MediaSource;
    (globalThis as any).MediaSource = class {
      static isTypeSupported(mime: string){ return /audio\/(mpeg|wav)/.test(mime); }
    } as any;
    const { supported, mime } = canStream("audio-24khz-48kbitrate-mono-mp3");
    expect(mime).toContain("audio/mpeg");
    expect(supported).toBe(true);
    (globalThis as any).MediaSource = orig;
  });
});


