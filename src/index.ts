import { Plugin, Notice, Platform, TFile } from "obsidian";
import { splitTextSmart } from "./utils/chunk";
import { toSafeBase } from "./utils/safe-name";
import { buildSsml } from "./utils/ssml";
import { detectLanguage } from "./utils/lang";
import { ensureFolder, writeBinary, appendAudioReference } from "./utils/fs";
import { mimeFromFormat, startHttpStream, captureToBlob } from "./tts/azure";
import { ControlPanel } from "./ui/panel";
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
    this.addCommand({ id: "listenmode-read-current-note", name: "ListenMode: Read current note", callback: () => { void this.readCurrentNote(); } });
    this.addCommand({ id: "listenmode-stop", name: "ListenMode: Stop", callback: () => { void this.stopPlayback(); } });
    this.addCommand({ id: "listenmode-restart", name: "ListenMode: Restart", callback: () => { void this.readCurrentNote(); } });
    this.addCommand({ id: "listenmode-download-last", name: "ListenMode: Download last audio", callback: () => { this.downloadLastAudio(); } });
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
      onRefresh: () => { void this.readCurrentNote(); },
      onDownload: () => this.downloadLastAudio(),
      onRateChange: (rate) => this.setPlaybackRate(rate)
    }, this.getPlaybackRateFromRateSetting(this.settings.rate));
  }

  /** Remove the floating panel if present. */
  destroyPanel(): void { this.panel.destroy(); }

  /**
   * Read the active note, stream playback, and save audio files.
   */
  async readCurrentNote(): Promise<void> {
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

    let part = 1;
    for (const chunk of chunks) {
      try {
        const lang = this.settings.language === "auto" ? autoLang : this.settings.language;
        const ssml = buildSsml({ text: chunk, voiceName: this.settings.voiceName, rate: this.settings.rate, lang });
        const abort = new AbortController();
        this.currentSession = { abort, audioEl: null, mediaSource: null, sourceBuffer: null, lastBlob: null };
        const stream = await startHttpStream(
          this.settings.azureApiKey,
          this.settings.azureRegion,
          this.settings.outputFormat,
          ssml,
          abort.signal
        );

        const mime = mimeFromFormat(this.settings.outputFormat);
        const supportsMSE = typeof MediaSource !== "undefined" && MediaSource.isTypeSupported && MediaSource.isTypeSupported(mime);
        let onChunk: ((u8: Uint8Array) => void) | undefined;
        if (this.settings.enableStreaming && supportsMSE) {
          const mediaSource = new MediaSource();
          const objectUrl = URL.createObjectURL(mediaSource);
          const audioEl = new Audio(objectUrl);
          audioEl.playbackRate = this.getPlaybackRateFromRateSetting(this.settings.rate);
          try { await audioEl.play(); } catch {}
          await new Promise<void>((res) => mediaSource.addEventListener("sourceopen", () => res(), { once: true }));
          const sourceBuffer = mediaSource.addSourceBuffer(mime);
          onChunk = (u8) => {
            try {
              const view = u8;
              const copy = new Uint8Array(view.byteLength);
              copy.set(view);
              sourceBuffer.appendBuffer(copy.buffer);
            } catch {}
          };
          this.currentSession.audioEl = audioEl;
          this.currentSession.mediaSource = mediaSource;
          this.currentSession.sourceBuffer = sourceBuffer;
        }

        const blob = await captureToBlob(stream, onChunk, this.settings.outputFormat);
        if (this.currentSession) this.currentSession.lastBlob = blob;
        if (this.currentSession?.mediaSource && this.currentSession.mediaSource.readyState === "open") {
          try { this.currentSession.mediaSource.endOfStream(); } catch {}
        }

        const arrayBuf = await blob.arrayBuffer();
        const ext = /wav/i.test(this.settings.outputFormat) ? "wav" : "mp3";
        const audioPath = `${folder}/${base}_part_${part}.${ext}`;
        await writeBinary(this.app, audioPath, arrayBuf);
        await appendAudioReference(this.app, file, audioPath);
        new Notice(`Saved ${audioPath}`);
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
    if (a) { if (a.paused) { a.play().catch(() => {}); } else { a.pause(); } return; }
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

  /** Download last audio blob if available. */
  downloadLastAudio(): void {
    const blob = this.currentSession?.lastBlob;
    if (!blob) { new Notice("No audio available yet"); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tts_audio.mp3";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      onlyHdVoices: true
    }, data || {});
  }

  /** Persist settings. */
  async saveSettings(): Promise<void> { await this.saveData(this.settings); }
}

