import { expect, test } from "bun:test";
import type { App, TFile } from "obsidian";
import { audioFileStem, audioLink, linkedAudioPaths, normalizeAudioFolder, publishAudio } from "../../src/utils/note-audio";

test("identifies recordings by full note path rather than their shared filename", async () => {
  expect(await audioFileStem("First/Plan.md")).not.toBe(await audioFileStem("Second/Plan.md"));
  expect(await audioFileStem("家庭.md")).toMatch(/^note-[a-f0-9]{24}$/);
});

test("reads legacy MP3 links but ignores examples in Markdown fences and properties", () => {
  const note = "---\r\nGenerated audio: [[meta.mp3]]\r\n---\r\n```\r\nGenerated audio: [[example.mp3]]\r\n```\r\nGenerated audio: [[Audio/old.mp3]]\r\n";
  expect(linkedAudioPaths(note)).toEqual(["Audio/old.mp3"]);
  const updated = audioLink(note, "Audio/new.mp3");
  expect(updated).toContain("Generated audio: [[example.mp3]]\r\n");
  expect(linkedAudioPaths(updated)).toEqual(["Audio/new.mp3"]);
  expect(linkedAudioPaths("Generated audio: [[../outside.mp3]]")).toEqual([]);
  expect(() => normalizeAudioFolder("../outside")).toThrow("inside the vault");
});

test("removes only the new file if the note link cannot be committed", async () => {
  const note = { path: "First/Plan.md" } as TFile;
  const oldPath = "Audio/old.mp3";
  const files = new Set([oldPath]);
  const app = {
    vault: {
      async createBinary(path: string) { files.add(path); return { path }; },
      async process() { throw new Error("note write failed"); },
      async delete(file: TFile) { files.delete(file.path); },
    },
  } as unknown as App;
  await expect(publishAudio(app, note, "Audio", new ArrayBuffer(3), new AbortController().signal)).rejects.toThrow("note write failed");
  expect([...files]).toEqual([oldPath]);
});
