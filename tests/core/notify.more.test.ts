import { describe, it, expect } from "bun:test";
import { notify } from "../../src/core/notify";

describe("core/notify more", () => {
  it("does nothing when not important and debugLogs is false", () => {
    expect(() => notify(undefined, "x", false)).not.toThrow();
  });

  it("uses require('obsidian') Notice when available", () => {
    const original: any = (globalThis as any).require;
    (globalThis as any).require = (_: string) => ({ Notice: class { constructor(_m: string){} } });
    try {
      expect(() => notify({ debugLogs: true } as any, "hello", true)).not.toThrow();
    } finally {
      (globalThis as any).require = original;
    }
  });
});


