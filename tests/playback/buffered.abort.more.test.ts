import { describe, it, expect, mock } from "bun:test";
import { playBufferedPrefetch } from "../../src/playback/buffered";
import { Notice, requestUrl } from "../__mocks__/obsidian";

// Mock Obsidian Platform
mock.module("obsidian", () => ({
  Platform: {
    isIosApp: false,
  },
  Notice,
  requestUrl,
}));

function makeEnv(){
  const written: Array<{ path: string; buf: ArrayBuffer }> = [];
  const app: any = { vault: { adapter: { writeBinary: async (p: string, b: ArrayBuffer) => { written.push({ path: p, buf: b }); } }, read: async () => "", modify: async (_f: any, _c: string) => {} } };
  const file: any = { path: "Note.md" };
  return { app, file, written };
}

describe("playback/buffered abort+timeout-like flow", () => {
  it("stops when stopRequested toggles early", async () => {
    const { app, file, written } = makeEnv();
    const settings = { outputFormat: 'audio-24khz-48kbitrate-mono-mp3', rate: 0, voiceName: 'en-US-Test' } as any;
    const provider = { synthesize: async () => new ReadableStream<Uint8Array>({ start(c){ c.enqueue(new Uint8Array([1,2,3])); c.close(); } }) } as any;
    const stopRequested = () => true;
    const setSession = (_s: any) => {};
    await playBufferedPrefetch({ app, settings, provider, chunks: ["a","b"], startIndex: 0, base: 'base', lang: 'en-US', folder: 'Audio', file, stopRequested, setSession, writeBinary: async (...args: any[]) => (await app.vault.adapter.writeBinary as any)(...args), upsertAudioReferenceSorted: async () => {} });
    expect(written.length).toBe(0);
  });
});


