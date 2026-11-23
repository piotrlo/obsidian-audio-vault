import type { App, TFile } from "obsidian";
import { toSafeBase } from "./safe-name";

const generatedLink = /^Generated audio: \[\[([^\][\r\n|#]+\.mp3)\]\][ \t]*$/i;

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

export async function publishAudio(app: App, file: TFile, folder: string, data: ArrayBuffer, signal: AbortSignal): Promise<string> {
  if (!data.byteLength) throw new Error("No audio to save.");
  const path = `${normalizeAudioFolder(folder)}/${await audioFileStem(file.path)}-${crypto.randomUUID()}.mp3`;
  signal.throwIfAborted();
  const output = await app.vault.createBinary(path, data);
  try {
    signal.throwIfAborted();
    await app.vault.process(file, (latest) => {
      signal.throwIfAborted();
      return audioLink(latest, path);
    });
    return path;
  } catch (error) {
    await app.vault.delete(output).catch(() => {});
    throw error;
  }
}
