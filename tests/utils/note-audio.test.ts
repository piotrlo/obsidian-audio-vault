import { expect, test } from "bun:test";
import type { App, TFile } from "obsidian";
import { audioFileStem, audioLink, hasLocalRecording, linkedAudioPaths, normalizeAudioFolder, noteAudioFingerprint, offlineAudioStatus, publishAudio } from "../../src/utils/note-audio";

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
    },
    fileManager: {
      async trashFile(file: TFile) { files.delete(file.path); },
    },
  } as unknown as App;
  await expect(publishAudio(app, note, "Audio", new ArrayBuffer(3), new AbortController().signal, await noteAudioFingerprint("Plan"))).rejects.toThrow("note write failed");
  expect([...files]).toEqual([oldPath]);
});

test("published audio is ready only while the linked complete MP3 is local", async () => {
  const pendingFolder = ".obsidian/plugins/audio-vault/pending-audio";
  const files = new Map<string, number>();
  const adapter = {
    async stat(path: string) {
      const size = files.get(path);
      return size === undefined ? null : { type: "file" as const, size, ctime: 0, mtime: 0 };
    },
  };
  const status = (raw: string) => offlineAudioStatus(raw, adapter, pendingFolder);
  const original = "# Field notes\n\nRead this.";
  let raw = original;
  const app = {
    vault: {
      async createBinary(path: string, bytes: ArrayBuffer) { files.set(path, bytes.byteLength); return { path }; },
      async process(_file: TFile, update: (latest: string) => string) { raw = update(raw); },
    },
  } as unknown as App;

  const path = await publishAudio(app, { path: "Field notes.md" } as TFile, "Audio", new ArrayBuffer(12),
    new AbortController().signal, await noteAudioFingerprint(original));
  expect(await status(raw)).toBe("ready");
  expect(await status(`---\ntag: updated\n---\n${raw.replace("# Field notes", "## Field notes")}\n<!-- comment -->`)).toBe("ready");
  expect(await status(raw.replace("Read this.", "Read something else."))).toBe("outdated");
  expect(await hasLocalRecording(adapter, path, pendingFolder)).toBe(true);
  expect(await status(original)).toBe("none"); // An unlinked output is not ready.
  files.set(path, 4);
  expect(await status(raw)).toBe("unavailable");
  files.set(path, 0);
  expect(await status(raw)).toBe("unavailable");
  files.delete(path);
  expect(await status(raw)).toBe("unavailable");

  const partial = `${pendingFolder}/partial.mp3`;
  files.set(partial, 4);
  expect(await status(audioLink(original, partial))).toBe("unavailable");
  files.set("Audio/old.partial.mp3", 4);
  expect(await status(audioLink(original, "Audio/old.partial.mp3"))).toBe("unavailable");
  files.set("Audio/old.mp3", 4);
  expect(await status(audioLink(original, "Audio/old.mp3"))).toBe("legacy");
  expect(await status(`${audioLink(original, "Audio/old.mp3")}Generated audio: [[Audio/not-synced.mp3]]\n`)).toBe("unavailable");
});
