import type { TtsSettings } from "../types";
import { CARTESIA_MP3, CARTESIA_VOICES } from "../tts/cartesia-provider";
import { normalizeVoiceLocale, validVoiceId } from "../tts/cartesia-catalog";

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
  chunkSize: 5000,
  mergeParts: true
  ,
  licensePlan: undefined,
  licenseValidatedKey: undefined,
  licenseQuotaRemaining: undefined,
  licenseQuotaLimit: undefined,
  licenseTokenExpiresAt: undefined,
  licenseUsagePeriod: undefined
};

export function loadTtsSettings(saved: Partial<TtsSettings> | null): TtsSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    ttsProvider: "cartesia",
    cartesiaVoiceId: validVoiceId(saved?.cartesiaVoiceId) ? saved.cartesiaVoiceId : CARTESIA_VOICES[0].shortName,
    cartesiaVoiceLabel: typeof saved?.cartesiaVoiceLabel === "string" ? saved.cartesiaVoiceLabel.slice(0, 256) : undefined,
    cartesiaVoiceLocale: typeof saved?.cartesiaVoiceLocale === "string" ? normalizeVoiceLocale(saved.cartesiaVoiceLocale) : undefined,
    useBackend: false,
    backendUrl: undefined,
    azureApiKey: "",
    licenseKey: "",
    licenseValidatedKey: undefined,
    voiceName: "",
    outputFormat: CARTESIA_MP3,
  };
}
