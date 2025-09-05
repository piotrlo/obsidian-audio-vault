import { Plugin, Platform, TFile } from "obsidian";
import { toSafeBase } from "./utils/safe-name";
import { buildSsml } from "./utils/ssml";
import { ensureFolder, writeBinary, deleteExistingParts, upsertAudioReferenceSorted, replaceAudioReferencesWithSingle } from "./utils/fs";
import { AzureTtsProvider } from "./tts/azure-provider";
import { BackendTtsProvider } from "./tts/backend-provider";
import { log, warn, setDebugLogging } from "./utils/logger";
import { AudioVaultSettingsTab } from "./obsidian/settings";
import { fileExtFromFormat, missingSettings, resolveLang, buildChunks } from "./core/helpers";
import type { PlaybackSession, TtsProvider, TtsSettings, PrefetchResult } from "./types";
import { canStream, captureToBlob } from "./core/audio";
import { cleanupSessionResources as cleanupSessionResourcesHelper } from "./playback/session";
import { tryPlayExistingParts as tryPlayExistingPartsHelper } from "./playback/existing";
import { playBufferedPrefetch as playBufferedPrefetchHelper } from "./playback/buffered";
import { DEFAULT_SETTINGS } from "./core/settings";
import { playStreamedPartAndSave } from "./playback/streaming";
import { notify as notifyUtil } from "./core/notify";
import { Mp3Assembler } from "./utils/mp3";
import { sanitizeNoteForTts } from "./utils/sanitize";
import { prefetchAllParts } from "./playback/prefetch";


/**
 * AudioVault Obsidian plugin entrypoint (MVP wiring).
 */
export default class AudioVaultPlugin extends Plugin {
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
  /** Status bar progress UI for background prefetch on iOS. */
  private progressItem: HTMLElement | null = null;
  private progressTextEl: HTMLElement | null = null;
  /** Floating overlay container element (center above bottom bar). */
  private progressOverlay: HTMLDivElement | null = null;
  /** Deferred cleanup of part files after playback finishes. */
  private pendingPartsCleanup: (() => Promise<void>) | null = null;
  /** Lifecycle orchestrator removed: simplified playback flow */

  /**
   * Load settings and register commands.
   */
  async onload(): Promise<void> {
    await this.loadSettings();
    setDebugLogging(!!this.settings.debugLogs);
    try {
      const persistentId = await this.getOrCreateVaultClientId();
      if (persistentId && persistentId !== this.settings.clientId) {
        this.settings.clientId = persistentId;
        await this.saveSettings();
      }
    } catch {}
    this.provider = this.buildProviderFromSettings();
    this.addCommand({ id: "audiovault-play-pause", name: "Play/Pause current note", callback: () => { this.playOrStart(); } });
    this.addCommand({ id: "audiovault-stop", name: "Stop", callback: () => { void this.stopPlayback(); } });
    this.addCommand({ id: "audiovault-restart", name: "Restart", callback: () => { void this.readCurrentNote(true); } });
    this.addCommand({ id: "audiovault-download", name: "Download audio (no playback)", callback: () => { void this.downloadCurrentNote(); } });

    /** Ribbon: Play/Pause current note */
    this.addRibbonIcon('headphones', 'Play/Pause current note', () => { this.playOrStart(); });

    this.addSettingTab(new AudioVaultSettingsTab(this.app, this));
    
    // No special iOS orchestrator. Playback policy handled in readCurrentNote.
  }

  /**
   * Destroy UI and stop playback.
   */
  async onunload(): Promise<void> {
    await this.stopPlayback(true);
    
    // No orchestrator to dispose
  }
  
