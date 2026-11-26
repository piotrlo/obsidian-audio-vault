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


/**
 * Build a partial merged MP3 snapshot and return as ArrayBuffer.
 * Intended for periodic persistence to `<base>.partial.mp3`.
 *
 * @param {Mp3Assembler} assembler In-memory assembler with appended parts.
 * @returns {ArrayBuffer} Built ArrayBuffer of merged data.
 */
export function buildPartialSnapshot(assembler: Mp3Assembler): ArrayBuffer {
  const merged = assembler.build();
  const ab = new ArrayBuffer(merged.byteLength);
  new Uint8Array(ab).set(merged);
  return ab;
}

/**
 * Write a partial MP3 snapshot to disk atomically after parts are merged.
 * Creates `<folder>/<base>.partial.mp3` with current assembled data.
 * 
 * @param app Obsidian app instance
 * @param folder Audio folder path
 * @param base Safe base name without extension
 * @param assembler MP3 assembler with merged parts
 * @param mergedUntil Number of parts merged (for manifest update)
 * @returns Result indicating success/failure with merged count
 */
export async function flushPartial(
  app: any, // App type from obsidian
  folder: string,
  base: string,
  assembler: Mp3Assembler,
  mergedUntil: number
): Promise<{ ok: true; value: { path: string; mergedUntil: number } } | { ok: false; error: { kind: 'permanent'; reason: string; cause?: Error } }> {
  try {
    const partialPath = `${folder}/${base}.partial.mp3`;
    const snapshot = buildPartialSnapshot(assembler);
    
    // Write atomically using temporary file
    const tmpPath = `${partialPath}.tmp`;
    
    try {
      await app.vault.adapter.writeBinary(tmpPath, snapshot);
      await app.vault.adapter.rename(tmpPath, partialPath);
    } catch {
      // Fallback: direct write and cleanup temp
      await app.vault.adapter.writeBinary(partialPath, snapshot);
      try {
        await app.vault.adapter.remove(tmpPath);
      } catch {}
    }
    
    return {
      ok: true,
      value: {
        path: partialPath,
        mergedUntil,
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: {
        kind: 'permanent',
        reason: `Failed to flush partial MP3: ${message}`,
        cause: error instanceof Error ? error : undefined,
      }
    };
  }
}

/**
 * Finalize the merge process by creating the final merged file and cleaning up.
 * 
 * Steps:
 * 1. Create `<folder>/<base>.mp3` from assembled data
 * 2. Remove `<folder>/<base>.partial.mp3` if it exists
 * 3. Remove `<folder>/<base>.manifest.json` 
 * 4. Optionally remove individual part files
 * 
 * @param app Obsidian app instance
 * @param folder Audio folder path
 * @param base Safe base name without extension
 * @param assembler MP3 assembler with all parts
 * @param cleanupParts Whether to remove individual part files
 * @param totalParts Total number of parts for cleanup
 * @param ext File extension for parts (e.g., 'mp3')
 * @returns Result with final file path or error
 */
export async function finalizeMerge(
  app: any, // App type from obsidian
  folder: string,
  base: string,
  assembler: Mp3Assembler,
  options: {
    cleanupParts?: boolean;
    totalParts?: number;
    ext?: string;
  } = {}
): Promise<{ ok: true; value: { finalPath: string; cleanedFiles: string[] } } | { ok: false; error: { kind: 'permanent'; reason: string; cause?: Error } }> {
  const { cleanupParts = true, totalParts = 0, ext = 'mp3' } = options;
  
  try {
    const finalPath = `${folder}/${base}.${ext}`;
    const partialPath = `${folder}/${base}.partial.${ext}`;
    const manifestPath = `${folder}/${base}.manifest.json`;
    
    // Build final merged data
    const finalData = buildPartialSnapshot(assembler);
    
    // Write final file atomically
    const tmpPath = `${finalPath}.tmp`;
    
    try {
      await app.vault.adapter.writeBinary(tmpPath, finalData);
      await app.vault.adapter.rename(tmpPath, finalPath);
    } catch {
      // Fallback: direct write and cleanup temp
      await app.vault.adapter.writeBinary(finalPath, finalData);
      try {
        await app.vault.adapter.remove(tmpPath);
      } catch {}
    }
    
    // Cleanup files (best effort - continue even if some fail)
    const cleanedFiles: string[] = [];
    
    // Remove partial file
    try {
      const partialExists = await app.vault.adapter.exists(partialPath);
      if (partialExists) {
        await app.vault.adapter.remove(partialPath);
        cleanedFiles.push(partialPath);
      }
    } catch {}
    
    // Remove manifest
    try {
      const manifestExists = await app.vault.adapter.exists(manifestPath);
      if (manifestExists) {
        await app.vault.adapter.remove(manifestPath);
        cleanedFiles.push(manifestPath);
      }
    } catch {}
    
    // Remove individual part files if requested
    if (cleanupParts && totalParts > 0) {
      for (let i = 1; i <= totalParts; i++) {
        try {
          const partPath = `${folder}/${base}_part_${i}.${ext}`;
          const partExists = await app.vault.adapter.exists(partPath);
          if (partExists) {
            await app.vault.adapter.remove(partPath);
            cleanedFiles.push(partPath);
          }
        } catch {}
      }
    }
    
    return {
      ok: true,
      value: {
        finalPath,
        cleanedFiles,
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: {
        kind: 'permanent',
        reason: `Failed to finalize merge: ${message}`,
        cause: error instanceof Error ? error : undefined,
      }
    };
  }
}

/**
 * Enhanced assembler that tracks merged state and supports partial snapshots.
 * Maintains compatibility with the original Mp3Assembler interface.
 */
export class EnhancedMp3Assembler extends Mp3Assembler {
  private _mergedUntilPart = 0;
  
  /**
   * Append a part to the assembler and mark it as merged.
   * @param chunk Raw MP3 data for the part
   * @param partIndex 1-based part index for tracking
   */
  appendPart(chunk: Uint8Array, partIndex: number): void {
    this.append(chunk);
    this._mergedUntilPart = Math.max(this._mergedUntilPart, partIndex);
  }
  
  /**
   * Get the highest part index that has been merged.
   * @returns 1-based part index, 0 if no parts merged
   */
  get mergedUntilPart(): number {
    return this._mergedUntilPart;
  }
  
  /**
   * Reset the assembler state.
   */
  reset(): void {
    (this as any).parts.length = 0; // Access private parts array
    this._mergedUntilPart = 0;
  }
  
  /**
   * Check if all expected parts have been merged.
   * @param totalParts Expected total number of parts
   * @returns True if all parts are merged
   */
  isComplete(totalParts: number): boolean {
    return this._mergedUntilPart >= totalParts;
  }
}

