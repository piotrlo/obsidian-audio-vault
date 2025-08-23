import { expect, test } from "bun:test";
import { fileExtFromFormat, missingSettings, resolveLang, buildChunks, playbackRateFromRateSetting } from "../../src/core/helpers";

const samplePl = "To jest krótki tekst z polskimi znakami: ążźćńłó";
const sampleEn = "This is a short English sentence. It has punctuation!";

const baseSettings = {
  azureApiKey: "x",
  azureRegion: "westeurope",
  voiceName: "en-US-Ava:DragonHDLatestNeural",
  outputFormat: "audio-24khz-48kbitrate-mono-mp3",
  rate: "+10%",
  enableStreaming: true,
  audioFolder: "Audio",
  language: "auto",
  onlyHdVoices: true,
  debugLogs: false,
  chunkSize: 5000,
} as const;

test("fileExtFromFormat maps mp3/wav", () => {
  expect(fileExtFromFormat("audio-24khz-48kbitrate-mono-mp3")).toBe("mp3");
  expect(fileExtFromFormat("riff-24khz-16bit-mono-pcm")).toBe("wav");
});

test("missingSettings detects absent fields", () => {
  const s: any = { ...baseSettings, azureApiKey: "", outputFormat: "" };
  const missing = missingSettings(s);
  expect(missing.includes("Azure API Key")).toBe(true);
  expect(missing.includes("Output format")).toBe(true);
});

test("resolveLang prefers voice-derived language if present", () => {
  const s = { ...baseSettings, language: "auto", voiceName: "pl-PL-AgnieszkaNeural" } as any;
  expect(resolveLang(sampleEn, s)).toBe("pl-PL");
});

test("resolveLang falls back to detection when voice has no tag", () => {
  const s = { ...baseSettings, language: "auto", voiceName: "SomeVoiceNoTag" } as any;
  expect(resolveLang(samplePl, s)).toBe("pl-PL");
});

test("buildChunks respects platform-aware max length and returns non-empty", () => {
const s = { ...baseSettings, chunkSize: 500 } as any;
  const chunks = buildChunks(sampleEn.repeat(20), s, false);
  expect(chunks.length).toBeGreaterThan(1);
});

test("playbackRateFromRateSetting clamps and converts percent", () => {
  expect(playbackRateFromRateSetting("+10%")).toBeCloseTo(1.1, 3);
  expect(playbackRateFromRateSetting("-60%")).toBeCloseTo(0.5, 3);
  expect(playbackRateFromRateSetting("+500%")).toBeCloseTo(2.0, 3);
});

