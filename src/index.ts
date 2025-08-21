import { Plugin, Notice, Platform, TFile } from "obsidian";
import { splitTextSmart } from "./utils/chunk";
import { toSafeBase } from "./utils/safe-name";
import { buildSsml, deriveLangFromVoiceName } from "./utils/ssml";
import { detectLanguage } from "./utils/lang";
import { ensureFolder, writeBinary, appendAudioReference, deleteExistingParts } from "./utils/fs";
import { mimeFromFormat, startHttpStream, captureToBlob, fetchTtsAudio } from "./tts/azure";
import { ControlPanel } from "./ui/panel";
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
  /** UI panel manager. */
  panel = new ControlPanel();

  /**
   * Load settings and register commands.
   */
  async onload(): Promise<void> {
    await this.loadSettings();
    setDebugLogging(!!this.settings.debugLogs);
    this.addCommand({ id: "listenmode-read-current-note", name: "ListenMode: Read current note", callback: () => { void this.readCurrentNote(); } });
    this.addCommand({ id: "listenmode-stop", name: "ListenMode: Stop", callback: () => { void this.stopPlayback(); } });
    this.addCommand({ id: "listenmode-restart", name: "ListenMode: Restart", callback: () => { void this.readCurrentNote(true); } });
    this.addCommand({ id: "listenmode-toggle-controls", name: "ListenMode: Toggle panel", callback: () => { if (this.settings.showControls) this.destroyPanel(); else this.ensurePanel(); this.settings.showControls = !this.settings.showControls; void this.saveSettings(); } });
    this.addSettingTab(new ListenModeSettingsTab(this.app, this));
    if (this.settings.showControls) this.ensurePanel();
  }

  /**
   * Destroy UI and stop playback.
   */
  async onunload(): Promise<void> {
    await this.stopPlayback();
    this.destroyPanel();
  }

  /** Ensure the floating panel is created. */
  ensurePanel(): void {
    this.panel.create({
      onPlayOrStart: () => this.playOrStart(),
      onStop: () => { void this.stopPlayback(); },
      onRefresh: () => { void this.readCurrentNote(true); },
      onRateChange: (rate) => this.setPlaybackRate(rate)
    }, this.getPlaybackRateFromRateSetting(this.settings.rate));
  }

  /** Remove the floating panel if present. */
  destroyPanel(): void { this.panel.destroy(); }

  /**
   * Read the active note, stream playback, and save audio files.
   */
