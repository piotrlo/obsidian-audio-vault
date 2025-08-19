import type { App, TFile } from "obsidian";
import { Notice, Platform, Plugin, PluginSettingTab, Setting } from "obsidian";
import * as R from "ramda";

/**
 * @typedef {Object} TtsSettings
 * @property {string} azureApiKey Azure AI Speech API key stored in plugin data.
 * @property {string} azureRegion Azure region (e.g., westeurope, northeurope).
 * @property {string} voiceName Azure voice name (e.g., pl-PL-AvaMultilingualNeural or "AvaNeural (Dragon HD)").
 * @property {string} outputFormat Azure output audio format (e.g., audio-24khz-48kbitrate-mono-mp3).
 * @property {string} rate SSML prosody rate, e.g., "+10%" for 1.1.
 * @property {boolean} enableStreaming Enable real-time streaming playback while downloading.
 * @property {string} audioFolder Target vault folder for saved audio files.
 */

/**
 * @type {TtsSettings}
 */
const DEFAULT_SETTINGS = {
  azureApiKey: "",
  azureRegion: "westeurope",
  voiceName: "en-US-Ava:DragonHDLatestNeural",
  outputFormat: "audio-24khz-48kbitrate-mono-mp3",
  rate: "+10%",
  enableStreaming: true,
  audioFolder: "Audio",
  showControls: true
};

/**
 * Normalize UI 0..100 sliders to API-required 0..1 floats.
 * @param {number} v Value 0..100.
 * @returns {number} Normalized 0..1.
 */
function normalize01(v) {
  return Math.max(0, Math.min(100, v)) / 100;
}

/**
 * Split text into chunks without mutating input, preferring sentence boundaries.
 * @param {string} text Full note content.
 * @param {number} maxChars Maximum characters per chunk.
 * @returns {string[]} Array of chunks.
 */
function splitTextSmart(text, maxChars) {
  const sentences = text.split(/[.!?]+\s/);
  const step = (acc, sentence) => {
    const last = acc.length > 0 ? acc[acc.length - 1] : "";
    if (last.length === 0) return R.append(sentence + ". ", acc);
    if (last.length + sentence.length + 2 <= maxChars) {
      const merged = last + sentence + ". ";
      return R.update(acc.length - 1, merged, acc);
    }
    return R.append(sentence + ". ", acc);
  };
  return R.reduce(step, [], sentences).map(s => s.trim());
}

/**
 * Create a file-safe base name for audio exports.
 * @param {string} input Raw note base name.
 * @returns {string} Safe base.
 */
function toSafeBase(input) {
  return input.replace(/[^a-z0-9-_]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

/**
 * Start Azure AI Speech HTTP streaming for a chunk of text using SSML.
 * Endpoint: POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1
 * @param {string} azureApiKey API key.
 * @param {string} region Azure region.
 * @param {string} voiceName Voice name.
 * @param {string} outputFormat Azure output format (e.g., audio-24khz-48kbitrate-mono-mp3).
 * @param {string} ssml SSML payload to synthesize.
 * @returns {Promise<ReadableStream<Uint8Array>>} Stream of audio bytes.
 */
async function startHttpStream(azureApiKey, region, voiceName, outputFormat, ssml, abortSignal) {
  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const fmt = outputFormat && outputFormat.trim() ? outputFormat.trim() : "audio-24khz-48kbitrate-mono-mp3";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      accept: "*/*",
      "Ocp-Apim-Subscription-Key": azureApiKey,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": fmt
    },
    body: ssml,
    signal: abortSignal
  });
  if (!res.ok || !res.body) {
    let detail = "";
    try { detail = await res.text(); } catch (_) {}
    throw new Error(`TTS stream failed: ${res.status}${detail ? ` - ${detail}` : ""}`);
  }
  return /** @type {ReadableStream<Uint8Array>} */ (res.body);
}

