import { describe, it, expect } from "bun:test";
import { mimeFromFormat, fileExtFromFormat } from "../../src/core/helpers";

describe("MP3-only integration expectations", () => {
  it("prefers mp3 mime/ext across helpers", () => {
    const fmt = 'audio-24khz-48kbitrate-mono-mp3';
    const mime = mimeFromFormat(fmt);
    const ext = fileExtFromFormat(fmt);
    expect(mime).toBe('audio/mpeg');
    expect(ext).toBe('mp3');
  });
});


