/**
 * Tests for enhanced MP3 assembler with partial snapshots and finalization.
 */

import { test, expect } from "bun:test";
import {
  Mp3Assembler,
  EnhancedMp3Assembler,
  stripId3v2,
  buildPartialSnapshot,
  flushPartial,
  finalizeMerge,
} from "../../src/utils/mp3";

// Mock app with file system operations
function createMockApp(initialFiles: Record<string, ArrayBuffer | string> = {}) {
  const files = new Map<string, ArrayBuffer | string>(Object.entries(initialFiles));
  
  return {
    vault: {
      adapter: {
        exists: async (path: string) => files.has(path),
        readBinary: async (path: string) => {
          const content = files.get(path);
          if (content === undefined) throw new Error("ENOENT");
          return content as ArrayBuffer;
        },
        writeBinary: async (path: string, data: ArrayBuffer) => {
          files.set(path, data);
        },
        rename: async (oldPath: string, newPath: string) => {
          const content = files.get(oldPath);
          if (content === undefined) throw new Error("ENOENT");
          files.set(newPath, content);
          files.delete(oldPath);
        },
        remove: async (path: string) => {
          files.delete(path);
        },
      },
    },
    _files: files, // For test inspection
  };
}

// Helper to create mock MP3 data
function createMockMp3Data(size: number, withId3 = false): Uint8Array {
  const data = new Uint8Array(size);
  
  if (withId3) {
    // Add ID3v2 header
    data[0] = 0x49; // 'I'
    data[1] = 0x44; // 'D'  
    data[2] = 0x33; // '3'
    data[3] = 0x03; // Version
    data[4] = 0x00; // Revision
    data[5] = 0x00; // Flags
    // Size in synchsafe format (28 bits)
    const headerSize = 32;
    data[6] = (headerSize >> 21) & 0x7F;
    data[7] = (headerSize >> 14) & 0x7F;
    data[8] = (headerSize >> 7) & 0x7F;
    data[9] = headerSize & 0x7F;
    
    // Fill rest with MP3 frames
    for (let i = 10 + headerSize; i < size; i++) {
      data[i] = 0xFF; // Mock MP3 sync bytes
    }
  } else {
    // Fill with mock MP3 frame data
    for (let i = 0; i < size; i++) {
      data[i] = 0xFF;
    }
  }
  
  return data;
}

test("buildPartialSnapshot returns concatenated bytes as ArrayBuffer", () => {
  const asm = new Mp3Assembler();
  asm.append(new Uint8Array([1,2]));
  asm.append(new Uint8Array([3]));
  const ab = buildPartialSnapshot(asm);
  const out = Array.from(new Uint8Array(ab));
  expect(out).toEqual([1,2,3]);
});

test("stripId3v2 removes ID3v2 tags correctly", () => {
  const withId3 = createMockMp3Data(100, true);
  const withoutId3 = createMockMp3Data(100, false);
  
  const stripped = stripId3v2(withId3);
  expect(stripped.byteLength).toBeLessThan(withId3.byteLength);
  
  const alreadyClean = stripId3v2(withoutId3);
  expect(alreadyClean.byteLength).toBe(withoutId3.byteLength);
});

test("Mp3Assembler builds correctly", () => {
  const assembler = new Mp3Assembler();
  const part1 = createMockMp3Data(50);
  const part2 = createMockMp3Data(60);
  
  assembler.append(part1);
  assembler.append(part2);
  
  const result = assembler.build();
  expect(result.byteLength).toBe(110);
});

test("EnhancedMp3Assembler tracks merged parts", () => {
  const assembler = new EnhancedMp3Assembler();
  const part1 = createMockMp3Data(50);
  const part2 = createMockMp3Data(60);
  
  expect(assembler.mergedUntilPart).toBe(0);
  expect(assembler.isComplete(3)).toBe(false);
  
  assembler.appendPart(part1, 1);
  expect(assembler.mergedUntilPart).toBe(1);
  expect(assembler.isComplete(3)).toBe(false);
  
  assembler.appendPart(part2, 2);
  expect(assembler.mergedUntilPart).toBe(2);
  expect(assembler.isComplete(2)).toBe(true);
  expect(assembler.isComplete(3)).toBe(false);
  
  const part3 = createMockMp3Data(40);
  assembler.appendPart(part3, 3);
  expect(assembler.mergedUntilPart).toBe(3);
  expect(assembler.isComplete(3)).toBe(true);
});

test("EnhancedMp3Assembler handles out-of-order parts", () => {
  const assembler = new EnhancedMp3Assembler();
  const part3 = createMockMp3Data(40);
  const part1 = createMockMp3Data(50);
  
  assembler.appendPart(part3, 3);
  expect(assembler.mergedUntilPart).toBe(3);
  
  assembler.appendPart(part1, 1);
  expect(assembler.mergedUntilPart).toBe(3); // Should still be highest
});

