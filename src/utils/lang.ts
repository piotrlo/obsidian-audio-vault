/**
 * Heuristic language detection between pl-PL and en-US.
 * Favors pl-PL if Polish diacritics appear with minimal threshold.
 *
 * @param {string} text Note content.
 * @returns {"pl-PL" | "en-US"} Detected language.
 */
export function detectLanguage(text: string): "pl-PL" | "en-US" {
  const sample = (text || "").slice(0, 5000);
  const plChars = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g;
  const plMatches = sample.match(plChars)?.length || 0;
  if (plMatches >= 2) return "pl-PL";
  return "en-US";
}
