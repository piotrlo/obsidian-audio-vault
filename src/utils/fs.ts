/**
 * Vault filesystem helpers for saving audio and appending references.
 * Enhanced with Result pattern for better error handling.
 */

import type { App, TFile } from "obsidian";
import type { AudioManifest, Result, AudioVaultError } from "../types";
import { safeParseManifest, createValidManifest } from "../schema";

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
    try { await app.vault.createFolder(folder); } catch { void 0; }
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
      await app.vault.adapter.remove(f.path).catch(() => undefined);
    }
  } catch { void 0; }
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
  const body = kept.join("\n");
  const maybeNl = body.endsWith("\n") || body.length === 0 ? "" : "\n";
  const single = `${prefix}${relPath}]]`;
  const updated = body + maybeNl + single + "\n";
  await app.vault.modify(file, updated);
}

/**
 * Read AudioVault manifest JSON if present.
 *
 * @param {App} app Obsidian app.
 * @param {string} folder Audio folder path.
 * @param {string} base Safe base name.
 * @returns {Promise<AudioManifest | null>} Parsed manifest or null when missing/invalid.
 */
export async function readManifest(app: App, folder: string, base: string): Promise<AudioManifest | null> {
  const path = `${folder}/${base}.manifest.json`;
  try {
    const exists = await app.vault.adapter.exists(path);
    if (!exists) return null;
    const raw = await app.vault.adapter.read(path);
    const parsed: unknown = JSON.parse(raw);
    const result = safeParseManifest(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Atomically write AudioVault manifest JSON via tmp + rename.
 *
 * @param {App} app Obsidian app.
 * @param {string} folder Audio folder path.
 * @param {string} base Safe base name.
 * @param {AudioManifest} data Manifest content to write.
 */
export async function writeManifest(app: App, folder: string, base: string, data: AudioManifest): Promise<void> {
  const path = `${folder}/${base}.manifest.json`;
  const tmp = `${folder}/${base}.manifest.json.tmp`;
  const body = JSON.stringify(data);
  await app.vault.adapter.write(tmp, body);
  try {
    await app.vault.adapter.rename(tmp, path);
  } catch {
    try { await app.vault.adapter.remove(path); } catch { void 0; }
    await app.vault.adapter.write(path, body);
    try { await app.vault.adapter.remove(tmp); } catch { void 0; }
  }
}

/**
 * Safely rename a file using adapter.rename with a fallback to copy+remove.
 *
 * @param {App} app Obsidian app.
 * @param {string} oldPath Source path.
 * @param {string} newPath Destination path.
 */
export async function safeRename(app: App, oldPath: string, newPath: string): Promise<void> {
  try {
    await app.vault.adapter.rename(oldPath, newPath);
    return;
  } catch { void 0; }
  try {
    const data = await app.vault.adapter.read(oldPath);
    await app.vault.adapter.write(newPath, data);
    await app.vault.adapter.remove(oldPath);
  } catch { void 0; }
}

/**
 * Scan vault for existing parts for given base and extension.
 *
 * @param {App} app Obsidian app.
 * @param {string} folder Audio folder path.
 * @param {string} base Safe base name.
 * @param {string} ext Extension without dot (e.g., "mp3").
 * @returns {Promise<number[]>} Sorted unique 1-based indices of existing parts.
 */
export async function scanExistingParts(app: App, folder: string, base: string, ext: string): Promise<number[]> {
  try {
    const files = app.vault.getFiles();
    const prefix = `${folder}/${base}_part_`;
    const suffix = `.${ext}`;
    const found = new Set<number>();
    for (const f of files) {
      if (!f.path.startsWith(prefix) || !f.path.endsWith(suffix)) continue;
      const mid = f.path.slice(prefix.length, f.path.length - suffix.length);
      const n = parseInt(mid, 10);
      if (Number.isFinite(n) && n > 0) found.add(n);
    }
    return Array.from(found).sort((a, b) => a - b);
  } catch {
    return [];
  }
}

// Enhanced utilities with Result pattern for better error handling

/**
 * Atomically write file data using temporary file and rename.
 * Supports both text and binary data.
 * @param app Obsidian app instance
 * @param path Target file path
 * @param data Data to write (string or ArrayBuffer)
 * @returns Result indicating success or failure
 */
export async function writeFileAtomic(
  app: App, 
  path: string, 
  data: string | ArrayBuffer
): Promise<Result<void, AudioVaultError>> {
  const tmpPath = `${path}.tmp`;
  
  try {
    // Write to temporary file
    if (typeof data === 'string') {
      await app.vault.adapter.write(tmpPath, data);
    } else {
      await app.vault.adapter.writeBinary(tmpPath, data);
    }
    
    // Attempt atomic rename
    try {
      await app.vault.adapter.rename(tmpPath, path);
      return { ok: true, value: undefined };
    } catch (renameError) {
      // Fallback: remove target and rename temp
      try {
        await app.vault.adapter.remove(path);
      } catch { void 0; }
      
      if (typeof data === 'string') {
        await app.vault.adapter.write(path, data);
      } else {
        await app.vault.adapter.writeBinary(path, data);
      }
      
      // Clean up temp file
      try {
        await app.vault.adapter.remove(tmpPath);
      } catch { void 0; }
      
      return { ok: true, value: undefined };
    }
  } catch (error) {
    // Clean up temp file on failure
    try {
      await app.vault.adapter.remove(tmpPath);
    } catch { void 0; }
    
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: {
        kind: 'permanent',
        reason: `Failed to write file atomically: ${message}`,
        cause: error instanceof Error ? error : undefined,
      }
    };
  }
}

/**
 * Enhanced manifest reading with validation.
 * @param app Obsidian app instance
 * @param path Full path to manifest file
 * @returns Result with validated manifest or error
 */
export async function readManifestSafe(
  app: App, 
  path: string
): Promise<Result<AudioManifest, AudioVaultError>> {
  try {
    const exists = await app.vault.adapter.exists(path);
    if (!exists) {
      return {
        ok: false,
        error: {
          kind: 'permanent',
          reason: `Manifest file not found: ${path}`,
        }
      };
    }
    
    const raw = await app.vault.adapter.read(path);
    const parsed = JSON.parse(raw);
    
    // Validate using Zod schema
    const result = safeParseManifest(parsed);
    if (!result.success) {
      return {
        ok: false,
        error: {
          kind: 'permanent',
          reason: `Invalid manifest format: ${result.error.message}`,
          cause: result.error,
        }
      };
    }
    
    return { ok: true, value: result.data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: {
        kind: 'permanent',
        reason: `Failed to read manifest: ${message}`,
        cause: error instanceof Error ? error : undefined,
      }
    };
  }
}

/**
 * Enhanced manifest writing with validation and atomic operation.
 * @param app Obsidian app instance
 * @param path Full path to manifest file
 * @param data Manifest data to write
 * @returns Result indicating success or failure
 */
export async function writeManifestSafe(
  app: App,
  path: string, 
  data: AudioManifest
): Promise<Result<void, AudioVaultError>> {
  try {
    // Ensure data is valid using our schema helpers
    const validManifest = createValidManifest(data);
    const json = JSON.stringify(validManifest, null, 2);
    
    return await writeFileAtomic(app, path, json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: {
        kind: 'permanent',
        reason: `Failed to prepare manifest for writing: ${message}`,
        cause: error instanceof Error ? error : undefined,
      }
    };
  }
}

/**
 * Remove multiple files with best-effort cleanup.
 * Continues removing other files even if some fail.
 * @param app Obsidian app instance
 * @param paths Array of file paths to remove
 * @returns Result with count of successfully removed files
 */
export async function removeFiles(
  app: App, 
  paths: string[]
): Promise<Result<number, never>> {
  let removedCount = 0;
  
  for (const path of paths) {
    try {
      await app.vault.adapter.remove(path);
      removedCount++;
    } catch {
      // Continue with other files - this is best-effort cleanup
    }
  }
  
  return { ok: true, value: removedCount };
}

/**
 * Build manifest file path for given base name.
 * @param folder Audio folder path
 * @param base Safe base name
 * @returns Manifest file path
 */
export function buildManifestPath(folder: string, base: string): string {
  return `${folder}/${base}.manifest.json`;
}

/**
 * Build part file path for given base name and part index.
 * @param folder Audio folder path
 * @param base Safe base name
 * @param partIndex 1-based part index
 * @param ext File extension without dot
 * @returns Part file path
 */
export function buildPartPath(folder: string, base: string, partIndex: number, ext: string): string {
  return `${folder}/${base}_part_${partIndex}.${ext}`;
}

/**
 * Build merged file path for given base name.
 * @param folder Audio folder path
 * @param base Safe base name
 * @param ext File extension without dot
 * @returns Merged file path
 */
export function buildMergedPath(folder: string, base: string, ext: string): string {
  return `${folder}/${base}.${ext}`;
}

/**
 * Build partial file path for given base name.
 * @param folder Audio folder path
 * @param base Safe base name
 * @param ext File extension without dot
 * @returns Partial file path
 */
export function buildPartialPath(folder: string, base: string, ext: string): string {
  return `${folder}/${base}.partial.${ext}`;
}

