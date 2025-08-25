import { describe, it, expect } from "bun:test";
import { splitTextSmart } from "../../src/utils/chunk";

describe("utils/chunk more", () => {
  it("hard-splits a very long word exceeding maxChars", () => {
    const word = "x".repeat(50);
    const chunks = splitTextSmart(word, 10);
    expect(chunks.length).toBe(5);
    expect(chunks[0].length).toBe(10);
    expect(chunks[4].length).toBe(10);
  });

  it("respects sentence boundaries and merges until max", () => {
    const text = "A. B. C. D.";
    const chunks = splitTextSmart(text, 4);
    // Each sentence (1 char + '.') fits 2 chars + space merges as allowed
    expect(chunks.length).toBeGreaterThan(1);
  });
});


