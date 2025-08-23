import { test, expect } from "bun:test";
import { cleanupSessionResources } from "../../src/playback/session";

test("cleanupSessionResources returns null when setNull=true", async () => {
  const s = await cleanupSessionResources(null, true);
  expect(s).toBeNull();
});

test("cleanupSessionResources keeps object when setNull=false", async () => {
  const session = { abort: new AbortController(), audioEl: null, mediaSource: null, sourceBuffer: null, lastBlob: null } as any;
  const r = await cleanupSessionResources(session, false);
  expect(r).not.toBeNull();
});


