import { expect, mock, test } from "bun:test";
import { downloadPart } from "../../src/tts/download-part";
import { openPendingAudio } from "../../src/tts/pending-audio";

function storage() {
  const files = new Map<string, ArrayBuffer>();
  const folders = new Set<string>();
  const adapter = {
    async exists(path: string) { return files.has(path) || folders.has(path); },
    async mkdir(path: string) { folders.add(path); },
    async readBinary(path: string) { return files.get(path)!; },
    async writeBinary(path: string, data: ArrayBuffer) { files.set(path, data); },
    async rename(oldPath: string, newPath: string) {
      files.set(newPath, files.get(oldPath)!);
      files.delete(oldPath);
    },
    async remove(path: string) { files.delete(path); },
  };
  return { adapter, files };
}

test("reopens the same job after a network error without paying for its completed part twice", async () => {
  const { adapter, files } = storage();
  const signal = new AbortController().signal;
  const identity = ["Notes/Example.md", "voice", "pl-PL", ["first", "second"]];
  const job = await openPendingAudio(adapter, "pending", identity);
  const first = mock(async () => new Uint8Array([1, 2]).buffer);
  await job.getOrGenerate(0, first, signal);
  const second = mock(async () => new Uint8Array([3, 4]).buffer);
  second.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await expect(job.getOrGenerate(1, () => downloadPart(async () => {
    await second();
    throw new Error("Unexpected");
  }, signal), signal)).rejects.toThrow("Connection failed while waiting for Cartesia");
  expect(files.size).toBe(1);
  const resumed = await openPendingAudio(adapter, "pending", identity);
  expect(new Uint8Array(await resumed.getOrGenerate(0, first, signal))).toEqual(new Uint8Array([1, 2]));
  expect(new Uint8Array(await resumed.getOrGenerate(1, second, signal))).toEqual(new Uint8Array([3, 4]));
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(2);
  expect(resumed.completed).toBe(2);
  await resumed.clear();
  expect(files.size).toBe(0);
});

test("does not use parts from a different note, voice, or chunk plan", async () => {
  const { adapter } = storage();
  const signal = new AbortController().signal;
  const generate = mock(async () => new ArrayBuffer(1));
  for (const identity of [
    ["a.md", "voice-1", ["a", "b"]],
    ["b.md", "voice-1", ["a", "b"]],
    ["a.md", "voice-2", ["a", "b"]],
    ["a.md", "voice-1", ["a b"]],
  ]) {
    await (await openPendingAudio(adapter, "pending", identity)).getOrGenerate(0, generate, signal);
  }
  expect(generate).toHaveBeenCalledTimes(4);
});

test("distinguishes a broken audio stream from failure to reach Cartesia", async () => {
  const signal = new AbortController().signal;
  await expect(downloadPart(async () => new ReadableStream({
    start(controller) { controller.error(new TypeError("network error")); },
  }), signal)).rejects.toThrow("Connection failed while downloading audio from Cartesia");
});

test("times out a stalled audio stream", async () => {
  const signal = new AbortController().signal;
  await expect(downloadPart(async () => new ReadableStream(), signal, 25))
    .rejects.toThrow("Timed out while downloading audio from Cartesia");
});

test("keeps downloading beyond the idle timeout when audio bytes still arrive", async () => {
  const signal = new AbortController().signal;
  let count = 0;
  const data = await downloadPart(async () => new ReadableStream({
    async pull(controller) {
      await Bun.sleep(40);
      controller.enqueue(new Uint8Array([++count]));
      if (count === 8) controller.close();
    },
  }), signal, 250);
  expect(new Uint8Array(data)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
});
