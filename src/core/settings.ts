import type { TtsSettings } from "../types";

export const DEFAULT_SETTINGS: TtsSettings = {
  ttsProvider: "azure",
  useBackend: false,
  backendUrl: "https://listenmode-backend.loch-piotr.workers.dev",
  licenseKey: "",
  azureApiKey: "",
  azureRegion: "westeurope",
  voiceName: "en-US-Ava:DragonHDLatestNeural",
  outputFormat: "audio-24khz-48kbitrate-mono-mp3",
  rate: "+10%",
  enableStreaming: true,
  audioFolder: "Audio",
  language: "pl-PL",
  onlyHdVoices: true,
  debugLogs: false,
  chunkSize: 5000,
  mergeParts: false
};


