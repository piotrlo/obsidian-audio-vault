import { test, expect } from "bun:test";
import { mimeFromFormat, captureToBlob } from "../../src/tts/azure";

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    }
  });
}

test("mimeFromFormat maps to audio/mpeg for mp3 and audio/wav for riff", () => {
  expect(mimeFromFormat("audio-24khz-48kbitrate-mono-mp3")).toBe("audio/mpeg");
  expect(mimeFromFormat("riff-24khz-16bit-mono-pcm")).toBe("audio/wav");
});

test("captureToBlob assembles bytes into a Blob", async () => {
  const chunks = [new Uint8Array([1,2,3]), new Uint8Array([4,5])];
  const stream = streamFromChunks(chunks);
  const blob = await captureToBlob(stream, undefined, "audio-24khz-48kbitrate-mono-mp3");
  expect(blob.size).toBe(5);
  expect(blob.type).toBe("audio/mpeg");
});
