import type { DataAdapter } from "obsidian";
import { sha256Hex } from "../utils/crypto";

type Storage = Pick<DataAdapter, "exists" | "mkdir" | "readBinary" | "writeBinary" | "rename" | "remove">;

/** Completed parts of an unpublished recording; no transcript or API key is stored. */
export async function openPendingAudio(adapter: Storage, folder: string, identity: readonly unknown[]) {
  const id = await sha256Hex(JSON.stringify(identity));
  if (!await adapter.exists(folder)) await adapter.mkdir(folder);
  const partPath = (index: number) => `${folder}/${id}-${index}.mp3`;
  const touched = new Set<string>();

  return {
    async getOrGenerate(index: number, generate: () => Promise<ArrayBuffer>, signal: AbortSignal) {
      signal.throwIfAborted();
      const path = partPath(index);
      if (await adapter.exists(path)) {
        const data = await adapter.readBinary(path);
        if (!data.byteLength) throw new Error("A saved audio part is empty. No new request was made for it.");
        touched.add(path);
        return data;
      }
      signal.throwIfAborted();
      const data = await generate();
      if (!data.byteLength) throw new Error("Cartesia returned empty audio.");
      // Persist a fully received part even if playback was stopped in the meantime.
      const temporary = `${path}.${crypto.randomUUID()}.tmp`;
      try {
        await adapter.writeBinary(temporary, data);
        await adapter.rename(temporary, path);
      } catch {
        await adapter.remove(temporary).catch(() => {});
        throw new Error("Could not save the generated part to the vault. Check free space and permissions before trying again.");
      }
      touched.add(path);
      return data;
    },
    get completed() { return touched.size; },
    async clear() {
      for (const path of touched) await adapter.remove(path).catch(() => {});
    },
  };
}
