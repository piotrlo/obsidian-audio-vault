import { test, expect } from "bun:test";
import { playStreamedPartAndSave } from "../../src/playback/streaming";
import type { TtsProvider, Voice } from "../../src/types";

test("playStreamedPartAndSave throws when fetch fails (no MSE env)", async () => {
  const app: any = {
    vault: {
      adapter: { writeBinary: async () => {} },
      modify: async () => {}
    }
  };
  const abort = new AbortController();
  await expect(playStreamedPartAndSave({
    app,
    settings: { azureApiKey: "k", azureRegion: "r", outputFormat: "audio-24khz-48kbitrate-mono-mp3", rate: "+0%", voiceName: "en-US" } as any,
    provider: new (class implements TtsProvider {
      async synthesize(): Promise<ReadableStream<Uint8Array>> { throw new Error("fetch failed"); }
      async listVoices(): Promise<Voice[]> { return []; }
    })(),
    ssml: "<speak>hi</speak>",
    base: "note",
    part: 1,
    folder: "Audio",
    file: {} as any,
    abort,
    setSession: () => {}
  })).rejects.toBeTruthy();
});


