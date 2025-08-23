import { test, expect } from "bun:test";
import { tryPlayExistingParts } from "../../src/playback/existing";

test("tryPlayExistingParts returns false when no files", async () => {
  const app: any = {
    vault: {
      adapter: {
        exists: async () => false,
        readBinary: async () => new Uint8Array(),
      },
      getFiles: () => []
    }
  };
  const ok = await tryPlayExistingParts({
    app,
    settings: { outputFormat: "audio-24khz-48kbitrate-mono-mp3", rate: "+0%" } as any,
    base: "note",
    folder: "Audio",
    stopRequested: () => false,
    setSession: () => {}
  });
  expect(ok).toBe(false);
});


