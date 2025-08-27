import type { TtsProvider, Voice } from "../types";
import { mimeFromFormat } from "../core/helpers";

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
    const res = await fetch(url, {
      method: "POST",
      headers: {
        accept: "audio/*",
        "User-Agent": "AudioVault/1.0",
        "Ocp-Apim-Subscription-Key": this.apiKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": fmt
      },
      body: ssml,
      signal: abortSignal
    });
    if (!res.ok || !res.body) {
      let detail = "";
      try { detail = await res.text(); } catch {}
      throw new Error(`TTS stream failed: ${res.status}${detail ? ` - ${detail}` : ""}`);
    }
    return res.body as ReadableStream<Uint8Array>;
  }

  async listVoices(region?: string, apiKey?: string): Promise<Voice[]> {
    const r = (region && region.trim()) || this.region;
    const k = (apiKey && apiKey.trim()) || this.apiKey;
    const url = `https://${r}.tts.speech.microsoft.com/cognitiveservices/voices/list`;
    const res = await fetch(url, { headers: { "Ocp-Apim-Subscription-Key": k } });
    if (!res.ok) {
      let t = ""; try { t = await res.text(); } catch {}
      throw new Error(`Voice list failed: ${res.status}${t ? ` - ${t}` : ""}`);
    }
    const data = await res.json();
    const raw: Array<{ ShortName?: string; Name?: string }> = Array.isArray(data) ? data : [];
    const out: Voice[] = [];
    for (const v of raw) {
      const name = v.Name || v.ShortName || "";
      const shortName = v.ShortName || v.Name || "";
      if (name && shortName) out.push({ name, shortName });
    }
    return out;
  }
}

export function azureMimeFromFormat(outputFormat: string): string {
  return mimeFromFormat(outputFormat);
}

