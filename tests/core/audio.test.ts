import { test, expect } from "bun:test";
import { canStream } from "../../src/core/audio";

test("canStream returns mime for mp3 and supported=false without MSE", () => {
  const { supported, mime } = canStream("audio-24khz-48kbitrate-mono-mp3");
  expect(mime).toBe("audio/mpeg");
  expect(supported).toBe(false);
});

test("canStream returns mime for wav/riff", () => {
  const { mime } = canStream("riff-16khz-16bit-mono-pcm");
  expect(mime).toBe("audio/wav");
});


