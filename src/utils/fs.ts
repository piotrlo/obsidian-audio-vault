/**
 * Vault filesystem helpers for saving audio and appending references.
 */

import type { App, TFile } from "obsidian";

/**
 * Ensure a folder exists in the vault.
 *
 * @param {App} app Obsidian app.
 * @param {string} folder Path relative to vault root.
 * @returns {Promise<void>} When ensured.
 */
export async function ensureFolder(app: App, folder: string): Promise<void> {
  const exists = await app.vault.adapter.exists(folder);
  if (!exists) {
    try { await app.vault.createFolder(folder); } catch (_) {}
  }
}

/**
 * Write binary data into the vault.
 *
 * @param {App} app Obsidian app.
 * @param {string} path Relative path to write.
 * @param {ArrayBuffer} data Binary data.
 * @returns {Promise<void>} When written.
 */
export async function writeBinary(app: App, path: string, data: ArrayBuffer): Promise<void> {
  /** Overwrite if exists */
  await app.vault.adapter.writeBinary(path, data);
}

/**
 * Delete all generated audio parts for a given base and extension in a folder.
 * Example matches: `${folder}/${base}_part_1.${ext}` ... `${folder}/${base}_part_N.${ext}`.
 *
 * @param {App} app Obsidian app.
 * @param {string} folder Folder path.
 * @param {string} base Safe base name.
 * @param {string} ext File extension without dot (mp3|wav).
 */
export async function deleteExistingParts(app: App, folder: string, base: string, ext: string): Promise<void> {
  try {
    /** List all files in vault and filter by our pattern; simple and safe for MVP. */
    const files = app.vault.getFiles();
    const prefix = `${folder}/${base}_part_`;
    const suffix = `.${ext}`;
    const targets = files.filter(f => f.path.startsWith(prefix) && f.path.endsWith(suffix));
    for (const f of targets) {
      await app.vault.adapter.remove(f.path).catch(() => {});
    }
  } catch {}
}

/**
 * Append a wiki link to the generated audio at the end of a note.
 *
 * @param {App} app Obsidian app.
 * @param {TFile} file Note file.
 * @param {string} relPath Relative path to audio.
 * @returns {Promise<void>} When modified.
 */
export async function appendAudioReference(app: App, file: TFile, relPath: string): Promise<void> {
  const original = await app.vault.read(file);
  const line = `Generated audio: [[${relPath}]]`;
  if (original.includes(line)) return;
  const needsNewline = !original.endsWith("\n");
  const updated = original + (needsNewline ? "\n" : "") + line + "\n";
  await app.vault.modify(file, updated);
}

/**
 * Upsert a Generated audio line and keep the whole block sorted by part number.
 * Sorting is based on `_part_(\d+)` extracted from the relPath.
 */
export async function upsertAudioReferenceSorted(app: App, file: TFile, relPath: string): Promise<void> {
  const original = await app.vault.read(file);
  const lines = original.split("\n");
  const prefix = "Generated audio: [[";
  const existing = lines.filter(l => l.startsWith(prefix));
  const others = lines.filter(l => !l.startsWith(prefix));
  const set = new Set(existing);
  const newLine = `${prefix}${relPath}]]`;
  set.add(newLine);
  const arr = Array.from(set);
  const { sortGeneratedAudioLines } = await import("../core/helpers");
  const sorted = sortGeneratedAudioLines(arr);
  const trimmedOthers = others.join("\n");
  const needsNewline = !trimmedOthers.endsWith("\n") && trimmedOthers.length > 0;
  const updated = trimmedOthers + (needsNewline ? "\n" : "") + (sorted.length ? sorted.join("\n") + "\n" : "");
  await app.vault.modify(file, updated);
}

/**
 * Replace all Generated audio lines with a single link to the merged file.
 * Removes any lines pointing to *_part_N.(mp3|wav) and ensures one line for relPath.
 */
export async function replaceAudioReferencesWithSingle(app: App, file: TFile, relPath: string): Promise<void> {
  const original = await app.vault.read(file);
  const lines = original.split("\n");
  const prefix = "Generated audio: [[";
  const kept: string[] = [];
  for (const l of lines) {
    if (!l.startsWith(prefix)) kept.push(l);
  }
  const needsNewline = kept.length > 0 && !kept[kept.length - 1].endsWith("\n");
  const body = kept.join("\n");
  const maybeNl = body.endsWith("\n") || body.length === 0 ? "" : "\n";
  const single = `${prefix}${relPath}]]`;
  const updated = body + maybeNl + single + "\n";
  await app.vault.modify(file, updated);
}
