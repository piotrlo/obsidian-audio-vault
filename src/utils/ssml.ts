/**
 * Escape text for XML/SSML context.
 *
 * @param {string} input Raw text.
 * @returns {string} Escaped XML-safe text.
 */
export function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Build an SSML payload for Azure TTS.
 *
 * @param {{ text: string; voiceName: string; rate: string; lang: string }} p Parameters.
 * @returns {string} SSML string.
 */
export function buildSsml(p: { text: string; voiceName: string; rate: string; lang: string }): string {
  const safe = escapeXml(p.text);
  const lang = p.lang || "pl-PL";
  const rate = p.rate || "+10%";
  return `<?xml version="1.0" encoding="utf-8"?>\n<speak version="1.0" xml:lang="${lang}" xmlns:mstts="https://www.w3.org/2001/mstts">\n  <voice name="${p.voiceName}">\n    <prosody rate="${rate}">${safe}</prosody>\n  </voice>\n</speak>`;
}
