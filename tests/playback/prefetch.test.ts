import { describe, it, expect } from "bun:test";
import { prefetchAllParts } from "../../src/playback/prefetch";
import type { TtsProvider, Voice } from "../../src/types";

function makeApp(initial: Record<string, string | ArrayBuffer> = {}) {
  const files = new Map<string, string | ArrayBuffer>(Object.entries(initial));
  const app: any = {
    vault: {
      adapter: {
        exists: async (p: string) => files.has(p),
        read: async (p: string) => (files.get(p) as string) ?? "",
        write: async (p: string, content: string) => { files.set(p, content); },
        readBinary: async (p: string) => (files.get(p) as ArrayBuffer) ?? new Uint8Array([]).buffer,
        writeBinary: async (p: string, data: ArrayBuffer) => { files.set(p, data); },
        rename: async (oldPath: string, newPath: string) => {
          const v = files.get(oldPath);
          if (v === undefined) throw new Error("ENOENT");
          files.set(newPath, v);
          files.delete(oldPath);
        },
        remove: async (p: string) => { files.delete(p); },
      },
      getFiles: () => Array.from(files.keys()).map((path) => ({ path })),
    }
  };
  return { app, files };
}

class FakeProvider implements TtsProvider {
  calls: number = 0;
  async synthesize(): Promise<ReadableStream<Uint8Array>> {
    this.calls += 1;
    const payload = new Uint8Array([1,2,3]);
    return new ReadableStream<Uint8Array>({ start(c){ c.enqueue(payload); c.close(); } });
  }
  async listVoices(): Promise<Voice[]> { return []; }
}

describe("prefetch orchestrator", () => {
  it("downloads all parts with concurrency and writes manifest/partial", async () => {
    const { app, files } = makeApp({});
    const provider = new FakeProvider();
    const settings: any = { voiceName: "en-US", rate: "+0%", outputFormat: "audio-24khz-48kbitrate-mono-mp3" };
    const chunks = ["a", "b", "c"];
    const { tasks } = await prefetchAllParts({
      app: app as any,
      settings,
      provider,
      chunks,
      base: "note",
      folder: "Audio",
      file: { path: "Note.md" } as any,
      lang: "en-US",
      concurrency: 2,
      enablePartialMerge: true,
    });
    const results = await Promise.all(tasks);
    expect(results.length).toBe(3);
    expect(files.has("Audio/note_part_1.mp3")).toBe(true);
    expect(files.has("Audio/note_part_2.mp3")).toBe(true);
    expect(files.has("Audio/note_part_3.mp3")).toBe(true);
    expect(files.has("Audio/note.partial.mp3")).toBe(true);
    const manifestRaw = files.get("Audio/note.manifest.json") as string;
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.totalParts).toBe(3);
    expect(manifest.fetchedParts.length).toBe(3);
    expect(manifest.mergedUntil).toBeGreaterThanOrEqual(1);
    expect(provider.calls).toBeGreaterThanOrEqual(3);
  });

  it("resumes by skipping already fetched parts", async () => {
    const buf = new Uint8Array([9]).buffer;
    const { app, files } = makeApp({
      "Audio/note_part_2.mp3": buf,
      "Audio/note.manifest.json": JSON.stringify({ version: 1, ext: "mp3", totalParts: 3, fetchedParts: [2], mergedUntil: 0, updatedAt: Date.now() })
    });
    const provider = new FakeProvider();
    const settings: any = { voiceName: "en-US", rate: "+0%", outputFormat: "audio-24khz-48kbitrate-mono-mp3" };
    const chunks = ["a", "b", "c"];
    const { tasks } = await prefetchAllParts({
      app: app as any,
      settings,
      provider,
      chunks,
      base: "note",
      folder: "Audio",
      file: { path: "Note.md" } as any,
      lang: "en-US",
      concurrency: 2,
      enablePartialMerge: false,
    });
    await Promise.all(tasks);
    expect(provider.calls).toBe(2);
    expect(files.has("Audio/note_part_1.mp3")).toBe(true);
    expect(files.has("Audio/note_part_2.mp3")).toBe(true);
    expect(files.has("Audio/note_part_3.mp3")).toBe(true);
  });
});


