/**
 * MP3 helpers for merging multiple MP3 chunks into a single file without re-encoding.
 */

/**
 * Strip ID3v2 tag at the beginning of a buffer if present.
 * Returns a subarray view without copying when possible.
 */
export function stripId3v2(input: Uint8Array): Uint8Array {
  if (input.byteLength < 10) return input;
  if (input[0] !== 0x49 || input[1] !== 0x44 || input[2] !== 0x33) return input; // 'ID3'
  const size = ((input[6] & 0x7f) << 21) | ((input[7] & 0x7f) << 14) | ((input[8] & 0x7f) << 7) | (input[9] & 0x7f);
  const total = 10 + size;
  if (total > input.byteLength) return input;
  return input.subarray(total);
}

/**
 * Simple in-memory assembler that collects raw MP3 frame bytes and produces a single Uint8Array.
 */
export class Mp3Assembler {
  private readonly parts: Uint8Array[] = [];

  append(chunk: Uint8Array): void {
    const cleaned = stripId3v2(chunk);
    if (cleaned.byteLength > 0) this.parts.push(cleaned);
  }

  build(): Uint8Array {
    const total = this.parts.reduce((n, p) => n + p.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of this.parts) { out.set(p, offset); offset += p.byteLength; }
    return out;
  }
}


