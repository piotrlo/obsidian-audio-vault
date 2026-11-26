import type { TtsProvider, Voice } from "../types";
import { mimeFromFormat } from "../core/helpers";
import { byteStream, isSuccessfulResponse, requestUrlWithAbort } from "../network/request";

export class AzureTtsProvider implements TtsProvider {
  private readonly apiKey: string;
  private readonly region: string;

  constructor(params: { apiKey: string; region: string }) {
    this.apiKey = params.apiKey;
    this.region = params.region;
  }

  async synthesize(ssml: string, outputFormat: string, _lang: string, abortSignal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const url = `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const fmt = outputFormat && outputFormat.trim() ? outputFormat.trim() : "audio-24khz-48kbitrate-mono-mp3";
    const res = await requestUrlWithAbort({
      url,
      method: "POST",
      headers: {
        accept: "audio/*",
        "User-Agent": "AudioVault/1.0",
        "Ocp-Apim-Subscription-Key": this.apiKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": fmt
      },
      body: ssml,
    }, abortSignal);
    if (!isSuccessfulResponse(res.status)) {
      const detail = res.text;
      throw new Error(`TTS stream failed: ${res.status}${detail ? ` - ${detail}` : ""}`);
    }
    return byteStream(res.arrayBuffer);
  }

  async listVoices(region?: string, apiKey?: string): Promise<Voice[]> {
    const r = (region && region.trim()) || this.region;
    const k = (apiKey && apiKey.trim()) || this.apiKey;
    const url = `https://${r}.tts.speech.microsoft.com/cognitiveservices/voices/list`;
    const res = await requestUrlWithAbort({ url, headers: { "Ocp-Apim-Subscription-Key": k } });
    if (!isSuccessfulResponse(res.status)) {
      const t = res.text;
      throw new Error(`Voice list failed: ${res.status}${t ? ` - ${t}` : ""}`);
    }
    const data: unknown = JSON.parse(res.text);
    const raw = Array.isArray(data) ? data : [];
    const out: Voice[] = [];
    for (const value of raw) {
      if (value === null || typeof value !== "object") continue;
      const name = Reflect.get(value, "Name") || Reflect.get(value, "ShortName") || "";
      const shortName = Reflect.get(value, "ShortName") || Reflect.get(value, "Name") || "";
      if (name && shortName) out.push({ name: String(name), shortName: String(shortName) });
    }
    return out;
  }
}

export function azureMimeFromFormat(outputFormat: string): string {
  return mimeFromFormat(outputFormat);
}

