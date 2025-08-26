import { Plugin, Platform, TFile } from "obsidian";
import { toSafeBase } from "./utils/safe-name";
import { buildSsml } from "./utils/ssml";
import { ensureFolder, writeBinary, deleteExistingParts, upsertAudioReferenceSorted, replaceAudioReferencesWithSingle } from "./utils/fs";
import { AzureTtsProvider } from "./tts/azure-provider";
import { BackendTtsProvider } from "./tts/backend-provider";
import { log, warn, setDebugLogging } from "./utils/logger";
import { ListenModeSettingsTab } from "./obsidian/settings";
import { fileExtFromFormat, missingSettings, resolveLang, buildChunks } from "./core/helpers";
import type { PlaybackSession, TtsProvider, TtsSettings } from "./types";
import { canStream, captureToBlob } from "./core/audio";
import { cleanupSessionResources as cleanupSessionResourcesHelper } from "./playback/session";
import { tryPlayExistingParts as tryPlayExistingPartsHelper } from "./playback/existing";
import { playBufferedPrefetch as playBufferedPrefetchHelper } from "./playback/buffered";
import { DEFAULT_SETTINGS } from "./core/settings";
import { playStreamedPartAndSave } from "./playback/streaming";
import { notify as notifyUtil } from "./core/notify";
import { Mp3Assembler } from "./utils/mp3";


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
  /** Guard to prevent concurrent read/download operations. */
  private isBusy: boolean = false;
  /** Active TTS provider. */
  private provider: TtsProvider | null = null;

  /**
   * Load settings and register commands.
   */
  async onload(): Promise<void> {
    await this.loadSettings();
    setDebugLogging(!!this.settings.debugLogs);
    if (!this.settings.clientId || this.settings.clientId.trim().length < 8) {
      try {
        const uuid = (crypto && 'randomUUID' in crypto) ? (crypto as any).randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        this.settings.clientId = uuid;
        await this.saveSettings();
      } catch {}
    }
    this.provider = this.buildProviderFromSettings();
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
    if (this.isBusy) { try { notifyUtil(this.settings, "Already processing a request", true); } catch {} return; }
    this.isBusy = true;
    try {
      const ctx = await this.prepareNoteContext();
      if (!ctx) return;

      notifyUtil(this.settings, `Starting playback and generation (${ctx.chunks.length} part(s))...`, true);
      log("chunking result", { count: ctx.chunks.length });

      if (await this.tryPlayExistingParts(ctx.base, ctx.folder, ctx.chunks.length, forceRegenerate)) {
        return;
      }

      const isIos = Platform.isIosApp;
      if (isIos) {
        notifyUtil(this.settings, "Using buffered prefetch mode (iOS)");
        const mergingEnabled = !!this.settings.mergeParts && /mp3/i.test(this.settings.outputFormat);
        const assembler = mergingEnabled ? new Mp3Assembler() : null;
        await this.playBufferedPrefetch(
          ctx.chunks,
          0,
          ctx.base,
          ctx.lang,
          ctx.folder,
          ctx.file,
          this.buildProviderFromSettings(),
          assembler ? (u8) => assembler.append(u8) : undefined,
          assembler ? false : true
        );
        if (assembler && !this.stopRequested) {
          try {
            const merged = assembler.build();
            if (merged && merged.byteLength > 0) {
              const audioPath = `${ctx.folder}/${ctx.base}.mp3`;
              const ab = new ArrayBuffer(merged.byteLength);
              new Uint8Array(ab).set(merged);
              await writeBinary(this.app, audioPath, ab);
              await replaceAudioReferencesWithSingle(this.app, ctx.file, audioPath);
              notifyUtil(this.settings, `Zapisano scalony plik: [[${audioPath}]]`);
            } else {
              notifyUtil(this.settings, `Pominięto zapis scalonego pliku (brak danych)`, true);
            }
          } catch (e: unknown) {
            const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
            notifyUtil(this.settings, `Nie udało się zapisać pliku scalonego: ${msg}`, true);
          }
        }
        return;
      }

      await this.playStreamingOrFallback(ctx.chunks, ctx.base, ctx.lang, ctx.folder, ctx.file);
    } finally {
      this.isBusy = false;
    }
  }

  /** Stop playback and abort any in-flight request. */
  async stopPlayback(quiet: boolean = false): Promise<void> {
    this.stopRequested = true;
    if (!quiet) { try { notifyUtil(this.settings, "Stopping playback...", true); } catch {} }
    try { this.currentSession?.abort?.abort(); } catch {}
    try { this.currentSession = await cleanupSessionResourcesHelper(this.currentSession, true); } catch {}
  }

  /** Toggle play/pause or start reading if nothing is playing. */
  playOrStart(): void {
    const audioEl = this.currentSession?.audioEl;
    const file = this.app.workspace.getActiveFile();
    const currentBase = file ? toSafeBase(file.basename) : undefined;
    const sameFile = currentBase && this.currentSession?.fileBase === currentBase;

    if (audioEl && sameFile) {
      const duration = Number.isFinite(audioEl.duration) ? audioEl.duration : 0;
      const atEnd = audioEl.ended || (duration > 0 && audioEl.currentTime >= duration - 0.05);
      const active = !atEnd;
      if (active) {
        if (audioEl.paused) {
          audioEl.play().then(() => { try { notifyUtil(this.settings, "Resumed playback", true); } catch {} }).catch(() => {});
        } else {
          audioEl.pause();
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
    file: TFile
  ): Promise<void> {
    let part = 1;
    const mergingEnabled = !!this.settings.mergeParts && /mp3/i.test(this.settings.outputFormat);
    const assembler = mergingEnabled ? new Mp3Assembler() : null;
    const provider = this.buildProviderFromSettings();
    this.provider = provider;
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
          await this.playBufferedPrefetch(chunks, part - 1, base, lang, folder, file, provider, assembler ? (u8) => assembler.append(u8) : undefined, assembler ? false : true);
          if (assembler && !this.stopRequested) {
            try {
              const merged = assembler.build();
              if (merged && merged.byteLength > 0) {
                const audioPath = `${folder}/${base}.mp3`;
                const ab = new ArrayBuffer(merged.byteLength);
                new Uint8Array(ab).set(merged);
                await writeBinary(this.app, audioPath, ab);
                await replaceAudioReferencesWithSingle(this.app, file, audioPath);
                notifyUtil(this.settings, `Zapisano scalony plik: [[${audioPath}]]`);
              } else {
                notifyUtil(this.settings, `Pominięto zapis scalonego pliku (brak danych)`, true);
              }
            } catch (e: unknown) {
              const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
              notifyUtil(this.settings, `Nie udało się zapisać pliku scalonego: ${msg}`, true);
            }
          }
          return;
        }

        try {
          await playStreamedPartAndSave({
            app: this.app,
            settings: this.settings,
            provider,
            ssml,
            lang,
            base,
            part,
            folder,
            file,
            abort,
            setSession: (s) => { this.currentSession = s; },
            appendToMerged: assembler ? (u8) => assembler.append(u8) : undefined,
            savePerPart: assembler ? false : true,
            onCaptured: async (blob) => {
              // If merging is enabled and this is the last part, write merged file immediately.
              if (assembler && part === chunks.length) {
                try {
                  const merged = assembler.build();
                  if (merged && merged.byteLength > 0) {
                    const audioPath = `${folder}/${base}.mp3`;
                    const ab = new ArrayBuffer(merged.byteLength);
                    new Uint8Array(ab).set(merged);
                    await writeBinary(this.app, audioPath, ab);
                    await replaceAudioReferencesWithSingle(this.app, file, audioPath);
                    notifyUtil(this.settings, `Zapisano scalony plik: [[${audioPath}]]`);
                  }
                } catch (e: unknown) {
                  const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
                  notifyUtil(this.settings, `Nie udało się zapisać pliku scalonego: ${msg}`, true);
                }
              }
            }
          });
          this.currentSession = await cleanupSessionResourcesHelper(this.currentSession);
          this.currentSession = null;

          part += 1;
        } catch (err) {
          const detail = (err && (err as any).message) ? (err as any).message : String(err);
          warn("Streaming failed; falling back to buffered", { detail, part });
          this.currentSession = await cleanupSessionResourcesHelper(this.currentSession, true);
          await this.playBufferedPrefetch(chunks, part - 1, base, lang, folder, file, provider, assembler ? (u8) => assembler.append(u8) : undefined, assembler ? false : true);
          if (assembler && !this.stopRequested) {
            try {
              const merged = assembler.build();
              if (merged && merged.byteLength > 0) {
                const audioPath = `${folder}/${base}.mp3`;
                const ab = new ArrayBuffer(merged.byteLength);
                new Uint8Array(ab).set(merged);
                await writeBinary(this.app, audioPath, ab);
                await replaceAudioReferencesWithSingle(this.app, file, audioPath);
                notifyUtil(this.settings, `Zapisano scalony plik: [[${audioPath}]]`);
              } else {
                notifyUtil(this.settings, `Pominięto zapis scalonego pliku (brak danych)`, true);
              }
            } catch (e: unknown) {
              const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
              notifyUtil(this.settings, `Nie udało się zapisać pliku scalonego: ${msg}`, true);
            }
          }
          return;
        }
      } catch (e: unknown) {
        const status = (e && typeof e === 'object' && 'status' in e) ? (e as any).status : undefined;
        const code = (e && typeof e === 'object' && 'code' in e) ? (e as any).code : undefined;
        if (status === 402 || code === 'PAYMENT_REQUIRED' || code === 'DEVICE_LIMIT_EXCEEDED') {
          try { notifyUtil(this.settings, `Wymagany upgrade planu (${code || status}). Otwórz stronę planów.`, true); } catch {}
          try { window.open('https://listenmode.app/upgrade', '_blank'); } catch {}
        } else {
          const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
          notifyUtil(this.settings, `TTS failed on part ${part}: ${msg}` , true);
        }
        break;
      }
    }
    log("streaming-or-fallback finished", { requestedParts: chunks.length, stopped: this.stopRequested });

    if (assembler && !this.stopRequested) {
      try {
        const merged = assembler.build();
        if (merged && merged.byteLength > 0) {
          const audioPath = `${folder}/${base}.mp3`;
          const ab = new ArrayBuffer(merged.byteLength);
          new Uint8Array(ab).set(merged);
          await writeBinary(this.app, audioPath, ab);
          await replaceAudioReferencesWithSingle(this.app, file, audioPath);
          notifyUtil(this.settings, `Zapisano scalony plik: [[${audioPath}]]`);
        } else {
          notifyUtil(this.settings, `Pominięto zapis scalonego pliku (brak danych)`, true);
        }
      } catch (e: unknown) {
        const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
        notifyUtil(this.settings, `Nie udało się zapisać pliku scalonego: ${msg}`, true);
      }
    }
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
    lang: string,
    folder: string,
    file: TFile,
    provider: TtsProvider,
    appendToMerged?: (u8: Uint8Array) => void,
    savePerPart: boolean = true
  ): Promise<void> {
    await playBufferedPrefetchHelper({
      app: this.app,
      settings: this.settings,
      provider,
      chunks,
      startIndex,
      base,
      lang,
      folder,
      file,
      stopRequested: () => this.stopRequested,
      setSession: (s) => { this.currentSession = s; },
      writeBinary: writeBinary,
      upsertAudioReferenceSorted: upsertAudioReferenceSorted,
      appendToMerged,
      savePerPart
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
    if (this.isBusy) { try { notifyUtil(this.settings, "Already processing a request", true); } catch {} return; }
    this.isBusy = true;
    try {
      const ctx = await this.prepareNoteContext();
      if (!ctx) return;

      const totalParts = ctx.chunks.length;
      notifyUtil(this.settings, `Starting download (no playback) — ${totalParts} parts...`, true);
      try { notifyUtil(this.settings, `Download started in background`, true); } catch {}

      /** Ask to overwrite: if files exist and user wants fresh, reuse deleteExistingParts behavior */
      const ext = fileExtFromFormat(this.settings.outputFormat);
      await deleteExistingParts(this.app, ctx.folder, ctx.base, ext).catch((e: unknown) => {
notifyUtil(this.settings, `Could not remove old parts (continuing): ${((e as any)?.message) || String(e)}`, true);
      });

      let part = 1;
      const mergingEnabled = !!this.settings.mergeParts && /mp3/i.test(this.settings.outputFormat);
      const assembler = mergingEnabled ? new Mp3Assembler() : null;
      for (const chunk of ctx.chunks) {
        if (this.stopRequested) break;
        try {
          const ssml = buildSsml({ text: chunk, voiceName: this.settings.voiceName, rate: this.settings.rate, lang: ctx.lang });
          const abort = new AbortController();
          this.currentSession = { abort, audioEl: null, mediaSource: null, sourceBuffer: null, lastBlob: null, fileBase: ctx.base };
          const provider = this.buildProviderFromSettings();
          this.provider = provider;
          const stream = await provider.synthesize(ssml, this.settings.outputFormat, ctx.lang, abort.signal);
          const blob = await captureToBlob(stream, undefined, this.settings.outputFormat);
          const buffer = await blob.arrayBuffer();
          if (!buffer || buffer.byteLength === 0) { throw new Error("Empty audio buffer"); }
          if (assembler) {
            assembler.append(new Uint8Array(buffer));
          } else {
            const audioPath = `${ctx.folder}/${ctx.base}_part_${part}.${ext}`;
            await writeBinary(this.app, audioPath, buffer);
            await upsertAudioReferenceSorted(this.app, ctx.file, audioPath);
          }
log("downloaded part", { part, total: totalParts });
        } catch (e: unknown) {
          const status = (e && typeof e === 'object' && 'status' in e) ? (e as any).status : undefined;
          const code = (e && typeof e === 'object' && 'code' in e) ? (e as any).code : undefined;
          if (status === 402 || code === 'PAYMENT_REQUIRED' || code === 'DEVICE_LIMIT_EXCEEDED') {
            try { notifyUtil(this.settings, `Wymagany upgrade planu (${code || status}). Otwórz stronę planów.`, true); } catch {}
            try { window.open('https://listenmode.app/upgrade', '_blank'); } catch {}
          } else {
            const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
            notifyUtil(this.settings, `Download failed on part ${part}: ${msg}`, true);
          }
          break;
        }
        part += 1;
      }
      this.currentSession = await cleanupSessionResourcesHelper(this.currentSession, true);
      this.currentSession = null;
      if (assembler && !this.stopRequested) {
        try {
          const merged = assembler.build();
          if (merged && merged.byteLength > 0) {
            const audioPath = `${ctx.folder}/${ctx.base}.mp3`;
            const ab = new ArrayBuffer(merged.byteLength);
            new Uint8Array(ab).set(merged);
            await writeBinary(this.app, audioPath, ab);
            await replaceAudioReferencesWithSingle(this.app, ctx.file, audioPath);
            notifyUtil(this.settings, `Zapisano scalony plik: [[${audioPath}]]`);
          } else {
            notifyUtil(this.settings, `Pominięto zapis scalonego pliku (brak danych)`, true);
          }
        } catch (e: unknown) {
          const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
          notifyUtil(this.settings, `Nie udało się zapisać pliku scalonego: ${msg}`, true);
        }
      }
      if (this.stopRequested) {
notifyUtil(this.settings, `Download stopped after ${part - 1} of ${totalParts} part(s)`, true);
      } else {
notifyUtil(this.settings, `Download complete: ${part - 1} of ${totalParts} part(s)`, true);
      }
    } finally {
      this.isBusy = false;
    }
  }

  /** Prepare note processing context: validates inputs, chunks, ensures folder and resolves language. */
  private async prepareNoteContext(): Promise<{ file: TFile; content: string; chunks: string[]; base: string; folder: string; lang: string; autoLang: string } | null> {
    const file = this.app.workspace.getActiveFile();
    if (!file) { notifyUtil(this.settings, "No active note", true); return null; }
    const missing = missingSettings(this.settings);
    if (missing.length) { notifyUtil(this.settings, `Missing settings: ${missing.join(", ")}`, true); return null; }
    const content = await this.app.vault.read(file);
    if (!content.trim()) { notifyUtil(this.settings, "Note is empty", true); return null; }
    const chunks = buildChunks(content, this.settings, Platform.isIosApp);
    const base = toSafeBase(file.basename);
    const folder = this.settings.audioFolder || "Audio";
    try {
      await ensureFolder(this.app, folder);
    } catch (e) {
notifyUtil(this.settings, `Failed to ensure folder "${folder}": ${((e as any)?.message) || String(e)}` , true);
      return null;
    }
    const lang = resolveLang(content, this.settings);
    const autoLang = lang; // retained for signature compatibility if ever needed
    return { file, content, chunks, base, folder, lang, autoLang };
  }

  private buildProviderFromSettings(): TtsProvider {
    if (this.settings.useBackend && this.settings.backendUrl) {
      return new BackendTtsProvider({ backendUrl: this.settings.backendUrl, licenseKey: this.settings.licenseKey || "", clientId: this.settings.clientId });
    }
    return new AzureTtsProvider({ apiKey: this.settings.azureApiKey, region: "westeurope" });
  }
}


