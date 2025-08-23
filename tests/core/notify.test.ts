import { test, expect } from "bun:test";
import { notify } from "../../src/core/notify";

test("notify does not throw when called without settings", () => {
  notify(undefined as any, "msg");
  expect(true).toBe(true);
});


