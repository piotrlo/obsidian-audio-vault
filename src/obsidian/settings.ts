import { Notice, PluginSettingTab, Setting, type App } from "obsidian";
import { DEFAULT_SETTINGS } from "../core/settings";
import { CARTESIA_VOICES } from "../tts/cartesia-provider";
import { setDebugLogging } from "../utils/logger";
import type AudioVaultPlugin from "../index";
import { CartesiaVoiceBrowser } from "./voice-browser";

export class AudioVaultSettingsTab extends PluginSettingTab {
  private advancedVisible = false;

  constructor(app: App, private readonly plugin: AudioVaultPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    const content = this.containerEl.createDiv({ cls: "audiovault-content" });
    const settings = this.plugin.settings;

    new Setting(content).setName("TTS provider").setDesc("Cartesia Sonic 3.6 (Azure is disabled).");
    new Setting(content)
      .setName("Cartesia API key")
      .setDesc("Stored on this device, outside synced plugin settings. Generating audio sends note text to Cartesia and uses your credits. Keep overages off in your Cartesia account.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
        text.setPlaceholder("Cartesia API key").setValue(this.plugin.getCartesiaKey())
          .onChange((value) => this.plugin.setCartesiaKey(value));
      });
    new Setting(content)
      .setName("Voice")
      .addDropdown((dropdown) => {
        for (const voice of CARTESIA_VOICES) dropdown.addOption(voice.shortName, voice.name);
        const id = settings.cartesiaVoiceId ?? CARTESIA_VOICES[0].shortName;
        if (settings.cartesiaVoiceLabel || !CARTESIA_VOICES.some((voice) => voice.shortName === id)) {
          dropdown.addOption("catalog", (settings.cartesiaVoiceLabel || "Saved Cartesia voice").slice(0, 48));
          dropdown.setValue("catalog");
        } else dropdown.setValue(id);
        dropdown.onChange(async (value) => {
          if (value === "catalog") return;
          try {
            await this.selectVoice(value);
          } catch {
            new Notice("Could not save your voice selection. Try again.");
          }
          this.display();
        });
      })
      .addButton((button) => button.setButtonText("Browse voices").onClick(() => {
        const key = this.plugin.getCartesiaKey().trim();
        if (!key) {
          new Notice("Add your Cartesia API key before browsing voices.");
          return;
        }
        new CartesiaVoiceBrowser(this.app, key, { id: settings.cartesiaVoiceId, locale: settings.cartesiaVoiceLocale },
          async (voice, locale) => {
            await this.selectVoice(voice.id, voice.name, locale);
            if (content.isConnected) this.display();
          }).open();
      }));
    new Setting(content)
      .setName("Playback speed")
      .setDesc("Playback-only adjustment, e.g. +10%. Does not regenerate audio.")
      .addText((text) => text.setValue(settings.rate).onChange(async (value) => {
        if (!/^[+-]?\d+%$/.test(value.trim())) return;
        settings.rate = value.trim();
        await this.plugin.saveSettings();
      }));
    new Setting(content)
      .setName("Language (optional override)")
      .setDesc("BCP-47 code, e.g. pl-PL. Leave blank to use the catalog voice’s language or detect Polish or English.")
      .addText((text) => text.setValue(settings.languageOverride ?? "").onChange(async (value) => {
        settings.languageOverride = value.trim();
        await this.plugin.saveSettings();
      }));
    new Setting(content)
      .setName("Audio folder")
      .addText((text) => text.setValue(settings.audioFolder).onChange(async (value) => {
        settings.audioFolder = value.trim() || "Audio";
        await this.plugin.saveSettings();
      }));

    const advancedToggle = new Setting(content).setName("Advanced options");
    const advanced = content.createDiv();
    advanced.hidden = !this.advancedVisible;
    advancedToggle.addExtraButton((button) => button
      .setIcon(this.advancedVisible ? "chevron-up" : "chevron-down")
      .setTooltip("Toggle advanced options")
      .onClick(() => {
        this.advancedVisible = !this.advancedVisible;
        advanced.hidden = !this.advancedVisible;
        button.setIcon(this.advancedVisible ? "chevron-up" : "chevron-down");
      }));
    new Setting(advanced).setName("Chunk size (characters)").setDesc("500–9000 characters; iOS uses 500.")
      .addText((text) => text.setValue(String(settings.chunkSize ?? 5000)).onChange(async (value) => {
        const size = Number(value);
        if (!Number.isInteger(size) || size < 500 || size > 9000) return;
        settings.chunkSize = size;
        await this.plugin.saveSettings();
      }));
    new Setting(advanced).setName("Debug logs")
      .addToggle((toggle) => toggle.setValue(!!settings.debugLogs).onChange(async (value) => {
        settings.debugLogs = value;
        setDebugLogging(value);
        await this.plugin.saveSettings();
      }));
    new Setting(advanced).setName("Restore defaults").setDesc("Keeps your Cartesia API key.")
      .addButton((button) => button.setButtonText("Reset").onClick(async () => {
        this.plugin.settings = { ...DEFAULT_SETTINGS };
        setDebugLogging(false);
        await this.plugin.saveSettings();
        new Notice("Settings restored");
        this.display();
      }));
  }

  private async selectVoice(id: string, label?: string, locale?: string): Promise<void> {
    const previous = this.plugin.settings;
    this.plugin.settings = { ...previous, cartesiaVoiceId: id, cartesiaVoiceLabel: label, cartesiaVoiceLocale: locale };
    try {
      await this.plugin.saveSettings();
    } catch (error) {
      this.plugin.settings = previous;
      throw error;
    }
  }
}
