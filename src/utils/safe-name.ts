/**
 * Utility: generate safe base names for files.
 *
 * @param {string} input Raw base name.
 * @returns {string} Safe, lowercase, dash-separated base name.
 */
export function toSafeBase(input: string): string {
  return input
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

