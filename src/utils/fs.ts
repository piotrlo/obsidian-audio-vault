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
  // Overwrite if exists
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
    // List all files in vault and filter by our pattern; simple and safe for MVP.
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
  // Remove previous Generated audio lines to avoid duplicates, keep only one
  const updated = original
    .split("\n")
    .filter(l => !l.startsWith("Generated audio: [["))
    .concat(["", line])
    .join("\n");
  await app.vault.modify(file, updated);
}
