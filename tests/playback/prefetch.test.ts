/**
 * Tests for enhanced PrefetchOrchestrator with manifest-driven resume capability.
 */

import { test, expect, mock, beforeEach } from "bun:test";
import type { TtsProvider, Voice, AudioManifest } from "../../src/types";

// Mock the platform module to avoid Obsidian dependencies
const mockPlatform = {
  isIOS: () => false,
};

// Simple test version without complex mocking
function makeApp(initial: Record<string, string | ArrayBuffer> = {}) {
  const files = new Map<string, string | ArrayBuffer>(Object.entries(initial));
  const app: any = {
    vault: {
      adapter: {
        exists: async (p: string) => files.has(p),
        read: async (p: string) => {
          const content = files.get(p);
          if (content === undefined) throw new Error("ENOENT");
          return content as string;
        },
        write: async (p: string, content: string) => { files.set(p, content); },
        readBinary: async (p: string) => {
          const content = files.get(p);
          if (content === undefined) throw new Error("ENOENT");
          return content as ArrayBuffer;
        },
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
      // Add missing methods that fs.ts needs
      read: async (file: any) => {
        const content = files.get(file.path);
        if (content === undefined) throw new Error("ENOENT");
        return content as string;
      },
      modify: async (file: any, content: string) => {
        files.set(file.path, content);
      },
      createFolder: async (folder: string) => {
        // Mock folder creation - no-op for tests
      },
    }
  };
  return { app, files };
}

class TestTtsProvider implements TtsProvider {
  calls: number = 0;
  shouldFail: boolean = false;
  
  async synthesize(): Promise<ReadableStream<Uint8Array>> {
    this.calls += 1;
    
    if (this.shouldFail) {
      throw new Error("TTS synthesis failed");
    }
    
    const payload = new Uint8Array([1, 2, 3, 4]);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(payload);
        controller.close();
      }
    });
  }
  
  async listVoices(): Promise<Voice[]> {
    return [];
  }
}

function createTestSettings() {
  return {
    voiceName: "en-US-Test",
    rate: "+0%",
    outputFormat: "audio-24khz-48kbitrate-mono-mp3",
    azureApiKey: "test-key",
    azureRegion: "westeurope",
    enableStreaming: false,
    audioFolder: "Audio",
    language: "en-US" as const,
    onlyHdVoices: false,
    mergeParts: false,
  };
}

beforeEach(() => {
  // Mock the platform module before each test
  mock.module("../../src/core/platform", () => mockPlatform);
});
// Use dynamic import to avoid mocking issues
test("prefetch downloads all parts with concurrency", async () => {
  const { prefetchAllParts } = await import("../../src/playback/prefetch");
  
  const { app, files } = makeApp({
    "test-note.md": "# Test Note\n\nSome content here.\n"
  });
  const provider = new TestTtsProvider();
  const settings = createTestSettings();
  const chunks = ["Hello", "World", "Test"];
  
  const result = await prefetchAllParts({
    app: app as any,
    settings: settings as any,
    provider,
    chunks,
    base: "test-note",
    folder: "Audio",
    file: { path: "test-note.md", basename: "test-note" } as any,
    lang: "en-US",
    concurrency: 2,
  });
  
  // Wait for all downloads to complete
  await result.allDone;
  
  expect(result.tasks).toHaveLength(3);
  expect(provider.calls).toBe(3);
  
  // Check that part files were created
  expect(files.has("Audio/test-note_part_1.mp3")).toBe(true);
  expect(files.has("Audio/test-note_part_2.mp3")).toBe(true);
  expect(files.has("Audio/test-note_part_3.mp3")).toBe(true);
  
  // Check that manifest was created
  expect(files.has("Audio/test-note.manifest.json")).toBe(true);
});