  /**
   * Read or create a persistent client identifier stored at the vault root.
   * The identifier is stored in a hidden file named ".audiovault-id" to survive plugin reinstalls.
   */
  private async getOrCreateVaultClientId(): Promise<string> {
    const path = ".audiovault-id";
    try {
      const exists = await this.app.vault.adapter.exists(path);
      if (exists) {
        try {
          const raw = await this.app.vault.adapter.read(path);
          const id = (raw || "").toString().trim();
          if (id && id.length >= 8) return id;
        } catch {}
      }
      const gen = (crypto && 'randomUUID' in crypto)
        ? (crypto as any).randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      try { await this.app.vault.adapter.write(path, gen); } catch {}
      return gen;
    } catch {
      // As a last resort, fall back to settings or in-memory generation
      if (this.settings.clientId && this.settings.clientId.trim().length >= 8) return this.settings.clientId.trim();
      const gen = (crypto && 'randomUUID' in crypto)
        ? (crypto as any).randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      return gen;
    }
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
    this.hidePrefetchProgress();
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
    // Ensure no stale stop flag is carried into streaming loop
    this.stopRequested = false;
    for (const chunk of chunks) {
      if (this.stopRequested) { warn("Stop requested; exiting streaming loop", { part }); break; }
      try {
        log("tts start part", { part });
        const ssml = buildSsml({ text: chunk, voiceName: this.settings.voiceName, rate: this.settings.rate, lang });
        const abort = new AbortController();
        this.currentSession = { abort, audioEl: null, mediaSource: null, sourceBuffer: null, lastBlob: null, fileBase: base };

        const streamFormat = this.settings.outputFormat;
        const { supported: streamSupported, mime: streamMime } = canStream(streamFormat);

        const streamEnabled = (this.settings.enableStreaming && streamSupported && !Platform.isIosApp);
        // Prefer buffered prefetch pipeline whenever merging is enabled, to ensure file saving and early merge
        const preferBuffered = mergingEnabled;
        if (!streamEnabled || preferBuffered) {
notifyUtil(this.settings, "Streaming not available — starting playback immediately with background prefetch");
          // If merging is enabled for MP3, prefetch in background and save merged as soon as all parts are ready.
          if (mergingEnabled) {
            try {
              const orchestrator = await prefetchAllParts({
                app: this.app,
                settings: this.settings,
                provider,
                chunks,
                base,
                folder,
                file,
                lang,
                concurrency: 3,
              });

              // Fire-and-forget: when prefetch completes, build and save merged immediately
              void orchestrator.allDone.then(async () => {
                try {
                  const results = await Promise.all(orchestrator.tasks);
                  const assemblerAfter = new Mp3Assembler();
                  const ext = fileExtFromFormat(this.settings.outputFormat);
                  for (let i = 0; i < results.length; i++) {
                    const r = results[i];
                    if (r.buffer && r.buffer.byteLength > 0) {
                      assemblerAfter.append(new Uint8Array(r.buffer));
                    } else {
                      const partPath = `${folder}/${base}_part_${i + 1}.${ext}`;
                      try {
                        const data = await this.app.vault.adapter.readBinary(partPath);
                        assemblerAfter.append(new Uint8Array(data));
                      } catch {}
                    }
                  }
                  const merged = assemblerAfter.build();
                  if (merged && merged.byteLength > 0) {
                    const audioPath = `${folder}/${base}.mp3`;
                    const ab = new ArrayBuffer(merged.byteLength);
                    new Uint8Array(ab).set(merged);
                    await writeBinary(this.app, audioPath, ab);
                    await replaceAudioReferencesWithSingle(this.app, file, audioPath);
                    notifyUtil(this.settings, `Saved merged file: [[${audioPath}]]`);

                    // Defer deletion of part files until entire playback finishes
                    this.pendingPartsCleanup = async () => {
                      try {
                        const extNow = fileExtFromFormat(this.settings.outputFormat);
                        await deleteExistingParts(this.app, folder, base, extNow);
                        notifyUtil(this.settings, `Removed ${base}_part_* files`, true);
                      } catch (e: unknown) {
                        const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
                        notifyUtil(this.settings, `Failed to remove part files: ${msg}`, true);
                      }
                    };
                  }
                } catch (e: unknown) {
                  const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
                  notifyUtil(this.settings, `Background merge failed: ${msg}`, true);
                }
              });

              // Start playback immediately, consuming prefetch tasks when available; DO NOT save per-part files (merge enabled)
              await this.playBufferedPrefetch(
                chunks,
                part - 1,
                base,
                lang,
                folder,
                file,
                provider,
                undefined,
                false,
                orchestrator.tasks
              );
              // After playback completes, if we have pending cleanup, run it
              if (this.pendingPartsCleanup) {
                try { await this.pendingPartsCleanup(); } catch {}
                this.pendingPartsCleanup = null;
              }
              return;
            } catch (e: unknown) {
              const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
              notifyUtil(this.settings, `Prefetch setup failed: ${msg}`, true);
              // Fallback to legacy buffered playback
              await this.playBufferedPrefetch(chunks, part - 1, base, lang, folder, file, provider, undefined, true);
              return;
            }
          }
          // No merging: simple buffered prefetch playback
          await this.playBufferedPrefetch(chunks, part - 1, base, lang, folder, file, provider, undefined, true);
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
            // Save per-part during streaming as well, so behavior matches prefetch (links will be replaced on merge)
            savePerPart: true,
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
                    notifyUtil(this.settings, `Saved merged file: [[${audioPath}]]`);
                    // Defer deletion of part files until entire playback finishes (match prefetch behavior)
                    this.pendingPartsCleanup = async () => {
                      try {
                        const extNow = fileExtFromFormat(this.settings.outputFormat);
                        await deleteExistingParts(this.app, folder, base, extNow);
                        notifyUtil(this.settings, `Removed ${base}_part_* files`, true);
                      } catch (e: unknown) {
                        const m = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
                        notifyUtil(this.settings, `Failed to remove part files: ${m}`, true);
                      }
                    };
                  }
                } catch (e: unknown) {
                  const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
                  notifyUtil(this.settings, `Failed to save merged file: ${msg}`, true);
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
                notifyUtil(this.settings, `Saved merged file: [[${audioPath}]]`);
              } else {
                notifyUtil(this.settings, `Skipped saving merged file (no data)`, true);
              }
            } catch (e: unknown) {
              const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
              notifyUtil(this.settings, `Failed to save merged file: ${msg}`, true);
            }
          }
          return;
        }
      } catch (e: unknown) {
        const status = (e && typeof e === 'object' && 'status' in e) ? (e as any).status : undefined;
        const code = (e && typeof e === 'object' && 'code' in e) ? (e as any).code : undefined;
        if (status === 402 || code === 'PAYMENT_REQUIRED' || code === 'DEVICE_LIMIT_EXCEEDED') {
          try { notifyUtil(this.settings, `Plan upgrade required (${code || status}). Open plans page.`, true); } catch {}
          try { window.open('https://audio-vault.app/upgrade', '_blank'); } catch {}
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
          notifyUtil(this.settings, `Saved merged file: [[${audioPath}]]`);
          // Run pending cleanup if defined (deleting per-part files)
          if (this.pendingPartsCleanup) {
            try { await this.pendingPartsCleanup(); } catch {}
            this.pendingPartsCleanup = null;
          }
        } else {
          notifyUtil(this.settings, `Skipped saving merged file (no data)`, true);
        }
      } catch (e: unknown) {
        const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
        notifyUtil(this.settings, `Failed to save merged file: ${msg}`, true);
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
    savePerPart: boolean = true,
    prefetchTasks?: Array<Promise<PrefetchResult>>
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
      savePerPart,
      prefetchTasks
    });
  }

  /** Create a floating overlay progress above the bottom status bar. */
  private showPrefetchProgress(totalParts: number): void {
    if (this.progressOverlay) return;
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.left = "50%";
    overlay.style.bottom = "32px";
    overlay.style.transform = "translateX(-50%)";
    overlay.style.zIndex = "9999";
    overlay.style.background = "var(--background-secondary)";
    overlay.style.border = "1px solid var(--background-modifier-border)";
    overlay.style.borderRadius = "8px";
    overlay.style.padding = "8px 12px";
    overlay.style.boxShadow = "0 4px 16px rgba(0,0,0,0.25)";

    const text = document.createElement("span");
    text.textContent = `Downloading 0/${totalParts} (0%)`;
    overlay.appendChild(text);

    document.body.appendChild(overlay);
    this.progressOverlay = overlay;
    this.progressTextEl = text;
  }

  /** Update the floating overlay progress. */
  private updatePrefetchProgress(fetched: number, total: number): void {
    if (!this.progressOverlay || !this.progressTextEl || total <= 0) return;
    const pct = Math.round((fetched / total) * 100);
    this.progressTextEl.textContent = `Downloading ${fetched}/${total} (${pct}%)`;
  }

  /** Remove the floating overlay progress. */
  private hidePrefetchProgress(): void {
    try {
      if (this.progressOverlay && this.progressOverlay.parentElement) {
        this.progressOverlay.parentElement.removeChild(this.progressOverlay);
      }
    } catch {}
    this.progressOverlay = null;
    this.progressItem = null;
    this.progressTextEl = null;
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
            try { notifyUtil(this.settings, `Plan upgrade required (${code || status}). Open plans page.`, true); } catch {}
            try { window.open('https://audio-vault.app/upgrade', '_blank'); } catch {}
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
            notifyUtil(this.settings, `Saved merged file: [[${audioPath}]]`);
          } else {
            notifyUtil(this.settings, `Skipped saving merged file (no data)`, true);
          }
        } catch (e: unknown) {
          const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
          notifyUtil(this.settings, `Failed to save merged file: ${msg}`, true);
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
    const raw = await this.app.vault.read(file);
    const content = sanitizeNoteForTts(raw);
    if (!content.trim()) { notifyUtil(this.settings, "Note is empty", true); return null; }
    // Enforce iOS chunk size 500 and streaming off behavior via playback path (not settings mutation)
    const effectiveSettings = Platform.isIosApp ? { ...this.settings, chunkSize: 500 } : this.settings;
    const chunks = buildChunks(content, effectiveSettings, Platform.isIosApp);
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

  /**
   * Initialize lifecycle orchestrator for iOS background management.
   */
  // Lifecycle orchestrator removed
}


