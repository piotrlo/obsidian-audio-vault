import { afterEach, expect, test } from "bun:test";
import { loadTtsSettings } from "../../src/core/settings";
import { CARTESIA_MP3, CARTESIA_VOICES, CartesiaTtsProvider } from "../../src/tts/cartesia-provider";
import { synthesisInput } from "../../src/tts/input";

const originalFetch = globalThis.fetch;
const voice = CARTESIA_VOICES[0].shortName;
afterEach(() => { globalThis.fetch = originalFetch; });

test("defaults to an English voice and preserves an existing Polish voice", () => {
  expect(CARTESIA_VOICES[0].name).toBe("Jacqueline (English)");
  expect(loadTtsSettings(null).cartesiaVoiceId).toBe(voice);
  const polishVoice = CARTESIA_VOICES.find((entry) => entry.name === "Agnieszka (Polish)")!;
  expect(loadTtsSettings({ cartesiaVoiceId: polishVoice.shortName }).cartesiaVoiceId).toBe(polishVoice.shortName);
});

test("sends unwrapped note text and streams MP3 from Cartesia", async () => {
  const signal = new AbortController().signal;
  const provider = new CartesiaTtsProvider(" test-key ", voice);
  const text = "< 5 zł & więcej";
  globalThis.fetch = (async (url, init) => {
    expect(url).toBe("https://api.cartesia.ai/tts/bytes");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-key");
    expect(new Headers(init?.headers).get("Cartesia-Version")).toBe("2026-08-14");
    expect(JSON.parse(String(init?.body))).toEqual({
      model_id: "sonic-3.6", transcript: text, voice: { id: voice }, language: "pl-PL",
      output_format: { container: "mp3", sample_rate: 24000, bit_rate: 64000 },
    });
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
  }) as typeof fetch;
  const result = await provider.synthesize(synthesisInput(provider, text, loadTtsSettings(null), "pl-PL"), CARTESIA_MP3, "pl-PL", signal);
  expect(new Uint8Array(await new Response(result).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
});

test("rejects a missing key without making a request", async () => {
  globalThis.fetch = Object.assign(() => { throw new Error("Unexpected request"); }, { preconnect: originalFetch.preconnect });
  await expect(new CartesiaTtsProvider(" ", voice).synthesize("test", CARTESIA_MP3, "pl", new AbortController().signal))
    .rejects.toThrow("Add your Cartesia API key");
});

test("reports billing or throttling errors without retrying or exposing the response body", async () => {
  let calls = 0;
  globalThis.fetch = Object.assign(async () => {
    calls++;
    return new Response("sensitive text", { status: 429 });
  }, { preconnect: originalFetch.preconnect });
  await expect(new CartesiaTtsProvider("test-key", voice).synthesize("test", CARTESIA_MP3, "pl", new AbortController().signal))
    .rejects.toThrow("Check your credits and rate limits");
  expect(calls).toBe(1);
});

test("legacy settings cannot select Azure or its proxy", () => {
  expect(loadTtsSettings({
    ttsProvider: "azure", useBackend: true, backendUrl: "https://legacy.example",
    azureApiKey: "legacy", licenseKey: "legacy", voiceName: "legacy", outputFormat: "wav", audioFolder: "Spoken",
  })).toMatchObject({
    ttsProvider: "cartesia", useBackend: false, backendUrl: undefined, azureApiKey: "",
    licenseKey: "", cartesiaVoiceId: voice, outputFormat: CARTESIA_MP3, audioFolder: "Spoken",
  });
});
