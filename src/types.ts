/**
 * Public types used across the plugin.
 */

/**
 * Settings for the ListenMode plugin.
 */
export interface TtsSettings {
  /** Azure AI Speech API key stored in plugin data. */
  azureApiKey: string;
  /** Azure region, e.g., westeurope. */
  azureRegion: string;
  /** Voice short name, e.g., en-US-Ava:DragonHDLatestNeural or pl-PL-AgnieszkaNeural. */
  voiceName: string;
  /** Output audio format string for Azure, e.g., audio-24khz-48kbitrate-mono-mp3. */
  outputFormat: string;
  /** SSML prosody rate string, e.g., "+10%". */
  rate: string;
  /** Enable streaming via MSE if available. */
  enableStreaming: boolean;
  /** Target vault folder for audio files. */
  audioFolder: string;
  /** Language selection: 'auto' | 'pl-PL' | 'en-US'. */
  language: string;
  /** If true, voice picker shows only Neural HD voices. */
  onlyHdVoices: boolean;
  /** Enable debug console logs. */
  debugLogs?: boolean;
  /** Maximum characters per TTS part (chunk). */
  chunkSize?: number;
  // Panel removed
}

/**
 * In-memory playback session bookkeeping.
 */
export interface PlaybackSession {
  abort: AbortController;
  audioEl: HTMLAudioElement | null;
  mediaSource: MediaSource | null;
  sourceBuffer: SourceBuffer | null;
  lastBlob: Blob | null;
  fileBase?: string;
  objectUrl?: string;
}

/**
 * Minimal voice info.
 */
export interface Voice {
  name: string;
  shortName: string;
}

