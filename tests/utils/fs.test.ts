/**
 * Tests for filesystem utilities with Result pattern and atomic operations.
 */

import { test, expect, mock } from "bun:test";
import { 
  writeFileAtomic, 
  readManifestSafe, 
  writeManifestSafe,
  removeFiles,
  buildManifestPath,
  buildPartPath,
  buildMergedPath,
  buildPartialPath,
} from "../../src/utils/fs";
import type { AudioManifest } from "../../src/types";

// Mock Obsidian App interface
const createMockApp = () => {
  const storage = new Map<string, string | ArrayBuffer>();
  
  return {
    vault: {
      adapter: {
        write: mock(async (path: string, data: string) => {
          storage.set(path, data);
        }),
        writeBinary: mock(async (path: string, data: ArrayBuffer) => {
          storage.set(path, data);
        }),
        read: mock(async (path: string) => {
          const data = storage.get(path);
          if (data === undefined) throw new Error("File not found");
          if (typeof data !== 'string') throw new Error("Not a text file");
          return data;
        }),
        exists: mock(async (path: string) => {
          return storage.has(path);
        }),
        rename: mock(async (oldPath: string, newPath: string) => {
          const data = storage.get(oldPath);
          if (data === undefined) throw new Error("Source file not found");
          storage.set(newPath, data);
          storage.delete(oldPath);
        }),
        remove: mock(async (path: string) => {
          if (!storage.has(path)) throw new Error("File not found");
          storage.delete(path);
        }),
      }
    },
    storage,
  } as any;
};

test("writeFileAtomic writes text data successfully", async () => {
  const app = createMockApp();
  const result = await writeFileAtomic(app, "test.txt", "hello world");
  
  expect(result.ok).toBe(true);
  expect(app.storage.get("test.txt")).toBe("hello world");
  expect(app.storage.has("test.txt.tmp")).toBe(false);
});

test("writeFileAtomic writes binary data successfully", async () => {
  const app = createMockApp();
  const data = new ArrayBuffer(8);
  const view = new Uint8Array(data);
  view[0] = 42;
  
  const result = await writeFileAtomic(app, "test.bin", data);
  
  expect(result.ok).toBe(true);
  expect(app.storage.get("test.bin")).toBe(data);
  expect(app.storage.has("test.bin.tmp")).toBe(false);
});

test("writeFileAtomic handles rename failure gracefully", async () => {
  const app = createMockApp();
  
  // Mock rename to fail once
  let renameCallCount = 0;
  app.vault.adapter.rename = mock(async (oldPath: string, newPath: string) => {
    renameCallCount++;
    if (renameCallCount === 1) {
      throw new Error("Rename failed");
    }
    const data = app.storage.get(oldPath);
    if (data === undefined) throw new Error("Source file not found");
    app.storage.set(newPath, data);
    app.storage.delete(oldPath);
  });
  
  const result = await writeFileAtomic(app, "test.txt", "content");
  
  expect(result.ok).toBe(true);
  expect(app.storage.get("test.txt")).toBe("content");
});

test("readManifestSafe returns error for missing file", async () => {
  const app = createMockApp();
  const result = await readManifestSafe(app, "missing.json");
  
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.reason).toContain("not found");
    expect(result.error.kind).toBe("permanent");
  }
});

test("readManifestSafe validates manifest format", async () => {
  const app = createMockApp();
  
  // Write invalid manifest
  await app.vault.adapter.write("invalid.json", JSON.stringify({
    version: "not a number", // Invalid
    ext: "mp3",
    totalParts: 3,
    fetchedParts: [1, 2],
    mergedUntil: 2,
    updatedAt: Date.now(),
  }));
  
  const result = await readManifestSafe(app, "invalid.json");
  
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.reason).toContain("Invalid manifest format");
    expect(result.error.kind).toBe("permanent");
  }
});

test("readManifestSafe reads valid manifest successfully", async () => {
  const app = createMockApp();
  
  const validManifest: AudioManifest = {
    version: 1,
    ext: "mp3",
    totalParts: 3,
    fetchedParts: [1, 2, 3],
    mergedUntil: 2,
    updatedAt: Date.now(),
  };
  
  await app.vault.adapter.write("valid.json", JSON.stringify(validManifest));
  
  const result = await readManifestSafe(app, "valid.json");
  
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.version).toBe(1);
    expect(result.value.ext).toBe("mp3");
    expect(result.value.fetchedParts).toEqual([1, 2, 3]);
  }
});

test("writeManifestSafe validates and writes manifest", async () => {
  const app = createMockApp();
  
  const manifest: AudioManifest = {
    version: 1,
    ext: "mp3",
    totalParts: 3,
    fetchedParts: [2, 1, 3], // Unsorted - should be fixed
    mergedUntil: 2,
    updatedAt: Date.now(),
  };
  
  const result = await writeManifestSafe(app, "test.json", manifest);
  
  expect(result.ok).toBe(true);
  
  // Read back and verify it was sorted
  const readResult = await readManifestSafe(app, "test.json");
  expect(readResult.ok).toBe(true);
  if (readResult.ok) {
    expect(readResult.value.fetchedParts).toEqual([1, 2, 3]); // Now sorted
  }
});

test("removeFiles removes existing files and ignores missing ones", async () => {
  const app = createMockApp();
  
  // Create some files
  await app.vault.adapter.write("file1.txt", "content1");
  await app.vault.adapter.write("file2.txt", "content2");
  
  const result = await removeFiles(app, [
    "file1.txt",
    "missing.txt", // Doesn't exist
    "file2.txt",
  ]);
  
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toBe(2); // Only 2 files were actually removed
  }
  
  expect(app.storage.has("file1.txt")).toBe(false);
  expect(app.storage.has("file2.txt")).toBe(false);
});

test("path building functions work correctly", () => {
  expect(buildManifestPath("Audio", "test-note")).toBe("Audio/test-note.manifest.json");
  expect(buildPartPath("Audio", "test-note", 1, "mp3")).toBe("Audio/test-note_part_1.mp3");
  expect(buildMergedPath("Audio", "test-note", "mp3")).toBe("Audio/test-note.mp3");
  expect(buildPartialPath("Audio", "test-note", "mp3")).toBe("Audio/test-note.partial.mp3");
});
