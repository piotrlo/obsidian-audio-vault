import { describe, it, expect, beforeEach } from "bun:test";
import { ensureFolder, writeBinary, deleteExistingParts, appendAudioReference, upsertAudioReferenceSorted, replaceAudioReferencesWithSingle } from "../../src/utils/fs";

function makeApp(initial: Record<string, string> = {}){
  const files = new Map<string, string>(Object.entries(initial));
  const removed: string[] = [];
  const app: any = {
    vault: {
      adapter: {
        exists: async (p: string) => files.has(p),
        writeBinary: async (p: string, _d: ArrayBuffer) => { files.set(p, "bin"); },
        remove: async (p: string) => { files.delete(p); removed.push(p); },
      },
      createFolder: async (p: string) => { files.set(p, "<dir>"); },
      getFiles: () => Array.from(files.keys()).map((path) => ({ path })),
      read: async (f: any) => files.get(f.path) ?? "",
      modify: async (f: any, content: string) => { files.set(f.path, content); },
    }
  };
  return { app, files, removed };
}

describe("utils/fs more", () => {
  it("ensureFolder creates when missing", async () => {
    const { app, files } = makeApp({});
    await ensureFolder(app as any, "Audio");
    expect(files.has("Audio")).toBe(true);
  });

  it("writeBinary overwrites file", async () => {
    const { app, files } = makeApp({ "a.bin": "old" });
    await writeBinary(app as any, "a.bin", new Uint8Array([1,2,3]).buffer);
    expect(files.get("a.bin")).toBe("bin");
  });

  it("deleteExistingParts removes only matching parts", async () => {
    const { app, files } = makeApp({
      "Audio/base_part_1.mp3": "",
      "Audio/base_part_2.mp3": "",
      "Audio/other.mp3": "",
    });
    await deleteExistingParts(app as any, "Audio", "base", "mp3");
    expect(files.has("Audio/base_part_1.mp3")).toBe(false);
    expect(files.has("Audio/base_part_2.mp3")).toBe(false);
    expect(files.has("Audio/other.mp3")).toBe(true);
  });

  it("appendAudioReference appends unique line once", async () => {
    const { app, files } = makeApp({ "Note.md": "Title\n" });
    const file = { path: "Note.md" } as any;
    await appendAudioReference(app as any, file, "Audio/a.mp3");
    await appendAudioReference(app as any, file, "Audio/a.mp3");
    const body = files.get("Note.md")!;
    const count = body.split("Generated audio:").length - 1;
    expect(count).toBe(1);
  });

  it("upsertAudioReferenceSorted keeps lines sorted by part number", async () => {
    const { app, files } = makeApp({ "Note.md": "Intro\nGenerated audio: [[Audio/base_part_2.mp3]]\n" });
    const file = { path: "Note.md" } as any;
    await upsertAudioReferenceSorted(app as any, file, "Audio/base_part_1.mp3");
    const body = files.get("Note.md")!;
    const lines = body.trim().split("\n");
    expect(lines[0]).toBe("Intro");
    expect(lines[1]).toContain("base_part_1.mp3");
    expect(lines[2]).toContain("base_part_2.mp3");
  });

  it("replaceAudioReferencesWithSingle removes parts and keeps single link", async () => {
    const { app, files } = makeApp({ "Note.md": "A\nGenerated audio: [[Audio/base_part_1.mp3]]\nGenerated audio: [[Audio/base_part_2.mp3]]\n" });
    const file = { path: "Note.md" } as any;
    await replaceAudioReferencesWithSingle(app as any, file, "Audio/base_merged.mp3");
    const body = files.get("Note.md")!;
    expect(body.split("Generated audio:").length - 1).toBe(1);
    expect(body).toContain("base_merged.mp3");
    expect(body).not.toContain("base_part_1.mp3");
  });
});


