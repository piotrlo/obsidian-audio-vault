import { Platform, Plugin } from "obsidian";
import { buildChunks, playbackRateFromRateSetting, resolveLang } from "./core/helpers";
import { notify } from "./core/notify";
import { loadTtsSettings } from "./core/settings";
import { AudioVaultSettingsTab } from "./obsidian/settings";
import { CARTESIA_KEY_STORAGE, CARTESIA_MP3, CARTESIA_VOICES, CartesiaTtsProvider } from "./tts/cartesia-provider";
import type { TtsSettings } from "./types";
import { setDebugLogging } from "./utils/logger";
import { buildPartialSnapshot, Mp3Assembler } from "./utils/mp3";
import { linkedAudioPaths, normalizeAudioFolder, publishAudio } from "./utils/note-audio";
import { sanitizeNoteForTts } from "./utils/sanitize";

export default class AudioVaultPlugin extends Plugin {
  settings!: TtsSettings;
  private job: { path: string; abort: AbortController; audio?: HTMLAudioElement } | null = null;

  async onload(): Promise<void> {
    this.settings = loadTtsSettings(await this.loadData());
    setDebugLogging(!!this.settings.debugLogs);
    this.addCommand({ id: "audiovault-play-pause", name: "Play/Pause current note", callback: () => this.playOrStart() });
    this.addCommand({ id: "audiovault-stop", name: "Stop", callback: () => this.stopPlayback() });
    this.addCommand({ id: "audiovault-restart", name: "Regenerate and play current note", callback: () => void this.readCurrentNote(true) });
    this.addCommand({ id: "audiovault-download", name: "Download audio (no playback)", callback: () => void this.downloadCurrentNote() });
    this.addRibbonIcon("headphones", "Play/Pause current note", () => this.playOrStart());
    this.addSettingTab(new AudioVaultSettingsTab(this.app, this));
  }

  onunload(): void {
    this.stopPlayback();
  }

  getCartesiaKey(): string {
    const value: unknown = this.app.loadLocalStorage(CARTESIA_KEY_STORAGE);
    return typeof value === "string" ? value : "";
  }

  setCartesiaKey(value: string): void {
    this.app.saveLocalStorage(CARTESIA_KEY_STORAGE, value.trim() || null);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  stopPlayback(): void {
    this.job?.abort.abort();
  }

  playOrStart(): void {
    const job = this.job;
    if (job?.audio && job.path === this.app.workspace.getActiveFile()?.path) {
      if (job.audio.paused) {
        void job.audio.play().catch(() => notify(this.settings, "Could not resume audio.", true));
      } else {
        job.audio.pause();
      }
      return;
    }
    void this.readCurrentNote();
  }

  readCurrentNote(forceRegenerate = false): Promise<void> {
    return this.run(true, forceRegenerate);
  }

  downloadCurrentNote(): Promise<void> {
    return this.run(false, true);
  }

  private async run(play: boolean, regenerate: boolean): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      notify(this.settings, "Open a Markdown note first.", true);
      return;
    }
    if (this.job) {
      notify(this.settings, "AudioVault is busy. Stop the current job first.", true);
      return;
    }

    const job = { path: file.path, abort: new AbortController() };
    this.job = job;
    const { signal } = job.abort;
    const settings = { ...this.settings };
    try {
      const raw = await this.app.vault.cachedRead(file);
      if (play && !regenerate) {
        const links = linkedAudioPaths(raw);
        if (links.length) {
          for (const path of links) {
            if (!await this.app.vault.adapter.exists(path)) {
              throw new Error("A linked MP3 is missing. Sync the audio file or use “Regenerate and play current note”.");
            }
          }
          for (const path of links) {
            signal.throwIfAborted();
            await this.playBytes(await this.app.vault.adapter.readBinary(path), settings.rate);
          }
          return;
        }
      }

      const key = this.getCartesiaKey();
      if (!key) throw new Error("Add your Cartesia API key in AudioVault settings to generate audio.");
      const text = sanitizeNoteForTts(raw);
      if (!text) throw new Error("This note has no readable text.");
      const chunks = buildChunks(text, settings, Platform.isIosApp);
      if (!chunks.length) throw new Error("This note has no readable text.");
      const folder = normalizeAudioFolder(settings.audioFolder);
      const existingFolder = await this.app.vault.adapter.stat(folder);
      if (existingFolder?.type === "file") throw new Error("The audio folder points to a file.");
      if (!existingFolder) await this.app.vault.createFolder(folder);
      const lang = resolveLang(text, settings);
      const provider = new CartesiaTtsProvider(key, settings.cartesiaVoiceId ?? CARTESIA_VOICES[0].shortName);
      const assembler = new Mp3Assembler();

      const generate = async (chunk: string): Promise<ArrayBuffer> => {
        signal.throwIfAborted();
        const part = new AbortController();
        const cancel = () => part.abort(signal.reason);
        signal.addEventListener("abort", cancel, { once: true });
        const timeout = setTimeout(() => part.abort(new Error("Cartesia timed out. AudioVault did not retry.")), 30_000);
        try {
          const stream = await provider.synthesize(chunk, CARTESIA_MP3, lang, part.signal);
          const bytes = await new Response(stream).arrayBuffer();
          if (!bytes.byteLength) throw new Error("Cartesia returned empty audio.");
          return bytes;
        } finally {
          clearTimeout(timeout);
          signal.removeEventListener("abort", cancel);
        }
      };

      notify(this.settings, `Generating audio (${chunks.length} ${chunks.length === 1 ? "part" : "parts"})…`, true);
      const start = (chunk: string) => generate(chunk).then(
        (bytes) => ({ ok: true as const, bytes }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      let next = start(chunks[0]);
      for (let index = 0; index < chunks.length; index++) {
        const result = await next;
        if (!result.ok) throw result.error;
        const { bytes } = result;
        assembler.append(new Uint8Array(bytes));
        if (index + 1 < chunks.length) next = start(chunks[index + 1]);
        if (play) await this.playBytes(bytes, settings.rate);
      }

      await publishAudio(this.app, file, folder, buildPartialSnapshot(assembler), signal);
      notify(this.settings, "Audio saved to the vault.", true);
    } catch (error) {
      if (!signal.aborted) notify(this.settings, error instanceof Error ? error.message : String(error), true);
    } finally {
      job.abort.abort();
      this.job = null;
    }
  }

  private async playBytes(bytes: ArrayBuffer, rate: string): Promise<void> {
    const job = this.job;
    if (!job) return;
    const { signal } = job.abort;
    signal.throwIfAborted();
    const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
    const audio = new Audio(url);
    audio.playbackRate = playbackRateFromRateSetting(rate);
    job.audio = audio;
    let cleanup = () => {};
    try {
      await new Promise<void>((resolve, reject) => {
        const end = () => resolve();
        const error = () => reject(new Error("Obsidian could not play this MP3."));
        cleanup = () => {
          audio.removeEventListener("ended", end);
          audio.removeEventListener("error", error);
          signal.removeEventListener("abort", end);
        };
        audio.addEventListener("ended", end, { once: true });
        audio.addEventListener("error", error, { once: true });
        signal.addEventListener("abort", end, { once: true });
        audio.play().catch(reject);
      });
    } finally {
      cleanup();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      job.audio = undefined;
    }
  }
}
