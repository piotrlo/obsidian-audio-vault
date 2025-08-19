/**
 * Utility: split text into chunks preferring sentence boundaries without mutating input.
 *
 * @param {string} text Full text content.
 * @param {number} maxChars Maximum characters per chunk (default 10000).
 * @returns {string[]} Array of chunks.
 */
export function splitTextSmart(text: string, maxChars: number = 10000): string[] {
  if (!text) return [];
  const sentences = text.split(/[.!?]+\s/);
  const chunks: string[] = [];
  for (const sentenceRaw of sentences) {
    const sentence = sentenceRaw.trim();
    if (!sentence) continue;
    const candidate = (chunks.length ? chunks[chunks.length - 1] : "");
    const withPeriod = sentence + ". ";
    if (candidate.length && candidate.length + withPeriod.length <= maxChars) {
      chunks[chunks.length - 1] = candidate + withPeriod;
    } else {
      chunks.push(withPeriod);
    }
  }
  return chunks.map(s => s.trim());
}

