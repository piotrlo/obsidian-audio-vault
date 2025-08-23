import { test, expect } from "bun:test";
import { playStreamedPartAndSave } from "../../src/playback/streaming";

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
    ssml: "<speak>hi</speak>",
    base: "note",
    part: 1,
    folder: "Audio",
    file: {} as any,
    abort,
    setSession: () => {}
  })).rejects.toBeTruthy();
});


