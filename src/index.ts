import { Plugin, Notice, Platform, TFile } from "obsidian";
import { toSafeBase } from "./utils/safe-name";
import { buildSsml, deriveLangFromVoiceName } from "./utils/ssml";
import { detectLanguage } from "./utils/lang";
import { ensureFolder, writeBinary, deleteExistingParts, upsertAudioReferenceSorted } from "./utils/fs";
import { fetchTtsAudio } from "./tts/azure";
import { log, warn, setDebugLogging } from "./utils/logger";
import { ListenModeSettingsTab } from "./obsidian/settings";
import { fileExtFromFormat, missingSettings, resolveLang, buildChunks } from "./core/helpers";
import type { PlaybackSession, TtsSettings } from "./types";
import { canStream } from "./core/audio";
import { cleanupSessionResources as cleanupSessionResourcesHelper } from "./playback/session";
import { tryPlayExistingParts as tryPlayExistingPartsHelper } from "./playback/existing";
import { playBufferedPrefetch as playBufferedPrefetchHelper } from "./playback/buffered";
import { DEFAULT_SETTINGS } from "./core/settings";
import { playStreamedPartAndSave } from "./playback/streaming";
import { notify as notifyUtil } from "./core/notify";


/**
 * ListenMode Obsidian plugin entrypoint (MVP wiring).
 */
export default class ListenModePlugin extends Plugin {
  /** Current settings. */
  settings!: TtsSettings;
  /** Session state. */
  currentSession: PlaybackSession | null = null;
  /** No on-screen panel. */
  /** Stop flag to cancel entire multi-part session. */
  private stopRequested: boolean = false;

  /**
   * Load settings and register commands.
   */
  async onload(): Promise<void> {
    await this.loadSettings();
    setDebugLogging(!!this.settings.debugLogs);
    this.addCommand({ id: "listenmode-play-pause", name: "Play/Pause current note", callback: () => { this.playOrStart(); } });
    this.addCommand({ id: "listenmode-stop", name: "Stop", callback: () => { void this.stopPlayback(); } });
    this.addCommand({ id: "listenmode-restart", name: "Restart", callback: () => { void this.readCurrentNote(true); } });
    this.addCommand({ id: "listenmode-download", name: "Download audio (no playback)", callback: () => { void this.downloadCurrentNote(); } });

    /** Ribbon: Play/Pause current note */
    this.addRibbonIcon('headphones', 'Play/Pause current note', () => { this.playOrStart(); });

    this.addSettingTab(new ListenModeSettingsTab(this.app, this));
  }

  /**
   * Destroy UI and stop playback.
   */
  async onunload(): Promise<void> {
    await this.stopPlayback(true);
  }
/**
 * No UI panel is rendered in the MVP; kept for API compatibility.
 */
destroyPanel(): void {}

  /**
   * Read the active note, stream playback, and save audio files.
   */
async readCurrentNote(forceRegenerate: boolean = false): Promise<void> {
    await this.stopPlayback(true);
    this.stopRequested = false;
    const file = this.app.workspace.getActiveFile();
if (!file) { notifyUtil(this.settings, "No active note", true); return; }
    const missing = missingSettings(this.settings);
if (missing.length) { notifyUtil(this.settings, `Missing settings: ${missing.join(", ")}`, true); return; }

    const content = await this.app.vault.read(file);
if (!content.trim()) { notifyUtil(this.settings, "Note is empty", true); return; }

const chunks = buildChunks(content, this.settings, Platform.isIosApp === true);
notifyUtil(this.settings, `Starting playback and generation (${chunks.length} part(s))...`, true);
    log("chunking result", { count: chunks.length });

    const base = toSafeBase(file.basename);
    const autoLang = detectLanguage(content);
    const folder = this.settings.audioFolder || "Audio";
    try {
      await ensureFolder(this.app, folder);
    } catch (e) {
notifyUtil(this.settings, `Failed to ensure folder "${folder}": ${((e as any)?.message) || String(e)}` , true);
      return;
    }

    if (await this.tryPlayExistingParts(base, folder, chunks.length, forceRegenerate)) {
      return;
    }

    const isIos = Platform.isIosApp === true;
    const lang = resolveLang(content, this.settings);

    if (isIos) {
notifyUtil(this.settings, "Using buffered prefetch mode (iOS)");
      await this.playBufferedPrefetch(chunks, 0, base, autoLang, folder, file);
      return;
    }

    await this.playStreamingOrFallback(chunks, base, lang, folder, file, autoLang);
  }

