import type { TtsProvider, Voice } from "../types";

/**
 * Backend provider proxying synthesis and voices via Cloudflare Workers (Hono API).
 */
export class BackendTtsProvider implements TtsProvider {
  private readonly backendUrl: string;
  private readonly licenseKey: string;
  private readonly region: string;
  private jwtToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(params: { backendUrl: string; licenseKey: string; region: string }) {
    this.backendUrl = params.backendUrl.replace(/\/$/, "");
    this.licenseKey = params.licenseKey;
    this.region = params.region;
  }

  private async getValidToken(): Promise<string> {
    if (this.jwtToken && Date.now() < this.tokenExpiry - 60_000) return this.jwtToken;
    const res = await fetch(`${this.backendUrl}/v1/auth/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ license_key: this.licenseKey })
    });
    if (!res.ok) {
      let msg = ""; try { const j = await res.json(); msg = j?.error || ""; } catch {}
      throw new Error(`License validation failed: ${msg || res.statusText}`);
    }
    const data = await res.json();
    this.jwtToken = data?.data?.token || null;
    const expiresIn = Number(data?.data?.expires_in) || 0;
    this.tokenExpiry = Date.now() + expiresIn * 1000;
    if (!this.jwtToken) throw new Error("No token in validation response");
    return this.jwtToken;
  }

  async synthesize(ssml: string, outputFormat: string, _lang: string, abortSignal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const token = await this.getValidToken();
    const res = await fetch(`${this.backendUrl}/v1/tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ ssml, outputFormat, language: this.region }),
      signal: abortSignal
    });
    if (!res.ok || !res.body) {
      let t = ""; try { t = await res.text(); } catch {}
      throw new Error(`TTS request failed: ${res.status}${t ? ` - ${t}` : ""}`);
    }
    return res.body as ReadableStream<Uint8Array>;
  }

  async listVoices(region?: string): Promise<Voice[]> {
    const r = region || this.region;
    const res = await fetch(`${this.backendUrl}/v1/voices?region=${encodeURIComponent(r)}`);
    if (!res.ok) {
      let t = ""; try { t = await res.text(); } catch {}
      throw new Error(`Failed to fetch voices: ${res.status}${t ? ` - ${t}` : ""}`);
    }
    const payload = await res.json();
    const items: Array<{ name?: string; shortName?: string }> = Array.isArray(payload?.data) ? payload.data : [];
    return items.filter(v => !!v?.name && !!v?.shortName).map(v => ({ name: String(v.name), shortName: String(v.shortName) }));
  }
}

