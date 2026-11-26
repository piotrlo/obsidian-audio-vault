import { Notice, PluginSettingTab, Setting, type App } from "obsidian";
import { DEFAULT_CHUNK_SIZE, DEFAULT_SETTINGS } from "../core/settings";
import { CARTESIA_VOICES } from "../tts/cartesia-provider";
import { setDebugLogging } from "../utils/logger";
import type AudioVaultPlugin from "../index";
import { CartesiaVoiceBrowser } from "./voice-browser";
import { toError } from "../utils/errors";

type DeclarativeControl =
  | { type: "text"; key: string; defaultValue?: string; validate?: (value: string) => string | void | Promise<string | void> }
  | { type: "number"; key: string; defaultValue?: number; min?: number; max?: number; step?: number | "any"; validate?: (value: number) => string | void | Promise<string | void> }
  | { type: "toggle"; key: string; defaultValue?: boolean };

type DeclarativeSetting = { name: string; desc?: string; control?: DeclarativeControl; render?: (setting: Setting) => void };
type DeclarativeSettingItem = DeclarativeSetting | {
  type: "group";
  heading?: string;
  visible?: boolean | (() => boolean);
  items: DeclarativeSetting[];
};

function refreshSettingsTab(tab: PluginSettingTab & { update?: () => void }): void {
  if (typeof tab.update === "function") tab.update();
  else tab.display();
}

export class AudioVaultSettingsTab extends PluginSettingTab {
  private advancedVisible = false;

  constructor(app: App, private readonly plugin: AudioVaultPlugin) {
    super(app, plugin);
  }

  getSettingDefinitions(): DeclarativeSettingItem[] {
    return [
      {
        type: "group",
        heading: "AudioVault",
        items: [
        {
          name: "TTS provider",
          desc: "Cartesia Sonic 3.6 (Azure is disabled).",
        },
        {
          name: "Cartesia API key",
          desc: "Stored on this device, outside synced plugin settings. Generating audio sends note text to Cartesia and uses your credits. Keep overages off in your Cartesia account.",
          render: (setting: Setting) => {
            setting.addText((text) => {
              text.inputEl.type = "password";
              text.inputEl.autocomplete = "off";
              text.setPlaceholder("Cartesia API key").setValue(this.plugin.getCartesiaKey())
                .onChange((value) => this.plugin.setCartesiaKey(value));
            });
          },
        },
        {
          name: "Voice",
          desc: "Cartesia voice used for generated audio.",
          render: (setting: Setting) => {
            const settings = this.plugin.settings;
            setting.addDropdown((dropdown) => {
              for (const voice of CARTESIA_VOICES) dropdown.addOption(voice.shortName, voice.name);
              const id = settings.cartesiaVoiceId ?? CARTESIA_VOICES[0].shortName;
              if (settings.cartesiaVoiceLabel || !CARTESIA_VOICES.some((voice) => voice.shortName === id)) {
                dropdown.addOption("catalog", (settings.cartesiaVoiceLabel || "Saved Cartesia voice").slice(0, 48));
                dropdown.setValue("catalog");
              } else dropdown.setValue(id);
              dropdown.onChange((value) => {
                if (value === "catalog") return;
                void this.selectVoice(value).catch(() => {
                  new Notice("Could not save your voice selection. Try again.");
                }).finally(() => refreshSettingsTab(this));
              });
            }).addButton((button) => button.setButtonText("Browse voices").onClick(() => {
              const key = this.plugin.getCartesiaKey().trim();
              if (!key) {
                new Notice("Add your Cartesia API key before browsing voices.");
                return;
              }
              new CartesiaVoiceBrowser(this.app, key, { id: settings.cartesiaVoiceId, locale: settings.cartesiaVoiceLocale },
                async (voice, locale) => {
                  await this.selectVoice(voice.id, voice.name, locale);
                  refreshSettingsTab(this);
                }).open();
            }));
          },
        },
        {
          name: "Playback speed",
          desc: "Playback-only adjustment, e.g. +10%. Does not regenerate audio.",
          control: {
            type: "text",
            key: "rate",
            defaultValue: DEFAULT_SETTINGS.rate,
            validate: (value: string) => /^[+-]?\d+%$/.test(value.trim()) ? undefined : "Enter a percentage such as +10%.",
          },
        },
        {
          name: "Language (optional override)",
          desc: "BCP-47 code; leave blank to detect the language or use the selected voice.",
          control: { type: "text", key: "languageOverride", defaultValue: "" },
        },
        {
          name: "Audio folder",
          desc: "Vault folder where generated audio is saved.",
          control: { type: "text", key: "audioFolder", defaultValue: DEFAULT_SETTINGS.audioFolder },
        },
        {
          name: "Advanced options",
          desc: "Toggle advanced settings.",
          render: (setting: Setting) => {
            setting.addButton((button) => button.setButtonText(this.advancedVisible ? "Hide" : "Show")
              .onClick(() => {
                this.advancedVisible = !this.advancedVisible;
                refreshSettingsTab(this);
              }));
          },
        },
        ],
      },
      {
          type: "group",
          heading: "Advanced options",
          visible: () => this.advancedVisible,
          items: [
            {
              name: "Chunk size (characters)",
              desc: `500–9000 characters (default: ${DEFAULT_CHUNK_SIZE}); iOS uses 500.`,
              control: {
                type: "number",
                key: "chunkSize",
                defaultValue: DEFAULT_CHUNK_SIZE,
                min: 500,
                max: 9000,
                step: 1,
                validate: (value: number) => Number.isInteger(value) && value >= 500 && value <= 9000
                  ? undefined
                  : "Enter a whole number from 500 to 9000.",
              },
            },
            {
              name: "Debug logs",
              desc: "Enable diagnostic logging.",
              control: { type: "toggle", key: "debugLogs", defaultValue: false },
            },
            {
              name: "Restore defaults",
              desc: "Keeps your Cartesia API key.",
              render: (setting: Setting) => {
                setting.addButton((button) => button.setButtonText("Reset").onClick(() => {
                  this.plugin.settings = { ...DEFAULT_SETTINGS };
                  setDebugLogging(false);
                  void this.plugin.saveSettings().then(() => {
                    new Notice("Settings restored");
                    refreshSettingsTab(this);
                  });
                }));
              },
            },
          ],
      },
    ];
  }