  /** Stop playback and abort any in-flight request. */
  async stopPlayback(quiet: boolean = false): Promise<void> {
    this.stopRequested = true;
    if (!quiet) { try { new Notice("Stopping playback..."); } catch {} }
    try { this.currentSession?.abort?.abort(); } catch {}
    try { this.currentSession = await cleanupSessionResourcesHelper(this.currentSession, true); } catch {}
  }

  /** Toggle play/pause or start reading if nothing is playing. */
  playOrStart(): void {
    const a = this.currentSession?.audioEl;
    const file = this.app.workspace.getActiveFile();
    const currentBase = file ? toSafeBase(file.basename) : undefined;
    const sameFile = currentBase && this.currentSession?.fileBase === currentBase;

    if (a && sameFile) {
      const duration = Number.isFinite(a.duration) ? a.duration : 0;
      const atEnd = a.ended || (duration > 0 && a.currentTime >= duration - 0.05);
      const active = !atEnd;
      if (active) {
        if (a.paused) {
          a.play().then(() => { try { notifyUtil(this.settings, "Resumed playback", true); } catch {} }).catch(() => {});
        } else {
          a.pause();
          try { notifyUtil(this.settings, "Paused playback", true); } catch {}
        }
        return;
      }
      // Stale ended session: clear and start fresh
      this.currentSession = null;
    }

    try { notifyUtil(this.settings, "Starting playback..."); } catch {}
    void this.readCurrentNote();
  }

  /** Set playback rate on current audio element. */
  setPlaybackRate(rate: number): void { const a = this.currentSession?.audioEl; if (a) a.playbackRate = rate; }


  

  
  

  /**
   * Attempt streaming playback; fallback to buffered prefetch if streaming is unsupported or fails.
   *
   * @param {string[]} chunks Text chunks.
   * @param {string} base Safe base name.
   * @param {string} lang BCP-47 language.
   * @param {string} folder Target folder.
   * @param {TFile} file Current note file.
   * @param {string} autoLang Auto-detected lang (for fallback path signature compatibility).
   * @returns {Promise<void>} Completion promise.
   */
  private async playStreamingOrFallback(
    chunks: string[],
    base: string,
    lang: string,
    folder: string,
    file: TFile,
    autoLang: string
  ): Promise<void> {
    let part = 1;
    for (const chunk of chunks) {
      if (this.stopRequested) break;
      try {
        log("tts start part", { part });
        const ssml = buildSsml({ text: chunk, voiceName: this.settings.voiceName, rate: this.settings.rate, lang });
        const abort = new AbortController();
        this.currentSession = { abort, audioEl: null, mediaSource: null, sourceBuffer: null, lastBlob: null, fileBase: base };

        const streamFormat = this.settings.outputFormat;
        const { supported: streamSupported, mime: streamMime } = canStream(streamFormat);

        if (!(this.settings.enableStreaming && streamSupported)) {
notifyUtil(this.settings, "Streaming not available (using buffered prefetch)");
          await this.playBufferedPrefetch(chunks, part - 1, base, autoLang, folder, file);
          return;
        }

        try {
          await playStreamedPartAndSave({
            app: this.app,
            settings: this.settings,
            ssml,
            base,
            part,
            folder,
            file,
            abort,
            setSession: (s) => { this.currentSession = s; }
          });
          this.currentSession = await cleanupSessionResourcesHelper(this.currentSession);
          this.currentSession = null;

          part += 1;
        } catch (err) {
          const detail = (err && (err as any).message) ? (err as any).message : String(err);
          warn("Streaming failed; falling back to buffered", { detail, part });
          this.currentSession = await cleanupSessionResourcesHelper(this.currentSession, true);
          await this.playBufferedPrefetch(chunks, part - 1, base, autoLang, folder, file);
          return;
        }
      } catch (e: unknown) {
        const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
notifyUtil(this.settings, `TTS failed on part ${part}: ${msg}` , true);
        break;
      }
    }
    log("streaming-or-fallback finished", { requestedParts: chunks.length, stopped: this.stopRequested });
  }

  /**
   * Attempt to play existing local audio parts without regeneration.
   *
   * @param {string} base Safe base name.
   * @param {string} folder Audio folder.
   * @param {number} expectedParts Expected number of parts for UX messaging only.
   * @param {boolean} forceRegenerate Whether regeneration is requested.
   * @returns {Promise<boolean>} True if existing parts were played or attempted; false if generation should proceed.
   */
  private async tryPlayExistingParts(base: string, folder: string, expectedParts: number, forceRegenerate: boolean): Promise<boolean> {
    if (forceRegenerate) return false;
    return tryPlayExistingPartsHelper({
      app: this.app,
      settings: this.settings,
      base,
      folder,
      stopRequested: () => this.stopRequested,
      setSession: (s) => { this.currentSession = s; }
    });
  }