test("flushPartial writes partial file atomically", async () => {
  const app = createMockApp();
  const assembler = new Mp3Assembler();
  const part1 = createMockMp3Data(100);
  
  assembler.append(part1);
  
  const result = await flushPartial(app, "Audio", "test-note", assembler, 1);
  
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.path).toBe("Audio/test-note.partial.mp3");
    expect(result.value.mergedUntil).toBe(1);
  }
  
  // Check file was created
  expect(app._files.has("Audio/test-note.partial.mp3")).toBe(true);
  const savedData = app._files.get("Audio/test-note.partial.mp3") as ArrayBuffer;
  expect(savedData.byteLength).toBe(100);
});

test("flushPartial overwrites existing partial file", async () => {
  const app = createMockApp({
    "Audio/test-note.partial.mp3": new ArrayBuffer(50), // Existing partial
  });
  
  const assembler = new Mp3Assembler();
  const part1 = createMockMp3Data(100);
  const part2 = createMockMp3Data(75);
  
  assembler.append(part1);
  assembler.append(part2);
  
  const result = await flushPartial(app, "Audio", "test-note", assembler, 2);
  
  expect(result.ok).toBe(true);
  
  // Check file was updated with new size
  const updatedData = app._files.get("Audio/test-note.partial.mp3") as ArrayBuffer;
  expect(updatedData.byteLength).toBe(175); // 100 + 75
});

test("finalizeMerge creates final file and cleans up", async () => {
  const app = createMockApp({
    "Audio/test-note.partial.mp3": new ArrayBuffer(100),
    "Audio/test-note.manifest.json": JSON.stringify({ version: 1 }),
    "Audio/test-note_part_1.mp3": new ArrayBuffer(50),
    "Audio/test-note_part_2.mp3": new ArrayBuffer(50),
    "Audio/test-note_part_3.mp3": new ArrayBuffer(50),
  });
  
  const assembler = new Mp3Assembler();
  const part1 = createMockMp3Data(50);
  const part2 = createMockMp3Data(50);
  const part3 = createMockMp3Data(50);
  
  assembler.append(part1);
  assembler.append(part2);
  assembler.append(part3);
  
  const result = await finalizeMerge(app, "Audio", "test-note", assembler, {
    cleanupParts: true,
    totalParts: 3,
    ext: "mp3",
  });
  
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.finalPath).toBe("Audio/test-note.mp3");
    expect(result.value.cleanedFiles).toHaveLength(5); // partial + manifest + 3 parts
  }
  
  // Check final file was created
  expect(app._files.has("Audio/test-note.mp3")).toBe(true);
  const finalData = app._files.get("Audio/test-note.mp3") as ArrayBuffer;
  expect(finalData.byteLength).toBe(150);
  
  // Check cleanup happened
  expect(app._files.has("Audio/test-note.partial.mp3")).toBe(false);
  expect(app._files.has("Audio/test-note.manifest.json")).toBe(false);
  expect(app._files.has("Audio/test-note_part_1.mp3")).toBe(false);
  expect(app._files.has("Audio/test-note_part_2.mp3")).toBe(false);
  expect(app._files.has("Audio/test-note_part_3.mp3")).toBe(false);
});

test("finalizeMerge without cleanup preserves part files", async () => {
  const app = createMockApp({
    "Audio/test-note.partial.mp3": new ArrayBuffer(100),
    "Audio/test-note.manifest.json": JSON.stringify({ version: 1 }),
    "Audio/test-note_part_1.mp3": new ArrayBuffer(50),
  });
  
  const assembler = new Mp3Assembler();
  const part1 = createMockMp3Data(150);
  assembler.append(part1);
  
  const result = await finalizeMerge(app, "Audio", "test-note", assembler, {
    cleanupParts: false,
  });
  
  expect(result.ok).toBe(true);
  
  // Final file should be created
  expect(app._files.has("Audio/test-note.mp3")).toBe(true);
  
  // Partial and manifest should be cleaned up
  expect(app._files.has("Audio/test-note.partial.mp3")).toBe(false);
  expect(app._files.has("Audio/test-note.manifest.json")).toBe(false);
  
  // Part file should be preserved
  expect(app._files.has("Audio/test-note_part_1.mp3")).toBe(true);
});

test("enhanced assembler can be reset", () => {
  const assembler = new EnhancedMp3Assembler();
  const part1 = createMockMp3Data(50);
  
  assembler.appendPart(part1, 1);
  expect(assembler.mergedUntilPart).toBe(1);
  expect(assembler.build().byteLength).toBe(50);
  
  assembler.reset();
  expect(assembler.mergedUntilPart).toBe(0);
  expect(assembler.build().byteLength).toBe(0);
  expect(assembler.isComplete(1)).toBe(false);
});

