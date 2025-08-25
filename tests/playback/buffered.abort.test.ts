import { describe, it, expect } from "bun:test";
import { playBufferedPrefetch } from "../../src/playback/buffered";

function makeEnv(){
  const written: string[] = [];
  const app: any = { vault: { adapter: { writeBinary: async (p: string, _b: ArrayBuffer) => { written.push(p); } }, read: async () => "", modify: async () => {} } };
  const file: any = { path: "Note.md" };
  return { app, file, written };
}

describe("playback/buffered abort flow", () => {
  it("returns early when stopRequested is true (no processing)", async () => {
    const { app, file, written } = makeEnv();
    const settings = { outputFormat: 'audio-24khz-48kbitrate-mono-mp3', rate: 0, voiceName: 'v' } as any;
    const provider = { synthesize: async () => new ReadableStream<Uint8Array>({ start(c){ setTimeout(() => { c.enqueue(new Uint8Array([1])); c.close(); }, 0); } }) } as any;
    const chunks = ["A", "B", "C"];
    const stopRequested = () => true; // immediate stop
    const setSession = (_s: any) => {};
    const writeBinary = async (a: any, p: string, b: ArrayBuffer) => { await app.vault.adapter.writeBinary(p, b); };
    const upsertAudioReferenceSorted = async () => {};
    await playBufferedPrefetch({ app, settings, provider, chunks, startIndex: 0, base: 'base', lang: 'en-US', folder: 'Audio', file, stopRequested, setSession, writeBinary, upsertAudioReferenceSorted });
    expect(written.length).toBe(0);
  });
});


