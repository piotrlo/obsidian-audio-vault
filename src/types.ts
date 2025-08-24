/**
 * Public types used across the plugin.
 */

/**
 * Settings for the ListenMode plugin.
 */
export type SupportedLang = 'auto' | 'pl-PL' | 'en-US';

export interface TtsSettings {
  /** Selected TTS provider identifier. */
  ttsProvider?: "azure";
  /** Use backend proxy (Cloudflare Workers) instead of direct provider calls. */
  useBackend?: boolean;
  /** Backend base URL when useBackend is enabled. */
  backendUrl?: string;
  /** License key used to obtain short-lived JWT from backend. */
  licenseKey?: string;
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
  /** Language selection constrained to supported values. */
  language: SupportedLang;
  /** If true, voice picker shows only Neural HD voices. */
  onlyHdVoices: boolean;
  /** Enable debug console logs. */
  debugLogs?: boolean;
  /** Maximum characters per TTS part (chunk). */
  chunkSize?: number;
  /** If true and output format is MP3, merge parts into a single file. */
  mergeParts: boolean;
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

/**
 * TTS provider abstraction (Stage 2).
 */
export interface TtsProvider {
  /**
   * Start synthesis as a byte stream for given SSML and format.
   */
  synthesize(ssml: string, outputFormat: string, lang: string, abortSignal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
  /**
   * List available voices for a region.
   */
  listVoices(region: string, apiKey?: string): Promise<Voice[]>;
}

