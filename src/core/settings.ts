import type { TtsSettings } from "../types";
import { CARTESIA_MP3, CARTESIA_VOICES } from "../tts/cartesia-provider";

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
    cartesiaVoiceId: CARTESIA_VOICES.find((voice) => voice.shortName === saved?.cartesiaVoiceId)?.shortName
      ?? CARTESIA_VOICES[0].shortName,
    useBackend: false,
    backendUrl: undefined,
    azureApiKey: "",
    licenseKey: "",
    licenseValidatedKey: undefined,
    voiceName: "",
    outputFormat: CARTESIA_MP3,
  };
}

