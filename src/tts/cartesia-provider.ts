import type { TtsProvider, Voice } from "../types";

export const CARTESIA_VOICES: readonly Voice[] = [
  { name: "Jacqueline (English)", shortName: "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc" },
  { name: "Marcin (Polish)", shortName: "d358377a-cd1d-45c5-abd0-701314e36cbe" },
  { name: "Agnieszka (Polish)", shortName: "6bc7c014-022b-42ce-8b53-a5ec878a7ca7" },
];

export const CARTESIA_KEY_STORAGE = "audiovault-cartesia-api-key";
export const CARTESIA_MP3 = "audio-24khz-64kbitrate-mono-mp3";
export const CARTESIA_API_VERSION = "2026-08-14";

export class CartesiaTtsProvider implements TtsProvider {
  readonly inputType = "text";
  readonly noSynthesisRetry = true;

  constructor(private readonly apiKey: string, private readonly voiceId: string) {}

  async listVoices(): Promise<Voice[]> {
    return [...CARTESIA_VOICES];
  }

  async synthesize(text: string, _format: string, lang: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const key = this.apiKey.trim();
    if (!key) throw new Error("Add your Cartesia API key in AudioVault settings to generate audio.");
    const response = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${key}`,
        "Cartesia-Version": CARTESIA_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: "sonic-3.6",
        transcript: text,
        voice: { id: this.voiceId },
        language: lang,
        output_format: { container: "mp3", sample_rate: 24000, bit_rate: 64000 },
      }),
      signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error("Cartesia rejected the API key or this voice is not available to your account.");
    }
    if (response.status === 402 || response.status === 429) {
      throw new Error(`Cartesia declined the request (${response.status}). Check your credits and rate limits.`);
    }
    if (!response.ok) throw new Error(`Cartesia synthesis failed (HTTP ${response.status}).`);
    if (!response.body || !/^audio\/(?:mpeg|mp3)\b/i.test(response.headers.get("content-type") ?? "")) {
      throw new Error("Cartesia did not return MP3 audio.");
    }
    return response.body;
  }
}
