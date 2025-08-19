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
  await app.vault.adapter.writeBinary(path, data);
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
  const updated = `${original}\n\nGenerated audio: [[${relPath}]]`;
  await app.vault.modify(file, updated);
}