/**
 * Concatenate streamed bytes into a Blob for saving, while also optional live playback.
 * @param {ReadableStream<Uint8Array>} stream MPEG stream.
 * @param {(chunk: Uint8Array) => void} onChunk Optional side-effect per chunk for playback.
 * @returns {Promise<Blob>} Final Blob with audio/mpeg.
 */
async function captureToBlob(stream, onChunk, outputFormat) {
  const reader = stream.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      if (onChunk) onChunk(value);
      chunks.push(value);
    }
  }
  const totalLen = chunks.reduce((n, a) => n + a.byteLength, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  // Best guess mime based on outputFormat (fallback mp3)
  const isWav = /riff|wav/i.test(outputFormat || "audio-24khz-48kbitrate-mono-mp3");
  const mime = isWav ? "audio/wav" : "audio/mpeg";
  return new Blob([out], { type: mime });
}

/**
 * Append a link to the generated audio file at the bottom of the note.
 * @param {import("obsidian").App} app Obsidian app.
 * @param {TFile} file Current note file.
 * @param {string} relPath Relative path to saved audio.
 * @returns {Promise<void>} When done.
 */
async function appendAudioReference(app, file, relPath) {
  const original = await app.vault.read(file);
  const updated = `${original}\n\nGenerated audio: [[${relPath}]]`;
  await app.vault.modify(file, updated);
}

/**
 * @extends Plugin
 */
interface PlaybackSession {
  abort: AbortController;
  audioEl: HTMLAudioElement | null;
  mediaSource: MediaSource | null;
  sourceBuffer: SourceBuffer | null;
  lastBlob: Blob | null;
}

export default class ElevenLabsFlashTTS extends Plugin {
  /** @type {TtsSettings} */
  settings = DEFAULT_SETTINGS;
  /** @type {PlaybackSession | null} */
  currentSession: any = null;
  controlsEl: HTMLElement | null = null;

  async onload() {
    await this.loadSettings();

    if (Platform.isIosApp) {
      // Allow user to disable streaming if it misbehaves on iOS
      this.settings.enableStreaming = true;
    }

    this.addCommand({
      id: "read-current-note",
      name: "Read Current Note",
      callback: () => this.readCurrentNote()
    });

    if (this.settings.showControls) this.createControls();

    this.addSettingTab(new TtsSettingsTab(this.app, this));
  }