  /**
   * Buffered prefetch playback with a fixed concurrency window.
   * Ensures all in-flight requests are aborted when stopping or exiting.
   *
   * @param {string[]} chunks Text chunks to synthesize.
   * @param {number} startIndex Index to start playback from.
   * @param {string} base Safe base name for file outputs.
   * @param {string} autoLang Auto-detected language for the note.
   * @param {string} folder Target folder for audio files.
   * @param {TFile} file Current note file.
   * @returns {Promise<void>} Completes after playback or stop.
   */
  private async playBufferedPrefetch(
    chunks: string[],
    startIndex: number,
    base: string,
    autoLang: string,
    folder: string,
    file: TFile
  ): Promise<void> {
    const configuredLang = this.settings.language === "auto" ? autoLang : this.settings.language;
    const voiceLang = deriveLangFromVoiceName(this.settings.voiceName) || configuredLang;
    const lang = voiceLang;
    await playBufferedPrefetchHelper({
      app: this.app,
      settings: this.settings,
      chunks,
      startIndex,
      base,
      lang,
      folder,
      file,
      stopRequested: () => this.stopRequested,
      setSession: (s) => { this.currentSession = s; },
      writeBinary: writeBinary as any,
      upsertAudioReferenceSorted: upsertAudioReferenceSorted as any
    });
  }

  /** Load settings from storage with defaults. */
  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data || {});
  }

  /** Persist settings. */
  async saveSettings(): Promise<void> { await this.saveData(this.settings); }

  /** Generate and save audio for the current note without playback. Respects settings.chunkSize */
  async downloadCurrentNote(): Promise<void> {
    await this.stopPlayback(true);
    this.stopRequested = false;
    const file = this.app.workspace.getActiveFile();
if (!file) { notifyUtil(this.settings, "No active note", true); return; }
    const missing = missingSettings(this.settings);
if (missing.length) { notifyUtil(this.settings, `Missing settings: ${missing.join(", ")}`, true); return; }

    const content = await this.app.vault.read(file);
if (!content.trim()) { notifyUtil(this.settings, "Note is empty", true); return; }

    const chunks = buildChunks(content, this.settings, Platform.isIosApp === true);
    const totalParts = chunks.length;
    const base = toSafeBase(file.basename);
    const lang = resolveLang(content, this.settings);
    const folder = this.settings.audioFolder || "Audio";
    try {
      await ensureFolder(this.app, folder);
    } catch (e) {
      new Notice(`Failed to ensure folder "${folder}": ${((e as any)?.message) || String(e)}`);
      return;
    }
notifyUtil(this.settings, `Starting download (${totalParts} part(s))...`, true);

    /** Ask to overwrite: if files exist and user wants fresh, reuse deleteExistingParts behavior */
const ext = fileExtFromFormat(this.settings.outputFormat);
    await deleteExistingParts(this.app, folder, base, ext).catch((e: unknown) => {
notifyUtil(this.settings, `Could not remove old parts (continuing): ${((e as any)?.message) || String(e)}`, true);
    });

    let part = 1;
    for (const chunk of chunks) {
      if (this.stopRequested) break;
      try {
        const ssml = buildSsml({ text: chunk, voiceName: this.settings.voiceName, rate: this.settings.rate, lang });
        const abort = new AbortController();
        this.currentSession = { abort, audioEl: null, mediaSource: null, sourceBuffer: null, lastBlob: null, fileBase: base };
        const { buffer } = await fetchTtsAudio(
          this.settings.azureApiKey,
          this.settings.azureRegion,
          this.settings.outputFormat,
          ssml,
          abort.signal
        );
        if (!buffer || buffer.byteLength === 0) { throw new Error("Empty audio buffer"); }
        const audioPath = `${folder}/${base}_part_${part}.${ext}`;
        await writeBinary(this.app, audioPath, buffer);
        await upsertAudioReferenceSorted(this.app, file, audioPath);
log("downloaded part", { part, total: totalParts });
      } catch (e: unknown) {
        const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
notifyUtil(this.settings, `Download failed on part ${part}: ${msg}`, true);
        break;
      }
      part += 1;
    }
    this.currentSession = await cleanupSessionResourcesHelper(this.currentSession, true);
    this.currentSession = null;
    if (this.stopRequested) {
notifyUtil(this.settings, `Download stopped after ${part - 1} of ${totalParts} part(s)`, true);
    } else {
notifyUtil(this.settings, `Download complete: ${part - 1} of ${totalParts} part(s)`, true);
    }
  }
}


