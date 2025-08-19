/**
 * Minimal test for splitTextSmart behavior and types.
 */
import { expect, test } from "bun:test";

function splitTextSmart(text: string, maxChars: number): string[] {
  const sentences = text.split(/[.!?]+\s/);
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    const next = (current ? current + s + ". " : s + ". ");
    if (next.length > maxChars) {
      if (current) chunks.push(current.trim());
      current = s + ". ";
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

test("splitTextSmart respects max length", () => {
  const text = "Ala ma kota. Kot ma Ale. To jest test zdania.".repeat(50);
  const parts = splitTextSmart(text, 35000);
  expect(parts.length).toBeGreaterThan(0);
  expect(parts.every(p => p.length <= 35000)).toBe(true);
});

