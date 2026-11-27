import type { TtsSettings } from "../types";
import { CARTESIA_MP3, CARTESIA_VOICES } from "../tts/cartesia-provider";
import { normalizeVoiceLocale, validVoiceId } from "../tts/cartesia-catalog";

export const DEFAULT_CHUNK_SIZE = 500;

export const DEFAULT_SETTINGS: TtsSettings = {
  ttsProvider: "cartesia",
  cartesiaVoiceId: CARTESIA_VOICES[0].shortName,
  useBackend: false,
  licenseKey: "",
  clientId: "",
  azureApiKey: "",
  azureRegion: "westeurope",
  voiceName: "",
  outputFormat: CARTESIA_MP3,
  rate: "+10%",
  enableStreaming: true,
  audioFolder: "Audio",
  language: "auto",
  languageOverride: "",
  onlyHdVoices: true,
  debugLogs: false,
  chunkSize: DEFAULT_CHUNK_SIZE,
  mergeParts: true
  ,
  licensePlan: undefined,
  licenseValidatedKey: undefined,
  licenseQuotaRemaining: undefined,
  licenseQuotaLimit: undefined,
  licenseTokenExpiresAt: undefined,
  licenseUsagePeriod: undefined
};

export function loadTtsSettings(saved: unknown): TtsSettings {
  const stored: Partial<TtsSettings> = saved !== null && typeof saved === "object"
    ? saved
    : {};
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    ttsProvider: "cartesia",
    cartesiaVoiceId: validVoiceId(stored.cartesiaVoiceId) ? stored.cartesiaVoiceId : CARTESIA_VOICES[0].shortName,
    cartesiaVoiceLabel: typeof stored.cartesiaVoiceLabel === "string" ? stored.cartesiaVoiceLabel.slice(0, 256) : undefined,
    cartesiaVoiceLocale: typeof stored.cartesiaVoiceLocale === "string" ? normalizeVoiceLocale(stored.cartesiaVoiceLocale) : undefined,
    useBackend: false,
    backendUrl: undefined,
    azureApiKey: "",
    licenseKey: "",
    licenseValidatedKey: undefined,
    voiceName: "",
    outputFormat: CARTESIA_MP3,
  };
}
