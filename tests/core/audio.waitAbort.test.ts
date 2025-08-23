import { test, expect } from "bun:test";
import { waitForEndOrAbort } from "../../src/core/audio";

class FakeAudio {
  private listeners: Record<string, Array<(...args: any[]) => void>> = {};
  paused = false;
  addEventListener(evt: string, cb: (...args: any[]) => void) {
    this.listeners[evt] ||= [];
    this.listeners[evt].push(cb);
  }
  removeEventListener(evt: string, cb: (...args: any[]) => void) {
    this.listeners[evt] = (this.listeners[evt] || []).filter((f) => f !== cb);
  }
  pause() { this.paused = true; }
  emit(evt: string) { for (const cb of this.listeners[evt] || []) cb(); }
}

test("waitForEndOrAbort resolves on abort", async () => {
  const a = new FakeAudio() as any as HTMLAudioElement;
  const ac = new AbortController();
  const p = waitForEndOrAbort(a, ac.signal);
  ac.abort();
  await expect(p).resolves.toBeUndefined();
});

test("waitForEndOrAbort resolves on ended event", async () => {
  const a = new FakeAudio() as any as HTMLAudioElement;
  const ac = new AbortController();
  const p = waitForEndOrAbort(a, ac.signal);
  a.emit("ended");
  await expect(p).resolves.toBeUndefined();
});


