import { describe, it, expect } from "bun:test";
import { detectLanguage } from "./lang";

describe("utils/lang", () => {
  it("detects pl-PL when diacritics present", () => {
    expect(detectLanguage("Zażółć gęślą jaźń")).toBe("pl-PL");
  });
  it("defaults to en-US", () => {
    expect(detectLanguage("Hello world")).toBe("en-US");
  });
});


