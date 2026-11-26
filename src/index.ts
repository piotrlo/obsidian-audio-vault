import { Platform, Plugin, setTooltip } from "obsidian";
import { buildChunks, playbackRateFromRateSetting, resolveLang } from "./core/helpers";
import { notify } from "./core/notify";
import { loadTtsSettings } from "./core/settings";
import { AudioVaultSettingsTab } from "./obsidian/settings";
import { attachMediaSession } from "./playback/media-session";
import { CARTESIA_API_VERSION, CARTESIA_KEY_STORAGE, CARTESIA_MODEL, CARTESIA_MP3, CARTESIA_VOICES, CartesiaTtsProvider } from "./tts/cartesia-provider";
import { downloadPart } from "./tts/download-part";
import { openPendingAudio } from "./tts/pending-audio";
import type { TtsSettings } from "./types";
import { setDebugLogging } from "./utils/logger";
import { buildPartialSnapshot, Mp3Assembler } from "./utils/mp3";
import { hasLocalRecording, linkedAudioPaths, normalizeAudioFolder, noteAudioFingerprint, offlineAudioStatus, publishAudio } from "./utils/note-audio";
import type { OfflineAudioStatus } from "./utils/note-audio";
import { sanitizeNoteForTts } from "./utils/sanitize";

type PartResult = { ok: true; data: ArrayBuffer } | { ok: false; error: unknown };
type AudioJob = {
  path: string;
  abort: AbortController;
  audio?: HTMLAudioElement;
  progress?: { completed: number; total: number };
};
const ribbonTitle = "Play/Pause current note";
const offlineLabels: Record<OfflineAudioStatus, string> = {
  none: "",
  ready: "Ready offline",
  outdated: "Outdated audio (still playable offline)",
  unavailable: "Audio unavailable locally (check sync)",
  legacy: "Saved audio (note version unknown)",
};

export default class AudioVaultPlugin extends Plugin {
  settings!: TtsSettings;
  private job: AudioJob | null = null;
  private ribbon?: HTMLElement;
  private statusTimer?: number;
  private statusRevision = 0;

  async onload(): Promise<void> {
    this.settings = loadTtsSettings(await this.loadData());
    setDebugLogging(!!this.settings.debugLogs);
    this.addCommand({ id: "play-pause", name: "Play/Pause current note", callback: () => this.playOrStart() });
    this.addCommand({ id: "stop", name: "Stop", callback: () => this.stopPlayback() });
    this.addCommand({ id: "restart", name: "Regenerate and play current note", callback: () => void this.readCurrentNote(true) });
    this.addCommand({ id: "download", name: "Download audio (no playback)", callback: () => void this.downloadCurrentNote() });
    this.ribbon = this.addRibbonIcon("headphones", ribbonTitle, () => this.playOrStart());
    const { vault, workspace } = this.app;
    this.registerEvent(workspace.on("file-open", () => {
      this.setRibbonStatus("");
      this.refreshAudioStatus();
    }));
    this.registerEvent(workspace.on("editor-change", () => this.refreshAudioStatus()));
    const onFileUpdate = ({ path }: { path: string }) => {
      if (path === workspace.getActiveFile()?.path || /\.mp3$/i.test(path)) this.refreshAudioStatus();
    };
    this.registerEvent(vault.on("create", onFileUpdate));
    this.registerEvent(vault.on("modify", onFileUpdate));
    this.registerEvent(vault.on("delete", () => this.refreshAudioStatus()));
    this.registerEvent(vault.on("rename", () => this.refreshAudioStatus()));
    this.refreshAudioStatus();
    this.addSettingTab(new AudioVaultSettingsTab(this.app, this));
  }

  onunload(): void {
    this.ribbon = undefined;
    this.statusRevision++;
    window.clearTimeout(this.statusTimer);
    this.stopPlayback();
  }

  private pendingAudioFolder(): string {
    return `${this.app.vault.configDir}/plugins/${this.manifest.id}/pending-audio`;
  }

  private setRibbonStatus(status: string): void {
    if (!this.ribbon) return;
    const label = status ? `${ribbonTitle} — ${status}` : ribbonTitle;
    this.ribbon.setAttribute("aria-label", label);
    setTooltip(this.ribbon, label);
  }