  getControlValue(key: string): unknown {
    switch (key) {
      case "rate": return this.plugin.settings.rate;
      case "languageOverride": return this.plugin.settings.languageOverride ?? "";
      case "audioFolder": return this.plugin.settings.audioFolder;
      case "chunkSize": return this.plugin.settings.chunkSize ?? DEFAULT_CHUNK_SIZE;
      case "debugLogs": return !!this.plugin.settings.debugLogs;
      default: return undefined;
    }
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    switch (key) {
      case "rate":
        if (typeof value !== "string" || !/^[+-]?\d+%$/.test(value.trim())) throw new Error("Invalid playback speed.");
        this.plugin.settings.rate = value.trim();
        break;
      case "languageOverride":
        if (typeof value !== "string") throw new Error("Invalid language override.");
        this.plugin.settings.languageOverride = value.trim();
        break;
      case "audioFolder":
        if (typeof value !== "string") throw new Error("Invalid audio folder.");
        this.plugin.settings.audioFolder = value.trim() || "Audio";
        break;
      case "chunkSize":
        if (typeof value !== "number" || !Number.isInteger(value) || value < 500 || value > 9000) {
          throw new Error("Invalid chunk size.");
        }
        this.plugin.settings.chunkSize = value;
        break;
      case "debugLogs":
        if (typeof value !== "boolean") throw new Error("Invalid debug logs setting.");
        this.plugin.settings.debugLogs = value;
        setDebugLogging(value);
        break;
      default:
        throw new Error(`Unknown AudioVault setting: ${key}`);
    }
    await this.plugin.saveSettings();
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
        dropdown.onChange((value) => {
          if (value === "catalog") return;
          void this.selectVoice(value).catch(() => {
            new Notice("Could not save your voice selection. Try again.");
          }).finally(() => this.display());
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
      .addText((text) => text.setValue(settings.rate).onChange((value) => {
        if (!/^[+-]?\d+%$/.test(value.trim())) return;
        settings.rate = value.trim();
        void this.plugin.saveSettings();
      }));
    new Setting(content)
      .setName("Language (optional override)")
      .setDesc("BCP-47 code, e.g. pl-PL. Leave blank to use the catalog voice’s language or detect Polish or English.")
      .addText((text) => text.setValue(settings.languageOverride ?? "").onChange((value) => {
        settings.languageOverride = value.trim();
        void this.plugin.saveSettings();
      }));
    new Setting(content)
      .setName("Audio folder")
      .addText((text) => text.setValue(settings.audioFolder).onChange((value) => {
        settings.audioFolder = value.trim() || "Audio";
        void this.plugin.saveSettings();
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
    new Setting(advanced).setName("Chunk size (characters)").setDesc(`500–9000 characters (default: ${DEFAULT_CHUNK_SIZE}); iOS uses 500.`)
      .addText((text) => text.setValue(String(settings.chunkSize ?? DEFAULT_CHUNK_SIZE)).onChange((value) => {
        const size = Number(value);
        if (!Number.isInteger(size) || size < 500 || size > 9000) return;
        settings.chunkSize = size;
        void this.plugin.saveSettings();
      }));
    new Setting(advanced).setName("Debug logs")
      .addToggle((toggle) => toggle.setValue(!!settings.debugLogs).onChange((value) => {
        settings.debugLogs = value;
        setDebugLogging(value);
        void this.plugin.saveSettings();
      }));
    new Setting(advanced).setName("Restore defaults").setDesc("Keeps your Cartesia API key.")
      .addButton((button) => button.setButtonText("Reset").onClick(() => {
        this.plugin.settings = { ...DEFAULT_SETTINGS };
        setDebugLogging(false);
        void this.plugin.saveSettings().then(() => {
          new Notice("Settings restored");
          this.display();
        });
      }));
  }

  private async selectVoice(id: string, label?: string, locale?: string): Promise<void> {
    const previous = this.plugin.settings;
    this.plugin.settings = { ...previous, cartesiaVoiceId: id, cartesiaVoiceLabel: label, cartesiaVoiceLocale: locale };
    try {
      await this.plugin.saveSettings();
    } catch (error) {
      this.plugin.settings = previous;
      throw toError(error);
    }
  }
}
