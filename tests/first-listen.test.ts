import { expect, mock, spyOn, test } from "bun:test";
import type { App, PluginManifest } from "obsidian";
import AudioVaultPlugin from "../src/index";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import { FirstListenModal } from "../src/obsidian/first-listen";
import welcome from "../src/obsidian/first-listen-audio.json";

type SetupActions = ConstructorParameters<typeof FirstListenModal>[1];

function fixture(raw: string) {
  const note = { path: "Test.md", basename: "Test", extension: "md" };
  let active = note;
  const storage = new Map<string, unknown>();
  const readBinary = mock(async () => new ArrayBuffer(3));
  const playBytes = mock(async () => {});
  const openFile = mock(async (file: typeof note) => { active = file; });
  const getActiveFile = () => active;
  const app = {
    loadLocalStorage: (key: string) => storage.get(key),
    saveLocalStorage: (key: string, value: unknown) => storage.set(key, value),
    workspace: { getActiveFile, getLeaf: () => ({ openFile }) },
    vault: {
      configDir: ".obsidian",
      cachedRead: async () => raw,
      adapter: { stat: async () => ({ type: "file", size: 3 }), readBinary },
      getAbstractFileByPath: (path: string) => path === note.path ? note : null,
    },
  };
  const plugin = new AudioVaultPlugin(app as unknown as App, { id: "audio-vault" } as PluginManifest);
  Object.assign(plugin, { settings: DEFAULT_SETTINGS, playBytes });
  return {
    plugin, readBinary, playBytes, openFile, getActiveFile,
    switchNote: () => { active = { path: "Other.md", basename: "Other", extension: "md" }; },
  };
}

test("first play without a key opens one setup and resumes the original note after saving a key", async () => {
  const { plugin, readBinary, switchNote, openFile, getActiveFile } = fixture("A note with no saved recording.");
  const setups: SetupActions[] = [];
  const open = spyOn(FirstListenModal.prototype, "open").mockImplementation(function (this: FirstListenModal) {
    const options: unknown = Object.getOwnPropertyDescriptor(this, "options")?.value;
    setups.push(options as SetupActions);
  });
  try {
    await plugin.readCurrentNote();
    await plugin.readCurrentNote();
    expect(setups.map(({ autoplay }) => autoplay)).toEqual([true]);
    setups[0].closed();
    await plugin.readCurrentNote();
    expect(setups.map(({ autoplay }) => autoplay)).toEqual([true, false]);
    expect(readBinary).not.toHaveBeenCalled();

    setups[1].saveKey("test-key");
    expect(plugin.getCartesiaKey()).toBe("test-key");
    expect(openFile).not.toHaveBeenCalled();
    switchNote();
    const listen = spyOn(plugin, "readCurrentNote").mockResolvedValue();
    try {
      setups[1].listen();
      await Promise.resolve();
      expect(openFile).toHaveBeenCalledTimes(1);
      expect(getActiveFile().path).toBe("Test.md");
      expect(listen).toHaveBeenCalledTimes(1);
    } finally {
      listen.mockRestore();
    }
  } finally {
    open.mockRestore();
  }
});

test("a saved MP3 plays without opening setup or requiring a key", async () => {
  const { plugin, readBinary, playBytes } = fixture("Note text\n\nGenerated audio: [[Audio/saved.mp3]]");
  const open = spyOn(FirstListenModal.prototype, "open");
  try {
    await plugin.readCurrentNote();
    expect(readBinary).toHaveBeenCalledWith("Audio/saved.mp3");
    expect(playBytes).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    expect(plugin.getCartesiaKey()).toBe("");
  } finally {
    open.mockRestore();
  }
});

test("the offline guide is bundled as MP3 bytes", () => {
  const bytes = Buffer.from(welcome.mp3Base64, "base64");
  expect(bytes.length).toBeGreaterThan(1000);
  expect(bytes.subarray(0, 3).toString()).toBe("ID3");
});
