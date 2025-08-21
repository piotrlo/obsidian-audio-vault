import { test, expect } from "bun:test";
import { detectLanguage } from "../../src/utils/lang";

test("detectLanguage returns pl-PL when Polish diacritics present", () => {
  const txt = "To jest próbka tekstu z polskimi znakami: ążśźćłó";
  expect(detectLanguage(txt)).toBe("pl-PL");
});

test("detectLanguage defaults to en-US for plain ASCII", () => {
  const txt = "This is a plain English sentence without diacritics.";
  expect(detectLanguage(txt)).toBe("en-US");
});