async readCurrentNote(forceRegenerate: boolean = false): Promise<void> {
    await this.stopPlayback();
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

    const chunks = splitTextSmart(content, 10000);
    const base = toSafeBase(file.basename);
    const autoLang = detectLanguage(content);
    const folder = this.settings.audioFolder || "Audio";
    await ensureFolder(this.app, folder);

    // Try to play existing local audio for part 1 if available (no regeneration unless user triggers Restart)
    try {
      const extExisting = /wav/i.test(this.settings.outputFormat) ? "wav" : "mp3";
      const existingPath = `${folder}/${base}_part_1.${extExisting}`;
      const exists = await this.app.vault.adapter.exists(existingPath);
      if (exists && !forceRegenerate) {
        const data = await this.app.vault.adapter.readBinary(existingPath);
        const mime = mimeFromFormat(this.settings.outputFormat);
        const blob = new Blob([data], { type: mime });
        const url = URL.createObjectURL(blob);
        const audioEl = new Audio(url);
        audioEl.playbackRate = this.getPlaybackRateFromRateSetting(this.settings.rate);
        try { await audioEl.play(); } catch {}
        this.currentSession = { abort: new AbortController(), audioEl, mediaSource: null, sourceBuffer: null, lastBlob: blob, fileBase: base };
        audioEl.addEventListener("play", () => this.panel.setPlaying(true));
        audioEl.addEventListener("pause", () => this.panel.setPlaying(false));
        audioEl.addEventListener("ended", () => this.panel.setPlaying(false));
        this.panel.setPlaying(true);
        new Notice(`Playing existing audio: ${existingPath}`);
        return;
      }
    } catch {}

    // If forcing regeneration, remove old parts first so new files take effect
    if (forceRegenerate) {
      const ext = /wav/i.test(this.settings.outputFormat) ? "wav" : "mp3";
      await deleteExistingParts(this.app, folder, base, ext).catch(() => {});
    }

    let part = 1;
    for (const chunk of chunks) {
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
          this.panel.setPlaying(true);

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
            }
            audioEl.addEventListener("play", () => this.panel.setPlaying(true));
            audioEl.addEventListener("pause", () => this.panel.setPlaying(false));
            audioEl.addEventListener("ended", () => this.panel.setPlaying(false));

            // Assemble final Blob while streaming to player
            const blob = await captureToBlob(stream, onChunk, streamFormat);
            log("streaming finished, total blob bytes", blob.size);
            if (this.currentSession) this.currentSession.lastBlob = blob;
            if (mediaSource.readyState === "open") { try { mediaSource.endOfStream(); } catch {} }

            // Persist to vault and append link (use original target extension)
            const arrayBuf = await blob.arrayBuffer();
            const ext = /wav/i.test(this.settings.outputFormat) ? 'wav' : 'mp3';
            const audioPath = `${folder}/${base}_part_${part}.${ext}`;
            await writeBinary(this.app, audioPath, arrayBuf);
            new Notice(`Saved ${audioPath}`);
            await appendAudioReference(this.app, file, audioPath);
          } catch (err) {
            const detail = (err && (err as any).message) ? (err as any).message : String(err);
            warn("streaming failed, falling back to buffered", { detail, streamFormat, streamMime });
            new Notice(`Streaming failed (fallback to buffered): ${detail}`);
            // Fall through to buffered path below
            const { buffer, mime } = await fetchTtsAudio(
              this.settings.azureApiKey,
              this.settings.azureRegion,
              this.settings.outputFormat,
              ssml,
              abort.signal
            );
            if (!buffer || buffer.byteLength === 0) { throw new Error("Empty audio buffer"); }
            const blob = new Blob([buffer], { type: mime });
            if (this.currentSession) this.currentSession.lastBlob = blob;

            const url = URL.createObjectURL(blob);
            const audioEl = new Audio(url);
            audioEl.playbackRate = this.getPlaybackRateFromRateSetting(this.settings.rate);
            try { await audioEl.play(); } catch {}
            this.currentSession.audioEl = audioEl;
            audioEl.addEventListener("ended", () => { this.currentSession = null; });

            const arrayBuf = buffer;
            const ext = /wav/i.test(this.settings.outputFormat) ? "wav" : "mp3";
            const audioPath = `${folder}/${base}_part_${part}.${ext}`;
            await writeBinary(this.app, audioPath, arrayBuf);
            new Notice(`Saved ${audioPath}`);
            await appendAudioReference(this.app, file, audioPath);
          }
        } else {
          // Fallback non-streaming path (existing buffered flow)
          log("buffered fetch start", { format: this.settings.outputFormat });
          const { buffer, mime } = await fetchTtsAudio(
            this.settings.azureApiKey,
            this.settings.azureRegion,
            this.settings.outputFormat,
            ssml,
            abort.signal
          );
          log("buffered fetch done", { bytes: buffer?.byteLength || 0, mime });
          if (!buffer || buffer.byteLength === 0) { throw new Error("Empty audio buffer"); }
          const blob = new Blob([buffer], { type: mime });
          if (this.currentSession) this.currentSession.lastBlob = blob;

          const url = URL.createObjectURL(blob);
          const audioEl = new Audio(url);
          audioEl.playbackRate = this.getPlaybackRateFromRateSetting(this.settings.rate);
          try { await audioEl.play(); } catch {}
          this.currentSession.audioEl = audioEl;
          audioEl.addEventListener("ended", () => { this.currentSession = null; });
          audioEl.addEventListener("play", () => this.panel.setPlaying(true));
          audioEl.addEventListener("pause", () => this.panel.setPlaying(false));
          audioEl.addEventListener("ended", () => this.panel.setPlaying(false));
          this.panel.setPlaying(true);

          const arrayBuf = buffer;
          const ext = /wav/i.test(this.settings.outputFormat) ? "wav" : "mp3";
          const audioPath = `${folder}/${base}_part_${part}.${ext}`;
          await writeBinary(this.app, audioPath, arrayBuf);
          new Notice(`Saved ${audioPath}`);
          await appendAudioReference(this.app, file, audioPath);
        }
      } catch (e: unknown) {
        const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message : String(e);
        new Notice(`TTS failed on part ${part}: ${msg}`);
      }
      part += 1;
    }
  }

  /** Stop playback and abort any in-flight request. */
  async stopPlayback(): Promise<void> {
    try { this.currentSession?.abort?.abort(); } catch {}
    this.panel.setPlaying(false);
    try {
      const ms = this.currentSession?.mediaSource;
      if (ms && ms.readyState === "open") ms.endOfStream();
    } catch {}
    try { this.currentSession?.audioEl?.pause(); } catch {}
    this.currentSession = null;
  }

  /** Toggle play/pause or start reading if nothing is playing. */
  playOrStart(): void {
    const a = this.currentSession?.audioEl;
    const file = this.app.workspace.getActiveFile();
    const currentBase = file ? toSafeBase(file.basename) : undefined;
    const sameFile = currentBase && this.currentSession?.fileBase === currentBase;
    if (a && sameFile && !a.ended) {
      if (a.paused) { a.play().catch(() => {}); this.panel.setPlaying(true); } else { a.pause(); this.panel.setPlaying(false); }
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
      showControls: true,
      audioFolder: "Audio",
      language: "pl-PL",
      onlyHdVoices: true,
      debugLogs: false
    }, data || {});
  }

  /** Persist settings. */
  async saveSettings(): Promise<void> { await this.saveData(this.settings); }
}

