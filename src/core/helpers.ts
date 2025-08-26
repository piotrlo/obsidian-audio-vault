/**
 * Shared pure helpers used across the plugin for DRY and testability.
 */

import { splitTextSmart } from "../utils/chunk";
import { detectLanguage } from "../utils/lang";
import { deriveLangFromVoiceName } from "../utils/ssml";
import type { TtsSettings } from "../types";

/**
 * Map Azure output format string to a persisted file extension.
 *
 * @param {string} fmt Azure output format.
 * @returns {"mp3" | "wav"} File extension without dot.
 */
export function fileExtFromFormat(fmt: string): "mp3" | "wav" {
  return /wav|riff/i.test(fmt) ? "wav" : "mp3";
}

/**
 * Resolve a MIME type based on output format string.
 *
 * @param {string} outputFormat Provider format string (Azure-compatible).
 * @returns {string} MIME type.
 */
export function mimeFromFormat(outputFormat: string): string {
  return /riff|wav/i.test(outputFormat) ? "audio/wav" : "audio/mpeg";
}

/**
 * Validate required settings and return missing labels.
 *
 * @param {TtsSettings} s Plugin settings.
 * @returns {string[]} Missing fields human-readable labels.
 */
export function missingSettings(s: TtsSettings): string[] {
  const out: string[] = [];
  if (s.useBackend) {
    if (!s.backendUrl?.trim()) out.push("Backend URL");
    if (!s.licenseKey?.trim()) out.push("License key");
  } else {
    if (!s.azureApiKey?.trim()) out.push("Azure API Key");
  }
  if (!s.voiceName?.trim()) out.push("Voice name");
  if (!s.outputFormat?.trim()) out.push("Output format");
  return out;
}

/**
 * Decide effective language from content and voice settings.
 *
 * @param {string} content Note content to inspect.
 * @param {TtsSettings} s Settings with language and voiceName.
 * @returns {string} BCP-47 language code.
 */
export function resolveLang(content: string, s: TtsSettings): string {
  const auto = detectLanguage(content);
  const configured = s.language === "auto" ? auto : s.language;
  const fromVoice = deriveLangFromVoiceName(s.voiceName);
  return fromVoice || configured;
}

/**
 * Compute chunk array using platform-aware maximum length.
 *
 * @param {string} content Full note content.
 * @param {TtsSettings} s Plugin settings.
 * @returns {string[]} Sentence-aware chunks.
 */
export function buildChunks(content: string, s: TtsSettings, isIos: boolean): string[] {
  const maxChars = isIos ? 500 : Math.max(500, Math.min(9000, Number(s.chunkSize) || 5000));
  return splitTextSmart(content, maxChars);
}

/**
 * Map SSML rate like +10% to playback rate, clamped to [0.5, 2.0].
 *
 * @param {string} rateStr SSML rate string, e.g., "+10%".
 * @returns {number} Playback rate.
 */
export function playbackRateFromRateSetting(rateStr: string): number {
  const m = /([+-]?\d+)%/.exec(rateStr || "+0%");
  const pct = m ? parseInt(m[1], 10) : 0;
  return Math.max(0.5, Math.min(2.0, 1 + pct / 100));
}

/**
 * Sort "Generated audio: [[...]]" lines by part number ascending; non-matching go last.
 *
 * @param {string[]} lines Lines beginning with "Generated audio: [[".
 * @returns {string[]} Sorted lines.
 */
export function sortGeneratedAudioLines(lines: string[]): string[] {
  const extractPart = (s: string): number => {
    const m = /_part_(\d+)\.(mp3|wav)/i.exec(s);
    return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
  };
  return [...lines].sort((a, b) => extractPart(a) - extractPart(b));
}