  /**
   * Read the active note — stream playback in real time and save audio parts.
   * @returns {Promise<void>} When finished.
   */
  async readCurrentNote() {
    // If already playing, restart
    await this.stopPlayback();
    const file = this.app.workspace.getActiveFile();
    if (!file) return;

    // Pre-validation of settings
    const missing = [];
    if (!this.settings.azureApiKey?.trim()) missing.push("Azure API Key");
    if (!this.settings.azureRegion?.trim()) missing.push("Azure Region");
    if (!this.settings.voiceName?.trim()) missing.push("Voice name");
    if (!this.settings.outputFormat?.trim()) missing.push("Output format");
    if (missing.length) {
      new Notice(`Missing settings: ${missing.join(", ")}`);
      return;
    }

    const content = await this.app.vault.read(file);
    if (!content.trim()) {
      new Notice("Note is empty");
      return;
    }

    const maxChars = 35000;
    const chunks = splitTextSmart(content, maxChars);

    const base = toSafeBase(file.basename);
    const folder = this.settings.audioFolder;
    if (!(await this.app.vault.adapter.exists(folder))) {
      await this.app.vault.createFolder(folder).catch(() => {});
    }

    let part = 1;
    for (const chunk of chunks) {
      try {
        const ssml = `<?xml version="1.0" encoding="utf-8"?>
<speak version="1.0" xml:lang="pl-PL" xmlns:mstts="https://www.w3.org/2001/mstts"> 
  <voice name="${this.settings.voiceName}">
    <prosody rate="${this.settings.rate}">${chunk.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</prosody>
  </voice>
</speak>`;
        const abort = new AbortController();
        // Prepare session
        this.currentSession = { abort, audioEl: null, mediaSource: null, sourceBuffer: null, lastBlob: null };
        const stream = await startHttpStream(
          this.settings.azureApiKey,
          this.settings.azureRegion,
          this.settings.voiceName,
          this.settings.outputFormat,
          ssml,
          abort.signal
        );

        // Live playback: use HTML5 Audio + MediaSource; fallback to accumulate then play
        const mime = /wav/i.test(this.settings.outputFormat) ? "audio/wav" : "audio/mpeg";
        const supportsMSE = typeof MediaSource !== "undefined" && MediaSource.isTypeSupported && MediaSource.isTypeSupported(mime);
        /** @type {HTMLAudioElement | null} */
        let audioEl = null;
        /** @type {MediaSource | null} */
        let mediaSource = null;
        /** @type {SourceBuffer | null} */
        let sourceBuffer = null;
        /** @type {(chunk: Uint8Array) => void} */
        let onChunk = () => {};

        if (this.settings.enableStreaming && supportsMSE) {
          mediaSource = new MediaSource();
          const objectUrl = URL.createObjectURL(mediaSource);
          audioEl = new Audio(objectUrl);
          audioEl.playbackRate = this.getPlaybackRateFromRateSetting(this.settings.rate);
          audioEl.play().catch(() => {});
          await new Promise((res) => mediaSource.addEventListener("sourceopen", () => res(undefined), { once: true }));
          sourceBuffer = mediaSource.addSourceBuffer(/wav/i.test(this.settings.outputFormat) ? "audio/wav" : "audio/mpeg");
          onChunk = (u8) => {
            try { sourceBuffer && sourceBuffer.appendBuffer(u8); } catch (e) {}
          };
          this.currentSession.audioEl = audioEl;
          this.currentSession.mediaSource = mediaSource;
          this.currentSession.sourceBuffer = sourceBuffer;
          this.updateControlsState(true);
        }

        const blob = await captureToBlob(stream, onChunk, this.settings.outputFormat);
        if (this.currentSession) this.currentSession.lastBlob = blob;

        if (mediaSource && mediaSource.readyState === "open") {
          try { mediaSource.endOfStream(); } catch (_) {}
        }

        const arrayBuf = await blob.arrayBuffer();
        const ext = /wav/i.test(this.settings.outputFormat) ? "wav" : "mp3";
        const audioPath = `${folder}/${base}_part_${part}.${ext}`;
        await this.app.vault.adapter.writeBinary(audioPath, arrayBuf);
        await appendAudioReference(this.app, file, audioPath);
        new Notice(`Saved ${audioPath}`);
        this.updateControlsState(false);
      } catch (err) {
        new Notice(`TTS failed on part ${part}: ${(err && err.message) || err}`);
        this.updateControlsState(false);
      }
      part += 1;
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /**
   * Create minimal playback controls UI.
   * Buttons: play/pause, stop, refresh, download; slider: speed.
   * @returns {void}
   */
  createControls() {
    if (this.controlsEl) return;
    const el = document.createElement("div");
    el.setAttr("style", "position:fixed;bottom:12px;right:12px;z-index:9999;background:var(--background-primary);border:1px solid var(--background-modifier-border);padding:6px 8px;border-radius:8px;display:flex;gap:8px;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,.15);");

    const mkBtn = (label, title, onClick) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.title = title;
      b.setAttr("style", "padding:2px 6px;font-size:12px;");
      b.addEventListener("click", (e) => { e.preventDefault(); onClick(); });
      return b;
    };

    const playPause = mkBtn("⏯️", "Play/Pause or Start", () => this.playOrStart());
    const stop = mkBtn("⏹️", "Stop", () => { void this.stopPlayback(); });
    const refresh = mkBtn("🔁", "Restart", () => { void this.readCurrentNote(); });
    const download = mkBtn("⬇️", "Download last audio", () => this.downloadLastAudio());

    const label = document.createElement("span");
    label.textContent = "Speed";
    label.setAttr("style", "font-size:12px;margin-left:4px;");

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0.5";
    slider.max = "2.0";
    slider.step = "0.05";
    slider.value = String(this.getPlaybackRateFromRateSetting(this.settings.rate));
    slider.setAttr("style", "width:120px;");
    slider.addEventListener("input", () => this.setPlaybackRate(parseFloat(slider.value)));

    el.appendChild(playPause);
    el.appendChild(stop);
    el.appendChild(refresh);
    el.appendChild(download);
    el.appendChild(label);
    el.appendChild(slider);

    document.body.appendChild(el);
    this.controlsEl = el;
  }

  /**
   * Update controls to reflect playing/paused state.
   * @param {boolean} playing whether playing
   */
  updateControlsState(playing) {
    // minimal – could update button styles if needed
  }

  /**
   * Toggle play/pause on current audio element.
   */
  playOrStart() {
    const a = this.currentSession?.audioEl;
    if (a) {
      if (a.paused) a.play().catch(() => {}); else a.pause();
      return;
    }
    void this.readCurrentNote();
  }

  togglePlayPause() {
    const a = this.currentSession?.audioEl;
    if (!a) return;
    if (a.paused) a.play().catch(() => {}); else a.pause();
  }

  /**
   * Stop playback and abort in-flight request.
   */
  async stopPlayback() {
    try { this.currentSession?.abort?.abort(); } catch (_) {}
    try {
      const ms = this.currentSession?.mediaSource;
      if (ms && ms.readyState === "open") ms.endOfStream();
    } catch (_) {}
    try { this.currentSession?.audioEl?.pause(); } catch (_) {}
    this.currentSession = null;
    this.updateControlsState(false);
  }

  /**
   * Download last audio blob if available.
   */
  downloadLastAudio() {
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

  /**
   * Apply playback rate to current audio element.
   * @param {number} rate 0.5 .. 2.0
   */
  setPlaybackRate(rate) {
    const a = this.currentSession?.audioEl;
    if (a) a.playbackRate = rate;
  }

  /**
   * Map SSML rate string like "+10%" to playbackRate number.
   * @param {string} rateStr SSML rate
   * @returns {number} playbackRate
   */
  getPlaybackRateFromRateSetting(rateStr) {
    const m = /([+-]?\d+)%/.exec(rateStr || "+0%");
    const pct = m ? parseInt(m[1], 10) : 0;
    return Math.max(0.5, Math.min(2.0, 1 + pct / 100));
  }
}

/**
 * @extends PluginSettingTab
 */
class TtsSettingsTab extends PluginSettingTab {
  /**
   * @param {App} app Obsidian app
   * @param {ElevenLabsFlashTTS} plugin Plugin instance
   */
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    /**
     * Build voice dropdown with a single option initially; it can be replaced after fetching voices.
     * @param {import('obsidian').DropdownComponent} dd Dropdown component
     * @returns {void}
     */
    const buildInitialVoiceDropdown = (dd) => {
      dd.addOption(this.plugin.settings.voiceName, this.plugin.settings.voiceName);
      dd.setValue(this.plugin.settings.voiceName);
      dd.onChange(async (v) => {
        this.plugin.settings.voiceName = v;
        await this.plugin.saveSettings();
      });
    };

    /**
     * Fetch voices for current region using Azure API and repopulate dropdown.
     * @param {import('obsidian').DropdownComponent} dd Dropdown component to update
     * @returns {Promise<void>} When updated
     */
    const fetchAndPopulateVoices = async (dd) => {
      if (!this.plugin.settings.azureApiKey?.trim() || !this.plugin.settings.azureRegion?.trim()) {
        new Notice("Set Azure API Key and Region first");
        return;
      }
      try {
        const url = `https://${this.plugin.settings.azureRegion}.tts.speech.microsoft.com/cognitiveservices/voices/list`;
        const res = await fetch(url, {
          headers: { "Ocp-Apim-Subscription-Key": this.plugin.settings.azureApiKey }
        });
        if (!res.ok) {
          let t = ""; try { t = await res.text(); } catch(_) {}
          new Notice(`Voice list failed: ${res.status}${t?` - ${t}`:""}`);
          return;
        }
        const data = await res.json();
        const voices = Array.isArray(data) ? data : [];
        const options = voices.reduce((acc, v) => {
          const key = v.ShortName || v.Name;
          if (key) acc[key] = key;
          return acc;
        }, /** @type {Record<string,string>} */({}));
        dd.selectEl.innerHTML = "";
        Object.entries(options).forEach(([k, label]) => dd.addOption(k, label));
        if (options[this.plugin.settings.voiceName]) {
          dd.setValue(this.plugin.settings.voiceName);
        } else {
          const first = Object.keys(options)[0];
          if (first) {
            dd.setValue(first);
            this.plugin.settings.voiceName = first;
            await this.plugin.saveSettings();
          }
        }
        new Notice(`Voices loaded: ${Object.keys(options).length}`);
      } catch (e) {
        new Notice(`Voice list error: ${(e && e.message) || e}`);
      }
    };

    new Setting(containerEl)
      .setName("Azure API Key")
      .setDesc("Stored locally in plugin data")
      .addText((t) =>
        t.setPlaceholder("••••••••")
          .setValue(this.plugin.settings.azureApiKey)
          .onChange(async (v) => {
            this.plugin.settings.azureApiKey = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Azure Region")
      .setDesc("e.g., westeurope, northeurope")
      .addText((t) =>
        t.setPlaceholder("westeurope")
          .setValue(this.plugin.settings.azureRegion)
          .onChange(async (v) => {
            this.plugin.settings.azureRegion = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Voice name")
      .setDesc("Choose an Azure voice; use the button to fetch voices for your region")
      .addDropdown((dd) => {
        buildInitialVoiceDropdown(dd);
      })
      .addButton((btn) =>
        btn.setButtonText("Fetch voices for region")
          .onClick(async () => {
            const row = btn.buttonEl.parentElement;
            const dd = row?.querySelector("select");
            if (!dd) return;
            const fakeDD = /** @type {any} */({ selectEl: dd, addOption: (v, l) => { const opt = document.createElement("option"); opt.value = v; opt.text = l; dd.appendChild(opt);} , setValue: (v) => { dd.value = v; } , onChange: () => {} });
            await fetchAndPopulateVoices(fakeDD);
          })
      );

    new Setting(containerEl)
      .setName("Output format")
      .setDesc("e.g., audio-24khz-48kbitrate-mono-mp3 or riff-24khz-16bit-mono-pcm")
      .addText((t) =>
        t.setPlaceholder("audio-24khz-48kbitrate-mono-mp3")
          .setValue(this.plugin.settings.outputFormat)
          .onChange(async (v) => {
            this.plugin.settings.outputFormat = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Rate")
      .setDesc("SSML rate, e.g., +10% for ~1.1x")
      .addText((t) =>
        t.setPlaceholder("+10%")
          .setValue(this.plugin.settings.rate)
          .onChange(async (v) => {
            this.plugin.settings.rate = v.trim() || "+0%";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Streaming (realtime)")
      .setDesc("Disable if playback fails on iOS")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.enableStreaming)
          .onChange(async (v) => {
            this.plugin.settings.enableStreaming = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show control panel")
      .setDesc("Toggle the on-screen playback controls")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.showControls)
          .onChange(async (v) => {
            this.plugin.settings.showControls = v;
            await this.plugin.saveSettings();
            if (v) this.plugin.createControls(); else if (this.plugin.controlsEl) { this.plugin.controlsEl.detach(); this.plugin.controlsEl = null; }
          })
      );

    // Azure uses SSML prosody rate instead of stability/similarity/speed UI

    new Setting(containerEl)
      .setName("Audio folder")
      .addText((t) =>
        t.setPlaceholder("Audio")
          .setValue(this.plugin.settings.audioFolder)
          .onChange(async (v) => {
            this.plugin.settings.audioFolder = v.trim() || "Audio";
            await this.plugin.saveSettings();
          })
      );
  }
}

