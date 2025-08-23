import { Plugin, Notice, Platform, TFile } from "obsidian";
import { splitTextSmart } from "./utils/chunk";
import { toSafeBase } from "./utils/safe-name";
import { buildSsml, deriveLangFromVoiceName } from "./utils/ssml";
import { detectLanguage } from "./utils/lang";
import { ensureFolder, writeBinary, appendAudioReference, deleteExistingParts, upsertAudioReferenceSorted } from "./utils/fs";
import { mimeFromFormat, startHttpStream, captureToBlob, fetchTtsAudio } from "./tts/azure";
import { log, warn, setDebugLogging } from "./utils/logger";
import { ListenModeSettingsTab } from "./obsidian/settings";
import type { PlaybackSession, TtsSettings } from "./types";

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

    // Ribbon: Play/Pause current note
    this.addRibbonIcon('headphones', 'Play/Pause current note', () => { this.playOrStart(); });

    this.addSettingTab(new ListenModeSettingsTab(this.app, this));
  }

  /**
   * Destroy UI and stop playback.
   */
  async onunload(): Promise<void> {
    await this.stopPlayback();
  }
  /** Panel removed. */
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  destroyPanel(): void {}

  /**
   * Read the active note, stream playback, and save audio files.
   */
async readCurrentNote(forceRegenerate: boolean = false): Promise<void> {
    await this.stopPlayback();
    this.stopRequested = false;
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice("No active note"); return; }
    const missing: string[] = [];
    if (!this.settings.azureApiKey?.trim()) missing.push("Azure API Key");
    if (!this.settings.azureRegion?.trim()) missing.push("Azure Region");
    if (!this.settings.voiceName?.trim()) missing.push("Voice name");
    if (!this.settings.outputFormat?.trim()) missing.push("Output format");
    if (missing.length) { new Notice(`Missing settings: ${missing.join(", ")}`); return; }

    const content = await this.app.vault.read(file);
    if (!content.trim()) { new Notice("Note is empty"); return; }

    // On iOS enforce smaller chunk size for reliable buffered playback
    const isIos = Platform.isIosApp === true;
    const maxChars = isIos ? 500 : Math.max(500, Math.min(9000, Number(this.settings.chunkSize) || 5000));
    const chunks = splitTextSmart(content, maxChars);
    log("chunking result", { count: chunks.length });
    const base = toSafeBase(file.basename);
    const autoLang = detectLanguage(content);
    const folder = this.settings.audioFolder || "Audio";
    await ensureFolder(this.app, folder);

    // Try to play existing local audio for parts 1..N if available (sequential, no regeneration)
    try {
      const extExisting = /wav/i.test(this.settings.outputFormat) ? "wav" : "mp3";
      const existingPaths: string[] = [];
      for (let i = 1; i < 10000; i++) {
        const p = `${folder}/${base}_part_${i}.${extExisting}`;
        // eslint-disable-next-line no-await-in-loop
        const ok = await this.app.vault.adapter.exists(p);
        if (!ok) break;
        existingPaths.push(p);
      }
      if (existingPaths.length && !forceRegenerate) {
        for (const p of existingPaths) {
          if (this.stopRequested) break;
          const data = await this.app.vault.adapter.readBinary(p);
          const mime = mimeFromFormat(this.settings.outputFormat);
          const blob = new Blob([data], { type: mime });
          const url = URL.createObjectURL(blob);
          const audioEl = new Audio(url);
          audioEl.playbackRate = this.getPlaybackRateFromRateSetting(this.settings.rate);
          const abort = new AbortController();
          this.currentSession = { abort, audioEl, mediaSource: null, sourceBuffer: null, lastBlob: blob, fileBase: base, objectUrl: url };
          try { await audioEl.play(); } catch {}
          // eslint-disable-next-line no-await-in-loop
          await this.waitForEndOrAbort(audioEl, abort.signal);
          // eslint-disable-next-line no-await-in-loop
          await this.cleanupSessionResources();
        }
        return;
      }
    } catch {}

    // If forcing regeneration, remove old parts first so new files take effect
    if (forceRegenerate) {
      const ext = /wav/i.test(this.settings.outputFormat) ? "wav" : "mp3";
      await deleteExistingParts(this.app, folder, base, ext).catch(() => {});
    }

    // iOS: force Buffered Prefetch mode with window size 3
    if (isIos) {
      await this.playBufferedPrefetch(chunks, 0, base, autoLang, folder, file);
      return;
    }

    let part = 1;
    for (const chunk of chunks) {
      if (this.stopRequested) break;
      try {
        new Notice(`TTS start part ${part}...`);
        const configuredLang = this.settings.language === "auto" ? autoLang : this.settings.language;
        const voiceLang = deriveLangFromVoiceName(this.settings.voiceName) || configuredLang;
        const lang = voiceLang;
        const ssml = buildSsml({ text: chunk, voiceName: this.settings.voiceName, rate: this.settings.rate, lang });
        const abort = new AbortController();
        this.currentSession = { abort, audioEl: null, mediaSource: null, sourceBuffer: null, lastBlob: null, fileBase: base };

        // Decide streaming format for MSE: try native MIME from settings (mp3/wav)
        const streamFormat = this.settings.outputFormat;
        const streamMime = mimeFromFormat(streamFormat);
        const canStream = typeof MediaSource !== "undefined"
          && (MediaSource as any).isTypeSupported
          && MediaSource.isTypeSupported(streamMime);
        log("streaming candidate", { streamFormat, streamMime, canStream, enableStreaming: this.settings.enableStreaming });

        let playbackWait: Promise<void> | null = null;
        if (this.settings.enableStreaming && canStream) {
          try {
            log("startHttpStream", { region: this.settings.azureRegion, streamFormat });
            // Streaming path with immediate playback using MediaSource (same format as output)
            const stream = await startHttpStream(
              this.settings.azureApiKey,
              this.settings.azureRegion,
              streamFormat,
              ssml,
              abort.signal
            );
            log("stream opened");

            const mediaSource = new MediaSource();
            const objectUrl = URL.createObjectURL(mediaSource);
            const audioEl = new Audio(objectUrl);
            audioEl.playbackRate = this.getPlaybackRateFromRateSetting(this.settings.rate);
            audioEl.play().catch(() => {});

            await new Promise<void>((res) => mediaSource.addEventListener("sourceopen", () => res(), { once: true }));
            log("mediaSource opened, adding SourceBuffer", streamMime);
            const sourceBuffer = mediaSource.addSourceBuffer(streamMime);

            // Queue-based append to avoid InvalidStateError
            const queue: Uint8Array[] = [];
            let draining = false;
            const drain = () => {
              if (draining || sourceBuffer.updating) return;
              const next = queue.shift();
              if (!next) return;
              try {
                const copy = new Uint8Array(next.byteLength);
                copy.set(next);
                sourceBuffer.appendBuffer(copy.buffer);
                draining = true;
              } catch {
                draining = false;
              }
            };
            sourceBuffer.addEventListener('updateend', () => { draining = false; drain(); });

            const onChunk = (u8: Uint8Array) => { queue.push(u8); drain(); };
            log("streaming started, appending chunks...");

            // Track session
            if (this.currentSession) {
              this.currentSession.audioEl = audioEl;
              this.currentSession.mediaSource = mediaSource;
              this.currentSession.sourceBuffer = sourceBuffer;
              this.currentSession.objectUrl = objectUrl;
            }
            // optional listeners for state

            // Assemble final Blob while streaming to player
            const blob = await captureToBlob(stream, onChunk, streamFormat);
            log("streaming finished, total blob bytes", blob.size);
            if (this.currentSession) this.currentSession.lastBlob = blob;
            if (mediaSource.readyState === "open") { try { mediaSource.endOfStream(); } catch {} }

            // Wait for playback to finish or be aborted before continuing to next part
            playbackWait = this.waitForEndOrAbort(audioEl, abort.signal);

            // Persist to vault and append link (use original target extension)
            const arrayBuf = await blob.arrayBuffer();
            const ext = /wav/i.test(this.settings.outputFormat) ? 'wav' : 'mp3';
            const audioPath = `${folder}/${base}_part_${part}.${ext}`;
            await writeBinary(this.app, audioPath, arrayBuf);
            new Notice(`Saved ${audioPath}`);
            await upsertAudioReferenceSorted(this.app, file, audioPath);
          } catch (err) {
            const detail = (err && (err as any).message) ? (err as any).message : String(err);
            warn("streaming failed, falling back to buffered", { detail, streamFormat, streamMime });
            new Notice(`Streaming failed (fallback to buffered): ${detail}`);
            // Switch to buffered prefetch for the rest (including current part)
            await this.playBufferedPrefetch(chunks, part - 1, base, autoLang, folder, file);
            return;
          }
        } else {
          // Non-streaming environment: use buffered prefetch mode for all parts
          new Notice("Streaming not available (using buffered prefetch)");
          await this.playBufferedPrefetch(chunks, part - 1, base, autoLang, folder, file);
          return;
        }
        // After starting playback (any path), save file and append link already handled.
        // Now wait for playback end/abort before proceeding to next chunk.
        if (playbackWait) {
          try { await playbackWait; } catch {}
        }
        // Cleanup resources for the finished part
        await this.cleanupSessionResources();
        this.currentSession = null;
        if (this.stopRequested || abort.signal.aborted) { break; }
      } catch (e: unknown) {
        const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
        new Notice(`TTS failed on part ${part}: ${msg}`);
      }
      part += 1;
    }
    log("generation finished", { requestedParts: chunks.length, processedUntil: part - 1, stopped: this.stopRequested });
  }

  /** Stop playback and abort any in-flight request. */
  async stopPlayback(): Promise<void> {
    this.stopRequested = true;
    try { this.currentSession?.abort?.abort(); } catch {}
    try { await this.cleanupSessionResources(true); } catch {}
  }

  /** Toggle play/pause or start reading if nothing is playing. */
  playOrStart(): void {
    const a = this.currentSession?.audioEl;
    const file = this.app.workspace.getActiveFile();
    const currentBase = file ? toSafeBase(file.basename) : undefined;
    const sameFile = currentBase && this.currentSession?.fileBase === currentBase;
    if (a && sameFile && !a.ended) {
      if (a.paused) { a.play().catch(() => {}); } else { a.pause(); }
      return;
    }
    void this.readCurrentNote();
  }

  /** Set playback rate on current audio element. */
  setPlaybackRate(rate: number): void { const a = this.currentSession?.audioEl; if (a) a.playbackRate = rate; }

  /** Map SSML rate like +10% to playback rate. */
  getPlaybackRateFromRateSetting(rateStr: string): number {
    const m = /([+-]?\d+)%/.exec(rateStr || "+0%");
    const pct = m ? parseInt(m[1], 10) : 0;
    return Math.max(0.5, Math.min(2.0, 1 + pct / 100));
  }

  /** Waits until the audio ends or the abort signal fires. */
  private waitForEndOrAbort(audioEl: HTMLAudioElement, abortSignal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      const onEnded = () => {
        cleanup();
        resolve();
      };
      const onAbort = () => {
        try { audioEl.pause(); } catch {}
        cleanup();
        resolve();
      };
      const cleanup = () => {
        audioEl.removeEventListener("ended", onEnded);
        abortSignal.removeEventListener("abort", onAbort as any);
      };
      audioEl.addEventListener("ended", onEnded, { once: true });
      abortSignal.addEventListener("abort", onAbort as any, { once: true });
    });
  }

  /** Clean up current session resources: pause, end MSE, revoke object URLs. */
  private async cleanupSessionResources(setNull: boolean = false): Promise<void> {
    const session = this.currentSession;
    if (!session) return;
    try { session.audioEl?.pause(); } catch {}
    try {
      if (session.mediaSource && session.mediaSource.readyState === "open") {
        session.mediaSource.endOfStream();
      }
    } catch {}
    try {
      if (session.objectUrl) {
        URL.revokeObjectURL(session.objectUrl);
      }
    } catch {}
    if (setNull) this.currentSession = null;
  }

  /** Buffered prefetch playback used on iOS and as desktop fallback */
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
    const abortAll = new AbortController();
    const prefetchWindow = 3;
    const ext = /wav/i.test(this.settings.outputFormat) ? "wav" : "mp3";

    const makeTask = (idx: number) => {
      const ssml = buildSsml({ text: chunks[idx], voiceName: this.settings.voiceName, rate: this.settings.rate, lang });
      return fetchTtsAudio(
        this.settings.azureApiKey,
        this.settings.azureRegion,
        this.settings.outputFormat,
        ssml,
        abortAll.signal
      ).then(({ buffer, mime }) => ({ buffer, mime, idx }));
    };

    const tasks: Array<Promise<{ buffer: ArrayBuffer; mime: string; idx: number }>> = new Array(chunks.length);
    let started = startIndex;
    while (started < Math.min(startIndex + prefetchWindow, chunks.length)) { tasks[started] = makeTask(started); started += 1; }

    let partIdx = startIndex;
    while (partIdx < chunks.length) {
      if (this.stopRequested) break;
      try {
        new Notice(`TTS start part ${partIdx + 1}...`);
        while (started < chunks.length && started - partIdx < prefetchWindow) { tasks[started] = makeTask(started); started += 1; }
        const { buffer, mime } = await tasks[partIdx];
        if (!buffer || (buffer as ArrayBuffer).byteLength === 0) { throw new Error("Empty audio buffer"); }
        const blob = new Blob([buffer], { type: mime });
        const url = URL.createObjectURL(blob);
        const audioEl = new Audio(url);
        audioEl.playbackRate = this.getPlaybackRateFromRateSetting(this.settings.rate);
        this.currentSession = { abort: abortAll, audioEl, mediaSource: null, sourceBuffer: null, lastBlob: blob, fileBase: base, objectUrl: url };
        try { await audioEl.play(); } catch {}

        const audioPath = `${folder}/${base}_part_${partIdx + 1}.${ext}`;
        await writeBinary(this.app, audioPath, buffer);
        new Notice(`Saved ${audioPath}`);
        await upsertAudioReferenceSorted(this.app, file, audioPath);

        while (started < chunks.length && started - partIdx < prefetchWindow) { tasks[started] = makeTask(started); started += 1; }

        try { await this.waitForEndOrAbort(audioEl, abortAll.signal); } catch {}
        await this.cleanupSessionResources();
        this.currentSession = null;
        if (this.stopRequested || abortAll.signal.aborted) break;
      } catch (e: unknown) {
        const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
        new Notice(`TTS failed on part ${partIdx + 1}: ${msg}`);
        break;
      }
      partIdx += 1;
    }
    log("buffered prefetch finished", { startIndex, requestedParts: chunks.length, processedUntil: partIdx });
  }


  /** Load settings from storage with defaults. */
  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = Object.assign({
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
      chunkSize: 5000
    }, data || {});
  }

  /** Persist settings. */
  async saveSettings(): Promise<void> { await this.saveData(this.settings); }
}

// Helper: buffered prefetch mode used on iOS and as desktop fallback
// Maintains a prefetch window of 3 parallel downloads and plays sequentially
// starting from startIndex.
export interface _Tmp_ {}

