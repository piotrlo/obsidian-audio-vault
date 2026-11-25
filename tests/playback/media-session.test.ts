import { expect, test } from "bun:test";
import { attachMediaSession } from "../../src/playback/media-session";

function fixture() {
  const handlers = new Map<MediaSessionAction, MediaSessionActionHandler>();
  const session: Pick<MediaSession, "metadata" | "playbackState" | "setActionHandler"> = {
    metadata: null,
    playbackState: "none",
    setActionHandler(action, handler) {
      if (handler) handlers.set(action, handler);
      else handlers.delete(action);
    },
  };
  const audio = new class extends EventTarget {
    paused = true;
    ended = false;
    async play() {
      this.paused = false;
      this.dispatchEvent(new Event("play"));
    }
    pause() {
      this.paused = true;
      this.dispatchEvent(new Event("pause"));
    }
  }();
  const attach = (onResumeError = () => {}) =>
    attachMediaSession(audio, "Field notes", onResumeError, session, (init) => init as MediaMetadata);
  return { attach, audio, handlers, session };
}

test("exposes note metadata and controls only the attached audio", async () => {
  const { attach, audio, handlers, session } = fixture();
  const detach = attach();
  expect(session.metadata).toMatchObject({ title: "Field notes", artist: "AudioVault" });
  expect(session.metadata?.artwork[0].src).toStartWith("data:image/");
  expect([...handlers.keys()]).toEqual(["play", "pause"]);
  const play = handlers.get("play")!;
  await play({ action: "play" });
  expect(audio.paused).toBe(false);
  expect(session.playbackState).toBe("playing");
  handlers.get("pause")!({ action: "pause" });
  expect(audio.paused).toBe(true);
  expect(session.playbackState).toBe("paused");

  detach();
  expect(session.metadata).toBeNull();
  expect(session.playbackState).toBe("none");
  expect(handlers.size).toBe(0);
  await play({ action: "play" });
  audio.dispatchEvent(new Event("play"));
  expect(audio.paused).toBe(true);
  expect(session.playbackState).toBe("none");
});

test("reports resume failures, but ignores failures from a detached clip", async () => {
  const { attach, audio, handlers } = fixture();
  let failures = 0;
  const detach = attach(() => { failures++; });
  audio.play = async () => { throw new Error("not allowed"); };
  const play = handlers.get("play")!;
  await play({ action: "play" });
  await Promise.resolve();
  expect(failures).toBe(1);
  play({ action: "play" });
  detach();
  await Promise.resolve();
  expect(failures).toBe(1);
});

test("falls back if metadata or an action is unsupported", () => {
  const { audio, handlers, session } = fixture();
  const set = session.setActionHandler;
  session.setActionHandler = (action, handler) => {
    if (action === "play") throw new Error("unsupported");
    set(action, handler);
  };
  const detach = attachMediaSession(audio, "Note", () => {}, session, () => { throw new Error("unsupported"); });
  expect([...handlers.keys()]).toEqual(["pause"]);
  expect(detach).not.toThrow();
  expect(handlers.size).toBe(0);
  expect(attachMediaSession(audio, "Note", () => {}, null)).not.toThrow();
});
