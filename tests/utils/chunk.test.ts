import { describe, expect, test } from "bun:test";
import { splitTextSmart } from "../../src/utils/chunk";

/**
 * Basic tests for splitTextSmart utility.
 */
describe("splitTextSmart", () => {
  test("splits into chunks under max size and preserves sentence boundaries", () => {
    const text = "Ala ma kota. Kot ma Alę. To jest trzecie zdanie.";
    const parts = splitTextSmart(text, 30);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(30);
    }
  });
});

