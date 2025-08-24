/**
 * Settings tab implementation for ListenMode.
 */

import type { App } from "obsidian";
import { Notice, PluginSettingTab, Setting } from "obsidian";
import type ListenModePlugin from "../index";
import type { SupportedLang } from "../types";

/**
 * Build the settings tab UI.
 */
export class ListenModeSettingsTab extends PluginSettingTab {
  private plugin: ListenModePlugin;

  /**
   * @param {App} app Obsidian app.
   * @param {ListenModePlugin} plugin Plugin instance.
   */
  constructor(app: App, plugin: ListenModePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Azure API Key")
      .setDesc("Stored locally in plugin data")
      .addText((t) =>
        t.setPlaceholder("••••••••")
          .setValue(this.plugin.settings.azureApiKey)
          .onChange(async (v) => { this.plugin.settings.azureApiKey = v.trim(); await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName("Azure Region")
      .setDesc("e.g., westeurope, northeurope")
      .addText((t) =>
        t.setPlaceholder("westeurope")
          .setValue(this.plugin.settings.azureRegion)
          .onChange(async (v) => { this.plugin.settings.azureRegion = v.trim(); await this.plugin.saveSettings(); })
      );

    /**
     * Voice selection: dropdown plus fetch button to load from Azure for the configured region.
     */
    const voiceRow = new Setting(containerEl)
      .setName("Voice")
      .setDesc("Azure voice; use the button to fetch voices for your region");

    let voiceDropdown: import("obsidian").DropdownComponent | null = null;
    voiceRow.addDropdown((dd) => {
      voiceDropdown = dd;
      dd.addOption(this.plugin.settings.voiceName, this.plugin.settings.voiceName);
      dd.setValue(this.plugin.settings.voiceName);
      dd.onChange(async (v) => { this.plugin.settings.voiceName = v; await this.plugin.saveSettings(); });
    });
    voiceRow.addButton((btn) =>
      btn.setButtonText("Fetch voices for region").setCta().onClick(async () => {
        if (!this.plugin.settings.azureApiKey?.trim() || !this.plugin.settings.azureRegion?.trim()) {
          new Notice("Set Azure API Key and Region first");
          return;
        }
        try {
          const url = `https://${this.plugin.settings.azureRegion}.tts.speech.microsoft.com/cognitiveservices/voices/list`;
          const res = await fetch(url, { headers: { "Ocp-Apim-Subscription-Key": this.plugin.settings.azureApiKey } });
          if (!res.ok) { let t = ""; try { t = await res.text(); } catch {} ; new Notice(`Voice list failed: ${res.status}${t?` - ${t}`:""}`); return; }
          const data = await res.json();
          const voices: Array<{ ShortName?: string; Name?: string }> = Array.isArray(data) ? data : [];
          const filtered = voices.filter(v => {
            const key = (v.ShortName || v.Name || "").toString();
            if (!this.plugin.settings.onlyHdVoices) return !!key;
            const isNeural = /Neural/i.test(key);
            const isHd = /(HD|Dragon)/i.test(key);
            return !!key && isNeural && isHd;
          });
          const options: Record<string, string> = {};
          for (const v of filtered) { const key = v.ShortName || v.Name; if (key) options[key] = key; }
          if (voiceDropdown) {
            while (voiceDropdown.selectEl.firstChild) {
              voiceDropdown.selectEl.removeChild(voiceDropdown.selectEl.firstChild);
            }
            Object.entries(options).forEach(([k, label]) => voiceDropdown!.addOption(k, label));
            const preferred = this.plugin.settings.voiceName;
            if (options[preferred]) voiceDropdown.setValue(preferred);
            else {
              const first = Object.keys(options)[0];
              if (first) { voiceDropdown.setValue(first); this.plugin.settings.voiceName = first; await this.plugin.saveSettings(); }
            }
          }
          new Notice(`Voices loaded: ${Object.keys(options).length}`);
        } catch (e: any) {
          new Notice(`Voice list error: ${e?.message || String(e)}`);
        }
      })
    );
    new Setting(containerEl)
      .setName("TTS Provider")
      .setDesc("For now only Azure is available; OpenAI later")
      .addDropdown((dd) => {
        dd.addOption("azure", "Azure");
        dd.setValue(this.plugin.settings.ttsProvider || "azure");
        dd.onChange(async (v) => { this.plugin.settings.ttsProvider = v as any; await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Output format")
      .setDesc("e.g., audio-24khz-48kbitrate-mono-mp3 or riff-24khz-16bit-mono-pcm")
      .addText((t) =>
        t.setPlaceholder("audio-24khz-48kbitrate-mono-mp3")
          .setValue(this.plugin.settings.outputFormat)
          .onChange(async (v) => { this.plugin.settings.outputFormat = v.trim(); await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName("Rate")
      .setDesc("SSML rate, e.g., +10% for ~1.1x")
      .addText((t) =>
        t.setPlaceholder("+10%")
          .setValue(this.plugin.settings.rate)
          .onChange(async (v) => { this.plugin.settings.rate = v.trim() || "+0%"; await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName("Only HD neural voices")
      .setDesc("Filter voice list to Neural HD voices (e.g., DragonHD)")
      .addToggle((tg) => tg.setValue(this.plugin.settings.onlyHdVoices).onChange(async (v) => { this.plugin.settings.onlyHdVoices = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Language")
      .setDesc("SSML xml:lang to use; 'auto' will be added later via detection")
      .addDropdown((dd) => {
        dd.addOption("auto", "auto");
        dd.addOption("pl-PL", "pl-PL");
        dd.addOption("en-US", "en-US");
        dd.setValue(this.plugin.settings.language);
dd.onChange(async (v) => { this.plugin.settings.language = (v as SupportedLang); await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Chunk size (characters)")
      .setDesc("Max characters per part. Range: 500 – 9000. Default 5000.")
      .addText((t) =>
        t.setPlaceholder("5000")
          .setValue(String(this.plugin.settings.chunkSize || 5000))
          .onChange(async (v) => {
            const n = Math.floor(Number(v));
            const clamped = isFinite(n) ? Math.max(500, Math.min(9000, n)) : 5000;
            this.plugin.settings.chunkSize = clamped;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Streaming (realtime)")
      .setDesc("Disable if playback fails on iOS")
      .addToggle((tg) => tg.setValue(this.plugin.settings.enableStreaming).onChange(async (v) => { this.plugin.settings.enableStreaming = v; await this.plugin.saveSettings(); }));

/** Panel removed – control via ribbon/commands only */

    new Setting(containerEl)
      .setName("Merge parts into a single audio file (MP3)")
      .setDesc("When enabled and format is MP3: save a single file instead of parts")
      .addToggle((tg) => tg
        .setValue(!!this.plugin.settings.mergeParts)
        .onChange(async (v) => { this.plugin.settings.mergeParts = v; await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName("Audio folder")
      .setDesc("Target folder for generated audio files")
      .addText((t) =>
        t.setPlaceholder("Audio")
          .setValue(this.plugin.settings.audioFolder)
          .onChange(async (v) => { this.plugin.settings.audioFolder = v.trim() || "Audio"; await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName("Debug logs")
      .setDesc("Print detailed streaming and fetch diagnostics to the console")
      .addToggle((tg) => tg
        .setValue(!!this.plugin.settings.debugLogs)
        .onChange(async (v) => { this.plugin.settings.debugLogs = v; await this.plugin.saveSettings(); try { (await import("../utils/logger")).setDebugLogging(v); } catch {} })
      );

    new Setting(containerEl)
      .setName("Help")
      .setDesc("Use command palette: ListenMode: Read current note")
  }
}

