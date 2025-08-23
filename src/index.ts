import { Plugin, Notice, Platform, TFile } from "obsidian";
import { toSafeBase } from "./utils/safe-name";
import { buildSsml, deriveLangFromVoiceName } from "./utils/ssml";
import { detectLanguage } from "./utils/lang";
import { ensureFolder, writeBinary, deleteExistingParts, upsertAudioReferenceSorted } from "./utils/fs";
import { mimeFromFormat, startHttpStream, captureToBlob, fetchTtsAudio } from "./tts/azure";
import { log, warn, setDebugLogging } from "./utils/logger";
import { ListenModeSettingsTab } from "./obsidian/settings";
import { fileExtFromFormat, missingSettings, resolveLang, buildChunks, playbackRateFromRateSetting } from "./core/helpers";
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
if (!file) { this.notify("No active note", true); return; }
    const missing = missingSettings(this.settings);
if (missing.length) { this.notify(`Missing settings: ${missing.join(", ")}`, true); return; }

    const content = await this.app.vault.read(file);
if (!content.trim()) { this.notify("Note is empty", true); return; }

const chunks = buildChunks(content, this.settings, Platform.isIosApp === true);
this.notify(`Starting playback and generation (${chunks.length} part(s))...`, true);
    log("chunking result", { count: chunks.length });

    const base = toSafeBase(file.basename);
    const autoLang = detectLanguage(content);
    const folder = this.settings.audioFolder || "Audio";
    try {
      await ensureFolder(this.app, folder);
    } catch (e) {
this.notify(`Failed to ensure folder "${folder}": ${((e as any)?.message) || String(e)}` , true);
      return;
    }

    if (await this.tryPlayExistingParts(base, folder, chunks.length, forceRegenerate)) {
      return;
    }

    const isIos = Platform.isIosApp === true;
    const lang = resolveLang(content, this.settings);

    if (isIos) {
this.notify("Using buffered prefetch mode (iOS)");
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
    try { await this.cleanupSessionResources(true); } catch {}
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
          a.play().then(() => { try { this.notify("Resumed playback", true); } catch {} }).catch(() => {});
        } else {
          a.pause();
          try { this.notify("Paused playback", true); } catch {}
        }
        return;
      }
      // Stale ended session: clear and start fresh
      this.currentSession = null;
    }

    try { this.notify("Starting playback..."); } catch {}
    void this.readCurrentNote();
  }

  /** Set playback rate on current audio element. */
  setPlaybackRate(rate: number): void { const a = this.currentSession?.audioEl; if (a) a.playbackRate = rate; }


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

  /**
   * Show a user Notice only if important, otherwise only when debug logs are enabled.
   *
   * @param {string} msg Message to display.
   * @param {boolean} important Show even when debugLogs is off.
   */
  private notify(msg: string, important: boolean = false): void {
    if (important || this.settings?.debugLogs) {
      try { new Notice(msg); } catch {}
    }
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
        const streamMime = mimeFromFormat(streamFormat);
        const canStream = typeof MediaSource !== "undefined"
          && (MediaSource as any).isTypeSupported
          && MediaSource.isTypeSupported(streamMime);

        if (!(this.settings.enableStreaming && canStream)) {
this.notify("Streaming not available (using buffered prefetch)");
          await this.playBufferedPrefetch(chunks, part - 1, base, autoLang, folder, file);
          return;
        }

        try {
          const stream = await startHttpStream(
            this.settings.azureApiKey,
            this.settings.azureRegion,
            streamFormat,
            ssml,
            abort.signal
          );

const mediaSource = new MediaSource();
          const objectUrl = URL.createObjectURL(mediaSource);
          const audioEl = new Audio(objectUrl);
          audioEl.playbackRate = playbackRateFromRateSetting(this.settings.rate);

          await new Promise<void>((res) => mediaSource.addEventListener("sourceopen", () => res(), { once: true }));
          const sourceBuffer = mediaSource.addSourceBuffer(streamMime);

          const queue: Uint8Array[] = [];
          let draining = false;
          let startedPlayback = false;
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
          sourceBuffer.addEventListener('updateend', () => {
            draining = false;
            if (!startedPlayback) {
              startedPlayback = true;
              audioEl.play().catch((err) => {
                const msg = err instanceof Error ? err.message : String(err);
                try { new Notice(`Audio play failed (stream): ${msg}`); } catch {}
              });
            }
            drain();
          });
          const onChunk = (u8: Uint8Array) => { queue.push(u8); drain(); };

          if (this.currentSession) {
            this.currentSession.audioEl = audioEl;
            this.currentSession.mediaSource = mediaSource;
            this.currentSession.sourceBuffer = sourceBuffer;
            this.currentSession.objectUrl = objectUrl;
          }

          const blob = await captureToBlob(stream, onChunk, streamFormat);
          if (this.currentSession) this.currentSession.lastBlob = blob;
          if (mediaSource.readyState === "open") { try { mediaSource.endOfStream(); } catch {} }

          const wait = this.waitForEndOrAbort(audioEl, abort.signal);

          const arrayBuf = await blob.arrayBuffer();
          const ext = fileExtFromFormat(this.settings.outputFormat);
          const audioPath = `${folder}/${base}_part_${part}.${ext}`;
          await writeBinary(this.app, audioPath, arrayBuf);
          await upsertAudioReferenceSorted(this.app, file, audioPath);

          await wait.catch(() => undefined);
          await this.cleanupSessionResources();
          this.currentSession = null;

          part += 1;
        } catch (err) {
          const detail = (err && (err as any).message) ? (err as any).message : String(err);
          warn("Streaming failed; falling back to buffered", { detail, part });
          await this.cleanupSessionResources(true);
          this.currentSession = null;
          await this.playBufferedPrefetch(chunks, part - 1, base, autoLang, folder, file);
          return;
        }
      } catch (e: unknown) {
        const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
this.notify(`TTS failed on part ${part}: ${msg}` , true);
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

    try {
      const extExisting = fileExtFromFormat(this.settings.outputFormat);
      const existingPaths: string[] = [];
      for (let i = 1; i < 10000; i++) {
        const p = `${folder}/${base}_part_${i}.${extExisting}`;
        // eslint-disable-next-line no-await-in-loop
        const ok = await this.app.vault.adapter.exists(p);
        if (!ok) break;
        existingPaths.push(p);
      }
      if (!existingPaths.length) return false;

      for (let i = 0; i < existingPaths.length; i++) {
        const p = existingPaths[i];
        if (this.stopRequested) break;
        log("playing existing part", { index: i + 1, total: existingPaths.length });
        const data = await this.app.vault.adapter.readBinary(p);
        const mime = mimeFromFormat(this.settings.outputFormat);
        const blob = new Blob([data], { type: mime });
        const url = URL.createObjectURL(blob);
        const audioEl = new Audio(url);
        audioEl.playbackRate = playbackRateFromRateSetting(this.settings.rate);
        const abort = new AbortController();
        this.currentSession = { abort, audioEl, mediaSource: null, sourceBuffer: null, lastBlob: blob, fileBase: base, objectUrl: url };
        try { await audioEl.play(); } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          try { new Notice(`Audio play failed (existing): ${msg}`); } catch {}
        }
        await this.waitForEndOrAbort(audioEl, abort.signal);
        await this.cleanupSessionResources();
      }
      if (!this.stopRequested) { new Notice("Finished playing existing audio."); }
      // Ensure stale session does not affect next Play
      this.currentSession = null;
      return true;
    } catch {
      return false;
    }
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

    const abortAll = new AbortController();
    // Expose the abort controller early so stopPlayback() can cancel prefetch tasks immediately.
    this.currentSession = { abort: abortAll, audioEl: null, mediaSource: null, sourceBuffer: null, lastBlob: null, fileBase: base };

    try {
      try { new Notice(`Starting buffered prefetch playback (${chunks.length} part(s))...`); } catch {}

      const prefetchWindow = 3;
      const ext = fileExtFromFormat(this.settings.outputFormat);

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
      while (partIdx < chunks.length && !this.stopRequested && !abortAll.signal.aborted) {
        while (started < chunks.length && started - partIdx < prefetchWindow) { tasks[started] = makeTask(started); started += 1; }

        const { buffer, mime } = await tasks[partIdx];
        if (!buffer || buffer.byteLength === 0) { throw new Error("Empty audio buffer"); }

        const blob = new Blob([buffer], { type: mime });
        const url = URL.createObjectURL(blob);
        const audioEl = new Audio(url);
        audioEl.playbackRate = playbackRateFromRateSetting(this.settings.rate);

        // Update session so pause/resume/stop operate on the new element.
        this.currentSession.audioEl = audioEl;
        this.currentSession.lastBlob = blob;
        (this.currentSession as any).objectUrl = url;

        try { await audioEl.play(); } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          try { new Notice(`Audio play failed (buffered): ${msg}`); } catch {}
        }

        const audioPath = `${folder}/${base}_part_${partIdx + 1}.${ext}`;
        await writeBinary(this.app, audioPath, buffer);
        await upsertAudioReferenceSorted(this.app, file, audioPath);

        try { await this.waitForEndOrAbort(audioEl, abortAll.signal); } catch {}
        await this.cleanupSessionResources();
        this.currentSession.audioEl = null;

        if (this.stopRequested || abortAll.signal.aborted) break;
        partIdx += 1;
      }

      log("buffered prefetch finished", { startIndex, requestedParts: chunks.length });
