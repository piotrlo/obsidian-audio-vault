import type { App, DataAdapter, TFile } from "obsidian";
import { sha256Hex } from "./crypto";
import { toSafeBase } from "./safe-name";
import { sanitizeNoteForTts } from "./sanitize";
import { throwIfAborted, toError } from "./errors";

const generatedLink = /^Generated audio: \[\[([^\][\r\n|#]+\.mp3)\]\][ \t]*$/i;
const publishedSuffix = /-av1-([a-f0-9]{64})-(\d+)\.mp3$/i;

type RecordingStorage = Pick<DataAdapter, "stat">;
export type OfflineAudioStatus = "none" | "ready" | "outdated" | "unavailable" | "legacy";

export function noteAudioFingerprint(raw: string): Promise<string> {
  // Unlike the resumable job identity, this must be stable across devices and note moves.
  return sha256Hex(sanitizeNoteForTts(raw));
}

export async function hasLocalRecording(adapter: RecordingStorage, path: string, pendingFolder: string): Promise<boolean> {
  if (/\.partial\.mp3$/i.test(path) || path.toLowerCase().startsWith(`${pendingFolder.toLowerCase()}/`)) return false;
  const stat = await adapter.stat(path).catch(() => null);
  const expected = publishedSuffix.exec(path)?.[2];
  return stat?.type === "file" && stat.size > 0 && (expected === undefined || stat.size === Number(expected));
}

export async function offlineAudioStatus(raw: string, adapter: RecordingStorage, pendingFolder: string): Promise<OfflineAudioStatus> {
  const paths = linkedAudioPaths(raw);
  if (!paths.length) return "none";
  for (const path of paths) {
    if (!await hasLocalRecording(adapter, path, pendingFolder)) return "unavailable";
  }
  const fingerprint = paths.length === 1 ? publishedSuffix.exec(paths[0])?.[1] : undefined;
  if (!fingerprint) return "legacy";
  return fingerprint.toLowerCase() === await noteAudioFingerprint(raw) ? "ready" : "outdated";
}

function noteLines(note: string) {
  let fence: string | undefined;
  let frontmatter = false;
  return note.split(/\r?\n/).map((line, index) => {
    if (index === 0 && /^---\s*$/.test(line)) frontmatter = true;
    else if (frontmatter && /^(---|\.\.\.)\s*$/.test(line)) {
      frontmatter = false;
      return { line };
    }
    if (frontmatter) return { line };
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
      if (close?.[0] === fence[0] && close.length >= fence.length) fence = undefined;
      return { line };
    }
    fence = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    return { line, audio: generatedLink.exec(line)?.[1] };
  });
}

export function linkedAudioPaths(note: string): string[] {
  return [...new Set(noteLines(note).flatMap(({ audio: path }) => {
    return path && !path.includes("\\") && path.split("/").every((part) => part && part !== "." && part !== "..")
      ? [path] : [];
  }))];
}

export function audioLink(note: string, path: string): string {
  const eol = note.includes("\r\n") ? "\r\n" : "\n";
  const body = noteLines(note).filter(({ audio }) => !audio).map(({ line }) => line).join(eol);
  const updated = `${body}${body && !body.endsWith(eol) ? eol : ""}Generated audio: [[${path}]]${eol}`;
  if (!linkedAudioPaths(updated).includes(path)) throw new Error("Close the Markdown code block or frontmatter before saving audio.");
  return updated;
}

export async function audioFileStem(path: string): Promise<string> {
  const name = path.split("/").at(-1)?.replace(/\.md$/i, "") || "";
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path)));
  const id = Array.from(bytes.subarray(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${toSafeBase(name).slice(0, 64) || "note"}-${id}`;
}

export function normalizeAudioFolder(value: string): string {
  const folder = value.trim() || "Audio";
  if (/[[\]#|\\\r\n]/.test(folder) || folder.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Choose a folder inside the vault (for example, Audio or Media/Audio).");
  }
  return folder;
}

export async function publishAudio(app: App, file: TFile, folder: string, data: ArrayBuffer, signal: AbortSignal, fingerprint: string): Promise<string> {
  if (!data.byteLength) throw new Error("No audio to save.");
  const path = `${normalizeAudioFolder(folder)}/${await audioFileStem(file.path)}-${crypto.randomUUID()}-av1-${fingerprint}-${data.byteLength}.mp3`;
  throwIfAborted(signal);
  const output = await app.vault.createBinary(path, data);
  try {
    throwIfAborted(signal);
    await app.vault.process(file, (latest) => {
      throwIfAborted(signal);
      return audioLink(latest, path);
    });
    return path;
  } catch (error) {
    const trashFile = (app.fileManager as { trashFile?: (file: TFile) => Promise<void> }).trashFile;
    if (typeof trashFile === "function") {
      await trashFile.call(app.fileManager, output).catch(() => undefined);
    } else {
      await app.vault.adapter.remove(output.path).catch(() => undefined);
    }
    throw toError(error);
  }
}
