import { Plugin, Notice, PluginSettingTab, Setting, Platform, TFile } from "obsidian";

/**
 * ListenMode Obsidian plugin entrypoint (Stage 0 scaffold).
 * The MVP logic will be implemented in modules under src/obsidian, src/ui, src/tts, and src/utils.
 */
export default class ListenModePlugin extends Plugin {
  async onload(): Promise<void> {
    new Notice("ListenMode loaded (Stage 0 scaffold)");
    this.addCommand({ id: "listenmode-read-current-note", name: "ListenMode: Read current note (MVP pending)", callback: () => new Notice("MVP not implemented yet") });
    this.addSettingTab(new ListenModeSettingsTab(this.app, this));
  }

  async onunload(): Promise<void> {}
}

/**
 * Minimal settings tab scaffold for Stage 0.
 */
class ListenModeSettingsTab extends PluginSettingTab {
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Status")
      .setDesc("Stage 0 scaffold is installed. MVP will add Azure settings here.");
  }
}

