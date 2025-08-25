import { describe, it, expect } from "bun:test";
import { notify } from "../../src/core/notify";

describe("notify error paths", () => {
  it("does not throw when Notice construction fails", async () => {
    const settings = { debugLogs: true } as any;
    const origRequire = (globalThis as any).require;
    (globalThis as any).require = (_m: string) => ({ Notice: class { constructor(){ throw new Error('fail'); } } });
    expect(() => notify(settings, "x", true)).not.toThrow();
    (globalThis as any).require = origRequire;
  });
});


