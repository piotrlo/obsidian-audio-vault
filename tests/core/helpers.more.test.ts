import { describe, it, expect } from "bun:test";
import { fileExtFromFormat, mimeFromFormat, missingSettings, resolveLang, buildChunks, playbackRateFromRateSetting, sortGeneratedAudioLines } from "../../src/core/helpers";

describe("core/helpers", () => {
  it("fileExtFromFormat maps wav vs mp3", () => {
    expect(fileExtFromFormat("riff-24khz-16bit-mono-pcm")).toBe("wav");
    expect(fileExtFromFormat("audio-24khz-48kbitrate-mono-mp3")).toBe("mp3");
  });

  it("mimeFromFormat maps correctly", () => {
    expect(mimeFromFormat("riff-24khz-16bit-mono-pcm")).toBe("audio/wav");
    expect(mimeFromFormat("audio-24khz-48kbitrate-mono-mp3")).toBe("audio/mpeg");
  });

  it("missingSettings covers backend and direct modes", () => {
    const backend = { useBackend: true, backendUrl: "", licenseKey: "", azureRegion: "", azureApiKey: "", voiceName: "v", outputFormat: "mp3" } as any;
    const direct = { useBackend: false, azureApiKey: "", azureRegion: "", voiceName: "v", outputFormat: "mp3" } as any;
    expect(missingSettings(backend)).toContain("Backend URL");
    expect(missingSettings(direct)).toContain("Azure API Key");
  });

  it("resolveLang prefers voiceName-derived tag", () => {
    const s = { language: "auto", voiceName: "pl-PL-AgnieszkaNeural" } as any;
    const out = resolveLang("hello", s);
    expect(out).toBe("pl-PL");
  });

  it("buildChunks respects max and iOS cap", () => {
    const long = Array(1200).fill("a").join("");
    const chunksIos = buildChunks(long, { chunkSize: 9000 } as any, true);
    expect(chunksIos[0].length).toBeLessThanOrEqual(500);
    const chunks = buildChunks(long, { chunkSize: 600 } as any, false);
    expect(chunks[0].length).toBeLessThanOrEqual(600);
  });

  it("playbackRateFromRateSetting clamps range", () => {
    expect(playbackRateFromRateSetting("+10%")) .toBeCloseTo(1.1, 3);
    expect(playbackRateFromRateSetting("+500%")) .toBe(2.0);
    expect(playbackRateFromRateSetting("-90%")) .toBe(0.5);
  });

  it("sortGeneratedAudioLines sorts by _part_N", () => {
    const lines = [
      "Generated audio: [[Audio/f_part_10.mp3]]",
      "Generated audio: [[Audio/f_part_2.mp3]]",
      "Generated audio: [[Audio/f_part_1.mp3]]",
    ];
    const sorted = sortGeneratedAudioLines(lines);
    expect(sorted[0]).toContain("_part_1");
    expect(sorted[2]).toContain("_part_10");
  });
});


