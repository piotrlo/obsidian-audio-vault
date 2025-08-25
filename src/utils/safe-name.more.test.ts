import { describe, it, expect } from "bun:test";
import { toSafeBase } from "./safe-name";

describe("utils/safe-name", () => {
  it("normalizes to lowercase dashed", () => {
    expect(toSafeBase("Hello World!!")).toBe("hello-world");
    // Funkcja zostawia podwójne podkreślniki ("_") nietknięte i składa wielokrotne myślniki do jednego
    expect(toSafeBase("A__B--C")).toBe("a__b-c");
  });
});