  private refreshAudioStatus(): void {
    if (!this.ribbon) return;
    const revision = ++this.statusRevision;
    window.clearTimeout(this.statusTimer);
    const { vault, workspace } = this.app;
    const file = workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      this.setRibbonStatus("");
      return;
    }
    const progress = this.job?.path === file.path && !this.job.abort.signal.aborted ? this.job.progress : undefined;
    if (progress) {
      const { completed, total } = progress;
      this.setRibbonStatus(completed < total
        ? `Generating audio (${completed}/${total} parts)`
        : "All audio parts generated (MP3 not saved yet)");
      return;
    }
    this.statusTimer = window.setTimeout(() => {
      void (async () => {
        const editor = workspace.activeEditor;
        const status = await (async () => {
          const raw = (editor?.file === file ? editor.editor?.getValue() : undefined) ?? await vault.cachedRead(file);
          return offlineAudioStatus(raw, vault.adapter, this.pendingAudioFolder());
        })().catch((): OfflineAudioStatus => "unavailable");
        if (revision === this.statusRevision && file === workspace.getActiveFile()) {
          this.setRibbonStatus(offlineLabels[status]);
        }
      })();
    }, 200);
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
    this.refreshAudioStatus();
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

    const job: AudioJob = { path: file.path, abort: new AbortController() };
    this.job = job;
    const { signal } = job.abort;
    const settings = { ...this.settings };
    let pending: Promise<PartResult> | undefined;
    let checkpoint: Awaited<ReturnType<typeof openPendingAudio>> | undefined;
    try {
      const raw = await this.app.vault.cachedRead(file);
      const pendingFolder = this.pendingAudioFolder();
      if (play && !regenerate) {
        const links = linkedAudioPaths(raw);
        if (links.length) {
          for (const path of links) {
            if (!await hasLocalRecording(this.app.vault.adapter, path, pendingFolder)) {
              throw new Error("A linked MP3 is missing or incomplete. Sync the audio file or use “Regenerate and play current note”.");
            }
          }
          for (const path of links) {
            signal.throwIfAborted();
            await this.playBytes(await this.app.vault.adapter.readBinary(path), settings.rate, file.basename);
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
      const voice = settings.cartesiaVoiceId ?? CARTESIA_VOICES[0].shortName;
      const provider = new CartesiaTtsProvider(key, voice);
      const assembler = new Mp3Assembler();
      const progress = job.progress = { completed: 0, total: chunks.length };
      this.refreshAudioStatus();
      const cache = checkpoint = await openPendingAudio(this.app.vault.adapter,
        pendingFolder,
        [file.path, CARTESIA_API_VERSION, CARTESIA_MODEL, CARTESIA_MP3, voice, lang, chunks],
      );

      notify(this.settings, `Generating audio (${chunks.length} ${chunks.length === 1 ? "part" : "parts"})…`, true);
      const start = (index: number): Promise<PartResult> => cache.getOrGenerate(index, () =>
        downloadPart((partSignal) => provider.synthesize(chunks[index], CARTESIA_MP3, lang, partSignal), signal),
      signal).then(
        (data) => {
          progress.completed++;
          if (!signal.aborted) this.refreshAudioStatus();
          return { ok: true, data };
        },
        (error: unknown) => ({ ok: false, error }),
      );
      let current = pending = start(0);
      for (let index = 0; index < chunks.length; index++) {
        const result = await current;
        signal.throwIfAborted();
        if (!result.ok) {
          const reason = result.error instanceof Error ? result.error.message : "Could not generate audio.";
          throw new Error(`Part ${index + 1}/${chunks.length}: ${reason}`);
        }
        const bytes = result.data;
        assembler.append(new Uint8Array(bytes));
        if (index + 1 < chunks.length) current = pending = start(index + 1);
        if (play) await this.playBytes(bytes, settings.rate, file.basename);
      }

      await publishAudio(this.app, file, folder, buildPartialSnapshot(assembler), signal, await noteAudioFingerprint(raw));
      job.progress = undefined;
      this.refreshAudioStatus();
      await cache.clear();
      notify(this.settings, "Audio saved to the vault.", true);
    } catch (error) {
      if (!signal.aborted) {
        const reason = error instanceof Error ? error.message : "Could not complete the audio job.";
        const resume = checkpoint?.completed
          ? ` ${checkpoint.completed} completed part(s) saved. Run the same command with unchanged text and voice settings to resume.`
          : "";
        notify(this.settings, `${reason}${resume}`, true);
      }
    } finally {
      job.abort.abort();
      await pending;
      this.job = null;
      this.refreshAudioStatus();
    }
  }

  private async playBytes(bytes: ArrayBuffer, rate: string, title: string): Promise<void> {
    const job = this.job;
    if (!job) return;
    const { signal } = job.abort;
    signal.throwIfAborted();
    const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
    const audio = new Audio(url);
    audio.playbackRate = playbackRateFromRateSetting(rate);
    job.audio = audio;
    const detachMediaSession = attachMediaSession(audio, title, () => {
      notify(this.settings, "Could not resume audio.", true);
    });
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
      detachMediaSession();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      job.audio = undefined;
    }
  }
}
