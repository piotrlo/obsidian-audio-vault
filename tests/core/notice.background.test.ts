import { test, expect } from "bun:test";
import { backgroundPausedNotice, backgroundResumedNotice } from "../../src/core/notify";

test("background notices call notify (no throw)", () => {
  expect(() => backgroundPausedNotice({ debugLogs: true } as any)).not.toThrow();
  expect(() => backgroundResumedNotice({ debugLogs: true } as any)).not.toThrow();
});


