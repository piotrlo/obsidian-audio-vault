import type { TtsProvider, Voice } from "../types";
import {
  byteStream, isSuccessfulResponse, parseJson, requestUrlWithAbort,
} from "../network/request";
import type { RequestUrlResponse } from "obsidian";

function field(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  return Reflect.get(value, key);
}

function responseDetails(response: RequestUrlResponse): unknown {
  const parsed = parseJson(response.text);
  return parsed === undefined ? response.text || null : parsed;
}

class BackendHttpError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message);
    this.name = "BackendHttpError";
  }

  get code(): unknown {
    return field(this.body, "error_code") || field(this.body, "code");
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/**
 * Backend provider proxying synthesis and voices via Cloudflare Workers (Hono API).
 */
export class BackendTtsProvider implements TtsProvider {
  private readonly backendUrl: string;
  private readonly licenseKey: string;
  private readonly clientId?: string;
  private jwtToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(params: { backendUrl: string; licenseKey: string; clientId?: string }) {
    this.backendUrl = params.backendUrl.replace(/\/$/, "");
    this.licenseKey = params.licenseKey;
    this.clientId = params.clientId;
  }

  private async getValidToken(): Promise<string> {
    if (this.jwtToken && Date.now() < this.tokenExpiry - 60_000) return this.jwtToken;
    const useKey = !!(this.licenseKey && this.licenseKey.trim());
    const url = useKey ? `${this.backendUrl}/v1/auth/validate` : `${this.backendUrl}/v1/auth/activate-free`;
    const body = useKey ? { license_key: this.licenseKey, client_id: this.clientId } : { client_id: this.clientId };
    const res = await requestUrlWithAbort({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!isSuccessfulResponse(res.status)) {
      const detail = responseDetails(res);
      throw new BackendHttpError(`License validation failed: ${res.status}`, res.status, detail);
    }
    const payload = parseJson(res.text);
    const data = field(payload, "data");
    const token = stringValue(field(data, "token"));
    this.jwtToken = token ?? null;
    const expiresIn = Number(field(data, "expires_in")) || 0;
    this.tokenExpiry = Date.now() + expiresIn * 1000;
    if (!this.jwtToken) throw new Error("No token in validation response");
    return this.jwtToken;
  }

  /**
   * Expose token metadata for UI (plan, quota, expiry) using a single validation call.
   */
  async validateLicense(): Promise<{ token: string; expiresAtMs: number; plan?: string; quota_remaining?: number; quota_limit?: number }> {
    const useKey = !!(this.licenseKey && this.licenseKey.trim());
    const url = useKey ? `${this.backendUrl}/v1/auth/validate` : `${this.backendUrl}/v1/auth/activate-free`;
    const body = useKey ? { license_key: this.licenseKey, client_id: this.clientId } : { client_id: this.clientId };
    const res = await requestUrlWithAbort({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!isSuccessfulResponse(res.status)) {
      const detail = responseDetails(res);
      throw new BackendHttpError(`License validation failed: ${res.status}`, res.status, detail);
    }
    const payload = parseJson(res.text);
    const data = field(payload, "data");
    const token = stringValue(field(data, "token"));
    const expiresIn = Number(field(data, "expires_in")) || 0;
    this.jwtToken = token ?? null;
    this.tokenExpiry = Date.now() + expiresIn * 1000;
    if (!token) throw new Error("No token in validation response");
    return {
      token,
      expiresAtMs: this.tokenExpiry,
      plan: stringValue(field(data, "plan")),
      quota_remaining: numberValue(field(data, "quota_remaining")),
      quota_limit: numberValue(field(data, "quota_limit"))
    };
  }

  /**
   * Query usage using current or freshly obtained token.
   */
  async fetchUsage(): Promise<{ plan?: string; chars_used?: number; quota_remaining?: number; quota_limit?: number; period?: string }> {
    const token = await this.getValidToken();
    const res = await requestUrlWithAbort({
      url: `${this.backendUrl}/v1/auth/usage`,
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!isSuccessfulResponse(res.status)) {
      const detail = responseDetails(res);
      throw new BackendHttpError(`Usage fetch failed: ${res.status}`, res.status, detail);
    }
    const payload = parseJson(res.text);
    const data = field(payload, "data");
    return {
      plan: stringValue(field(data, "plan")),
      chars_used: numberValue(field(data, "chars_used")),
      quota_remaining: numberValue(field(data, "quota_remaining")),
      quota_limit: numberValue(field(data, "quota_limit")),
      period: stringValue(field(data, "period"))
    };
  }

  async synthesize(ssml: string, outputFormat: string, _lang: string, abortSignal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const makeReq = async (jwt: string) => requestUrlWithAbort({
      url: `${this.backendUrl}/v1/tts`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${jwt}`
      },
      body: JSON.stringify({ ssml, outputFormat, language: _lang }),
    }, abortSignal);

    let token = await this.getValidToken();
    let res = await makeReq(token);
    if (res.status === 401) {
      try {
        this.jwtToken = null;
        this.tokenExpiry = 0;
        token = await this.getValidToken();
        res = await makeReq(token);
      } catch { void 0; }
    }
    if (!isSuccessfulResponse(res.status)) {
      const detail = responseDetails(res);
      throw new BackendHttpError(`TTS request failed: ${res.status}`, res.status, detail);
    }
    return byteStream(res.arrayBuffer);
  }

  async listVoices(): Promise<Voice[]> {
    const res = await requestUrlWithAbort({ url: `${this.backendUrl}/v1/voices` });
    if (!isSuccessfulResponse(res.status)) {
      const text = res.text;
      throw new Error(`Failed to fetch voices: ${res.status}${text ? ` - ${text}` : ""}`);
    }
    const payload = parseJson(res.text);
    const items = field(payload, "data");
    if (!Array.isArray(items)) return [];
    return items.flatMap((item): Voice[] => {
      const name = field(item, "name");
      const shortName = field(item, "shortName");
      if (!name || !shortName) return [];
      return [{ name: String(name), shortName: String(shortName) }];
    });
  }
}
