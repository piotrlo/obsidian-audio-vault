import type { TtsProvider, Voice } from "../types";

/**
 * Backend provider proxying synthesis and voices via Cloudflare Workers (Hono API).
 */
export class BackendTtsProvider implements TtsProvider {
  private readonly backendUrl: string;
  private readonly licenseKey: string;
  private jwtToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(params: { backendUrl: string; licenseKey: string }) {
    this.backendUrl = params.backendUrl.replace(/\/$/, "");
    this.licenseKey = params.licenseKey;
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

  /**
   * Expose token metadata for UI (plan, quota, expiry) using a single validation call.
   */
  async validateLicense(): Promise<{ token: string; expiresAtMs: number; plan?: string; quota_remaining?: number; quota_limit?: number }> {
    const res = await fetch(`${this.backendUrl}/v1/auth/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ license_key: this.licenseKey })
    });
    if (!res.ok) {
      let t = ""; try { t = await res.text(); } catch {}
      throw new Error(`License validation failed: ${res.status}${t ? ` - ${t}` : ""}`);
    }
    const payload = await res.json();
    const token = payload?.data?.token as string | undefined;
    const expiresIn = Number(payload?.data?.expires_in) || 0;
    this.jwtToken = token || null;
    this.tokenExpiry = Date.now() + expiresIn * 1000;
    if (!token) throw new Error("No token in validation response");
    return {
      token,
      expiresAtMs: this.tokenExpiry,
      plan: payload?.data?.plan,
      quota_remaining: payload?.data?.quota_remaining,
      quota_limit: payload?.data?.quota_limit
    };
  }

  /**
   * Query usage using current or freshly obtained token.
   */
  async fetchUsage(): Promise<{ plan?: string; chars_used?: number; quota_remaining?: number; quota_limit?: number; period?: string }> {
    const token = await this.getValidToken();
    const res = await fetch(`${this.backendUrl}/v1/auth/usage`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      let t = ""; try { t = await res.text(); } catch {}
      throw new Error(`Usage fetch failed: ${res.status}${t ? ` - ${t}` : ""}`);
    }
    const payload = await res.json();
    return payload?.data || {};
  }

  async synthesize(ssml: string, outputFormat: string, _lang: string, abortSignal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const token = await this.getValidToken();
    const res = await fetch(`${this.backendUrl}/v1/tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ ssml, outputFormat, language: _lang }),
      signal: abortSignal
    });
    if (!res.ok || !res.body) {
      let t = ""; try { t = await res.text(); } catch {}
      throw new Error(`TTS request failed: ${res.status}${t ? ` - ${t}` : ""}`);
    }
    return res.body as ReadableStream<Uint8Array>;
  }

  async listVoices(): Promise<Voice[]> {
    const res = await fetch(`${this.backendUrl}/v1/voices`);
    if (!res.ok) {
      let t = ""; try { t = await res.text(); } catch {}
      throw new Error(`Failed to fetch voices: ${res.status}${t ? ` - ${t}` : ""}`);
    }
    const payload = await res.json();
    const items: Array<{ name?: string; shortName?: string }> = Array.isArray(payload?.data) ? payload.data : [];
    return items.filter(v => !!v?.name && !!v?.shortName).map(v => ({ name: String(v.name), shortName: String(v.shortName) }));
  }
}

