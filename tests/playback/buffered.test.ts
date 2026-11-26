import { test, expect, mock } from "bun:test";
import { playBufferedPrefetch } from "../../src/playback/buffered";
import type { TtsProvider, Voice } from "../../src/types";
import { Notice, requestUrl } from "../__mocks__/obsidian";

// Mock the obsidian module
mock.module("obsidian", () => {
  return {
    Platform: {
      isIosApp: false,
    },
    Notice,
    requestUrl,
  };
});

test("playBufferedPrefetch starts and finishes with empty chunks", async () => {
  const app: any = {
    vault: {
      adapter: {
        writeBinary: async () => {}
      }
    }
  };
  await playBufferedPrefetch({
    app,
    settings: { voiceName: "en-US", rate: "+0%", azureApiKey: "k", azureRegion: "r", outputFormat: "audio-24khz-48kbitrate-mono-mp3" } as any,
    provider: new (class implements TtsProvider {
      async synthesize(): Promise<ReadableStream<Uint8Array>> { return new ReadableStream<Uint8Array>({ start(c){ c.close(); } }); }
      async listVoices(): Promise<Voice[]> { return []; }
    })(),
    chunks: [],
    startIndex: 0,
    base: "note",
    lang: "en-US",
    folder: "Audio",
    file: {} as any,
    stopRequested: () => false,
    setSession: () => {},
    writeBinary: async () => {},
    upsertAudioReferenceSorted: async () => {}
  });
  expect(true).toBe(true);
});


