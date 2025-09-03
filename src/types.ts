/**
 * Public types used across the plugin.
 */

/**
 * Settings for the AudioVault plugin.
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
  /** Anonymous device/client identifier used by backend licensing. */
  clientId?: string;
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
  /** Optional BCP-47 override (e.g., es-ES). When set, overrides auto detection. */
  languageOverride?: string;
  /** If true, voice picker shows only Neural HD voices. */
  onlyHdVoices: boolean;
  /** Enable debug console logs. */
  debugLogs?: boolean;
  /** Maximum characters per TTS part (chunk). */
  chunkSize?: number;
  /** If true and output format is MP3, merge parts into a single file. */
  mergeParts: boolean;
  /** Cached license plan from backend validation. */
  licensePlan?: string;
  /** License key that was last successfully validated; used to mark dirty input. */
  licenseValidatedKey?: string;
  /** Cached remaining quota (characters) from backend validation/usage. */
  licenseQuotaRemaining?: number;
  /** Cached quota limit (characters) from backend validation/usage. */
  licenseQuotaLimit?: number;
  /** JWT token expiry timestamp (ms since epoch) from last validation. */
  licenseTokenExpiresAt?: number;
  /** Usage period string (YYYY-MM) from backend usage endpoint. */
  licenseUsagePeriod?: string;
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

/**
 * Result of a single prefetch task.
 */
export interface PrefetchResult {
  /** Zero-based part index. */
  idx: number;
  /** Raw audio bytes for the part. */
  buffer: ArrayBuffer;
  /** MIME type for the bytes. */
  mime: string;
}

/**
 * Lightweight manifest describing fetched audio parts and merge progress.
 */
export interface AudioManifest {
  /** Schema version for future migrations. */
  version: number;
  /** File extension without dot (e.g. "mp3"). */
  ext: string;
  /** Expected total number of parts for the note. */
  totalParts: number;
  /** 1-based indices of fetched parts. */
  fetchedParts: number[];
  /** Highest 1-based part index already merged into the partial snapshot. */
  mergedUntil: number;
  /** Last update timestamp in milliseconds since epoch. */
  updatedAt: number;
}

/**
 * Result type for operations that can fail.
 * Provides type-safe error handling without exceptions.
 */
export type Result<T, E = Error> = 
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Helper functions for Result type construction.
 */
export const Result = {
  /**
   * Creates a successful result.
   * @param value The success value
   * @returns Success result
   */
  ok: <T>(value: T): Result<T, never> => ({ ok: true, value }),
  
  /**
   * Creates a failed result.
   * @param error The error value
   * @returns Error result
   */
  err: <E>(error: E): Result<never, E> => ({ ok: false, error }),
};

/**
 * Transient error that should be retried.
 * Used for network failures, timeouts, rate limits, etc.
 */
export interface TransientError {
  kind: 'transient';
  reason: string;
  /** Optional retry delay hint in milliseconds */
  retryAfter?: number;
  /** Original error that caused this */
  cause?: Error;
}

/**
 * Permanent error that should not be retried.
 * Used for authentication failures, invalid requests, etc.
 */
export interface PermanentError {
  kind: 'permanent';
  reason: string;
  /** HTTP status code if applicable */
  status?: number;
  /** Error code if applicable */
  code?: string;
  /** Original error that caused this */
  cause?: Error;
}

/**
 * Union type for all error types in the system.
 */
export type AudioVaultError = TransientError | PermanentError;

/**
 * Helper functions for error construction.
 */
export const AudioVaultError = {
  /**
   * Creates a transient error.
   */
  transient: (reason: string, options?: { retryAfter?: number; cause?: Error }): TransientError => ({
    kind: 'transient',
    reason,
    retryAfter: options?.retryAfter,
    cause: options?.cause,
  }),
  
  /**
   * Creates a permanent error.
   */
  permanent: (reason: string, options?: { status?: number; code?: string; cause?: Error }): PermanentError => ({
    kind: 'permanent',
    reason,
    status: options?.status,
    code: options?.code,
    cause: options?.cause,
  }),
};

