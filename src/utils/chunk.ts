/**
 * Utility: split text into chunks preferring sentence boundaries without mutating input.
 *
 * @param {string} text Full text content.
 * @param {number} maxChars Maximum characters per chunk (default 10000).
 * @returns {string[]} Array of chunks.
 */
export function splitTextSmart(text: string, maxChars: number = 10000): string[] {
  if (!text) return [];

  /**
   * Split into sentences while preserving punctuation. Treat new lines as boundaries too.
   * Matches sequences ending with ., !, ? (optionally repeated) or line breaks, or end-of-string.
   */
  const normalized = text.replace(/\r\n/g, "\n");
  const sentenceRegex = /[^.!?\n]+[.!?]+\s*|[^.!?\n]+\n+|[^.!?\n]+$/g;
  const sentences = normalized.match(sentenceRegex) || [normalized];

  const chunks: string[] = [];

  const pushPiece = (piece: string) => {
    const trimmed = piece.trim();
    if (!trimmed) return;
    const last = chunks.length ? chunks[chunks.length - 1] : "";
    if (last && last.length + trimmed.length + 1 <= maxChars) {
      chunks[chunks.length - 1] = (last + " " + trimmed).trim();
    } else if (trimmed.length <= maxChars) {
      chunks.push(trimmed);
    } else {
      // Word-level split for very long sentences
      const words = trimmed.split(/\s+/);
      let current = "";
      for (const w of words) {
        if (!w) continue;
        // If a single word exceeds maxChars, hard-split it.
        if (w.length > maxChars) {
          if (current) { chunks.push(current); current = ""; }
          for (let i = 0; i < w.length; i += maxChars) {
            chunks.push(w.slice(i, i + maxChars));
          }
          continue;
        }
        if (!current) {
          current = w;
        } else if (current.length + 1 + w.length <= maxChars) {
          current += " " + w;
        } else {
          chunks.push(current);
          current = w;
        }
      }
      if (current) chunks.push(current);
    }
  };

  for (const s of sentences) {
    pushPiece(s);
  }

  return chunks;
}