test("prefetch resumes from existing manifest", async () => {
  const { prefetchAllParts } = await import("../../src/playback/prefetch");
  
  // Create initial state with manifest showing part 1 already downloaded
  const existingManifest: AudioManifest = {
    version: 1,
    ext: "mp3",
    totalParts: 3,
    fetchedParts: [1], // Part 1 already exists
    mergedUntil: 0,
    updatedAt: Date.now() - 1000,
  };
  
  const part1Data = new Uint8Array([5, 6, 7, 8]).buffer;
  
  const { app, files } = makeApp({
    "test-note.md": "# Test Note\n\nSome content here.\n",
    "Audio/test-note.manifest.json": JSON.stringify(existingManifest),
    "Audio/test-note_part_1.mp3": part1Data,
  });
  
  const provider = new TestTtsProvider();
  const settings = createTestSettings();
  const chunks = ["Part 1", "Part 2", "Part 3"];
  
  const result = await prefetchAllParts({
    app: app as any,
    settings: settings as any, 
    provider,
    chunks,
    base: "test-note",
    folder: "Audio",
    file: { path: "test-note.md", basename: "test-note" } as any,
    lang: "en-US",
  });
  
  await result.allDone;
  
  // Should only have downloaded parts 2 and 3 (part 1 already existed)
  expect(provider.calls).toBe(2);
  
  // All parts should exist
  expect(files.has("Audio/test-note_part_1.mp3")).toBe(true);
  expect(files.has("Audio/test-note_part_2.mp3")).toBe(true);
  expect(files.has("Audio/test-note_part_3.mp3")).toBe(true);
});

test("prefetch handles synthesis failures gracefully", async () => {
  const { prefetchAllParts } = await import("../../src/playback/prefetch");
  
  const { app, files } = makeApp({
    "test-note.md": "# Test Note\n\nSome content here.\n"
  });
  const provider = new TestTtsProvider();
  provider.shouldFail = true; // Make provider fail
  
  const settings = createTestSettings();
  const chunks = ["Hello"];
  
  const result = await prefetchAllParts({
    app: app as any,
    settings: settings as any,
    provider,
    chunks,
    base: "test-note",
    folder: "Audio", 
    file: { path: "test-note.md", basename: "test-note" } as any,
    lang: "en-US",
  });
  
  await result.allDone;
  
  // Should have attempted synthesis
  expect(provider.calls).toBe(1);
  
  // Part file should not exist (failed)
  expect(files.has("Audio/test-note_part_1.mp3")).toBe(false);
  
  // Manifest should still be created
  expect(files.has("Audio/test-note.manifest.json")).toBe(true);
});

test("prefetch uses force regenerate correctly", async () => {
  const { prefetchAllParts } = await import("../../src/playback/prefetch");
  
  // Setup with existing manifest showing all parts completed
  const existingManifest: AudioManifest = {
    version: 1,
    ext: "mp3",
    totalParts: 2,
    fetchedParts: [1, 2], // All parts exist
    mergedUntil: 0,
    updatedAt: Date.now(),
  };
  
  const { app, files } = makeApp({
    "test-note.md": "# Test Note\n\nSome content here.\n",
    "Audio/test-note.manifest.json": JSON.stringify(existingManifest),
    "Audio/test-note_part_1.mp3": new Uint8Array([1]).buffer,
    "Audio/test-note_part_2.mp3": new Uint8Array([2]).buffer,
  });
  
  const provider = new TestTtsProvider();
  const settings = createTestSettings();
  const chunks = ["Part 1", "Part 2"];
  
  const result = await prefetchAllParts({
    app: app as any,
    settings: settings as any,
    provider,
    chunks,
    base: "test-note",
    folder: "Audio",
    file: { path: "test-note.md", basename: "test-note" } as any,
    lang: "en-US",
    forceRegenerate: true, // Force regeneration
  });
  
  await result.allDone;
  
  // Should have downloaded both parts despite existing manifest
  expect(provider.calls).toBe(2);
});

test("prefetch tracks progress correctly", async () => {
  const { prefetchAllParts } = await import("../../src/playback/prefetch");
  
  const { app } = makeApp({
    "test-note.md": "# Test Note\n\nSome content here.\n"
  });
  const provider = new TestTtsProvider();
  const settings = createTestSettings();
  const chunks = ["Hello", "World"];
  
  const progressEvents: any[] = [];
  const onProgress = (info: any) => {
    progressEvents.push(info);
  };
  
  const result = await prefetchAllParts({
    app: app as any,
    settings: settings as any,
    provider,
    chunks,
    base: "test-note",
    folder: "Audio",
    file: { path: "test-note.md", basename: "test-note" } as any,
    lang: "en-US",
    onProgress,
  });
  
  await result.allDone;
  
  // Should have received progress events
  expect(progressEvents.length).toBeGreaterThan(0);
  
  // Check that we got events for both parts
  const savedEvents = progressEvents.filter(e => e.state === 'saved');
  expect(savedEvents.length).toBe(2);
});