if (this.stopRequested || abortAll.signal.aborted) {
        this.notify(`Buffered playback stopped after ${Math.max(0, partIdx - startIndex)} of ${chunks.length - startIndex} part(s)`);
      } else {
        this.notify(`Buffered playback finished: ${Math.max(0, partIdx - startIndex)} of ${chunks.length - startIndex} part(s)`, true);
      }
    } catch (e: unknown) {
      const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
      warn("Buffered prefetch error", { msg });
    } finally {
      try { abortAll.abort(); } catch {}
      try { await this.cleanupSessionResources(true); } catch {}
      this.currentSession = null;
    }
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

  /** Generate and save audio for the current note without playback. Respects settings.chunkSize */
  async downloadCurrentNote(): Promise<void> {
    await this.stopPlayback(true);
    this.stopRequested = false;
    const file = this.app.workspace.getActiveFile();
if (!file) { this.notify("No active note", true); return; }
    const missing = missingSettings(this.settings);
if (missing.length) { this.notify(`Missing settings: ${missing.join(", ")}`, true); return; }

    const content = await this.app.vault.read(file);
if (!content.trim()) { this.notify("Note is empty", true); return; }

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
this.notify(`Starting download (${totalParts} part(s))...`, true);

    /** Ask to overwrite: if files exist and user wants fresh, reuse deleteExistingParts behavior */
const ext = fileExtFromFormat(this.settings.outputFormat);
    await deleteExistingParts(this.app, folder, base, ext).catch((e: unknown) => {
this.notify(`Could not remove old parts (continuing): ${((e as any)?.message) || String(e)}`, true);
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
this.notify(`Download failed on part ${part}: ${msg}`, true);
        break;
      }
      part += 1;
    }
    await this.cleanupSessionResources(true);
    this.currentSession = null;
    if (this.stopRequested) {
this.notify(`Download stopped after ${part - 1} of ${totalParts} part(s)`, true);
    } else {
this.notify(`Download complete: ${part - 1} of ${totalParts} part(s)`, true);
    }
  }
}


