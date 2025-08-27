import type { TtsSettings } from "../types";

export const DEFAULT_SETTINGS: TtsSettings = {
  ttsProvider: "azure",
  useBackend: true,
  backendUrl: "https://audio-vault.app",
  licenseKey: "",
  clientId: "",
  azureApiKey: "",
  azureRegion: "westeurope",
  voiceName: "en-US-Ava3:DragonHDLatestNeural",
  outputFormat: "audio-24khz-48kbitrate-mono-mp3",
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


