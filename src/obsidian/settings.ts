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

    const root = containerEl.createDiv();
    const tabs = root.createDiv({ cls: 'listenmode-tabs' });
    const basicBtn = tabs.createEl('button', { text: 'Basic' });
    const advBtn = tabs.createEl('button', { text: 'Advanced' });
    basicBtn.style.marginRight = '8px';
    const content = root.createDiv({ cls: 'listenmode-tab-content' });

    let currentTab: 'basic' | 'advanced' = 'basic';
    const render = () => {
      content.empty();
      if (currentTab === 'basic') this.renderBasic(content);
      else this.renderAdvanced(content);
      basicBtn.classList.toggle('mod-active', currentTab === 'basic');
      advBtn.classList.toggle('mod-active', currentTab === 'advanced');
    };
    basicBtn.onclick = () => { currentTab = 'basic'; render(); };
    advBtn.onclick = () => { currentTab = 'advanced'; render(); };
    render();
  }

  private renderBasic(containerEl: HTMLElement): void {
    // Auto-refresh license status on opening the tab (with basic caching)
    void (async () => {
      try {
        const s = this.plugin.settings;
        const hasBackend = !!s.useBackend && !!s.backendUrl && !!s.licenseKey;
        const tokenFresh = !!s.licenseTokenExpiresAt && Date.now() < (s.licenseTokenExpiresAt - 120_000);
        if (hasBackend && !tokenFresh) {
          const provider = (await import("../tts/backend-provider")).BackendTtsProvider;
          const p = new provider({ backendUrl: s.backendUrl!, licenseKey: s.licenseKey!, clientId: s.clientId });
          const v = await p.validateLicense();
          this.plugin.settings.licensePlan = v.plan;
          this.plugin.settings.licenseQuotaRemaining = v.quota_remaining;
          this.plugin.settings.licenseQuotaLimit = v.quota_limit;
          this.plugin.settings.licenseTokenExpiresAt = v.expiresAtMs;
          try {
            const u = await p.fetchUsage();
            this.plugin.settings.licenseUsagePeriod = u.period || this.plugin.settings.licenseUsagePeriod;
          } catch {}
          await this.plugin.saveSettings();
          this.renderBasic(containerEl);
          return;
        }
      } catch {}
    })();

    // License CTA + status
    const licCta = new Setting(containerEl)
      .setName("ListenMode Plus — aktywuj darmową licencję lub kup plan")
      .setDesc("Darmowy plan z miesięcznym limitem (2 urządzenia). Wyższe plany bez limitu urządzeń i większe limity znaków.");
    licCta.addButton((b) => b.setButtonText("Upgrade").setCta().onClick(() => {
      try { window.open('https://listenmode.app/upgrade', '_blank'); } catch {}
    }));

    // License status row (plan/quota/expiry)
    const licenseStatus = new Setting(containerEl)
      .setName("Status licencji")
      .setDesc("Plan, pozostałe tokeny i ważność").addText((t) => {
        const s = this.plugin.settings;
        const parts: string[] = [];
        if (s.licensePlan) parts.push(`Plan: ${s.licensePlan}`);
        if (typeof s.licenseQuotaRemaining === 'number' && typeof s.licenseQuotaLimit === 'number') parts.push(`Pozostało: ${s.licenseQuotaRemaining}/${s.licenseQuotaLimit}`);
        if (s.licenseTokenExpiresAt) parts.push(`Ważny do: ${new Date(s.licenseTokenExpiresAt).toLocaleString()}`);
        const statusText = parts.join(' | ') || 'Niezweryfikowana';
        t.setDisabled(true);
        t.setValue(statusText);
        return t;
      });
    try {
      const s = this.plugin.settings;
      const span = licenseStatus.nameEl.createEl('span');
      span.style.marginLeft = '8px';
      span.style.padding = '2px 6px';
      span.style.borderRadius = '6px';
      span.style.fontSize = '0.9em';
      span.style.color = '#fff';
      const hasCfg = !!s.useBackend && !!s.backendUrl && !!s.licenseKey;
      if (!hasCfg) { span.textContent = 'Brak konfiguracji'; span.style.backgroundColor = '#b00020'; }
      else if (typeof s.licenseQuotaRemaining === 'number' && typeof s.licenseQuotaLimit === 'number' && s.licenseQuotaLimit > 0) {
        const pct = s.licenseQuotaRemaining / s.licenseQuotaLimit;
        span.textContent = pct <= 0 ? '0%' : `${Math.round(pct * 100)}%`;
        if (pct <= 0.05) span.style.backgroundColor = '#b00020';
        else if (pct <= 0.15) span.style.backgroundColor = '#f57c00';
        else span.style.backgroundColor = '#388e3c';
      } else { span.textContent = 'N/D'; span.style.backgroundColor = '#616161'; }
    } catch {}

    // License input + actions
    const licInput = new Setting(containerEl)
      .setName("License Key")
      .setDesc("Wklej klucz, aby aktywować licencję (Plus)")
      .addText((t) => t.setPlaceholder("LM-...-...").setValue(this.plugin.settings.licenseKey || "").onChange(async (v) => { this.plugin.settings.licenseKey = v.trim(); await this.plugin.saveSettings(); }));
    licInput.addButton((btn) => btn.setButtonText("Aktywuj").setCta().onClick(async () => {
      try {
        if (!this.plugin.settings.useBackend || !this.plugin.settings.backendUrl || !this.plugin.settings.licenseKey) { new Notice("Włącz tryb Plus i wklej klucz licencji"); return; }
        const provider = (await import("../tts/backend-provider")).BackendTtsProvider;
        const p = new provider({ backendUrl: this.plugin.settings.backendUrl!, licenseKey: this.plugin.settings.licenseKey!, clientId: this.plugin.settings.clientId });
        const v = await p.validateLicense();
        this.plugin.settings.licensePlan = v.plan;
        this.plugin.settings.licenseQuotaRemaining = v.quota_remaining;
        this.plugin.settings.licenseQuotaLimit = v.quota_limit;
        this.plugin.settings.licenseTokenExpiresAt = v.expiresAtMs;
        await this.plugin.saveSettings();
        new Notice("Licencja zweryfikowana");
        this.renderBasic(containerEl);
      } catch (e: any) { new Notice(`Błąd weryfikacji: ${e?.message || String(e)}`); }
    }));

    const usageBtn = new Setting(containerEl).setName("Weryfikacja licencji / użycie").setDesc("Pobiera plan i pozostałe tokeny");
    usageBtn.addButton((btn) => btn.setButtonText("Sprawdź").onClick(async () => {
      try {
        if (!this.plugin.settings.useBackend || !this.plugin.settings.backendUrl || !this.plugin.settings.licenseKey) { new Notice("Włącz tryb Plus i wklej klucz licencji"); return; }
        const provider = (await import("../tts/backend-provider")).BackendTtsProvider;
        const p = new provider({ backendUrl: this.plugin.settings.backendUrl!, licenseKey: this.plugin.settings.licenseKey!, clientId: this.plugin.settings.clientId });
        const u = await p.fetchUsage();
        this.plugin.settings.licensePlan = u.plan || this.plugin.settings.licensePlan;
        this.plugin.settings.licenseQuotaRemaining = typeof u.quota_remaining === 'number' ? u.quota_remaining : this.plugin.settings.licenseQuotaRemaining;
        this.plugin.settings.licenseQuotaLimit = typeof u.quota_limit === 'number' ? u.quota_limit : this.plugin.settings.licenseQuotaLimit;
        this.plugin.settings.licenseUsagePeriod = u.period || this.plugin.settings.licenseUsagePeriod;
        await this.plugin.saveSettings();
        new Notice("Użycie odświeżone");
        this.renderBasic(containerEl);
      } catch (e: any) { new Notice(`Błąd pobierania użycia: ${e?.message || String(e)}`); }
    }));

    // Mode: Local (Azure) vs Plus
    new Setting(containerEl)
      .setName("Tryb")
      .setDesc("Własny klucz Azure (lokalnie) lub Plus (backend)")
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.useBackend).onChange(async (v) => { this.plugin.settings.useBackend = v; await this.plugin.saveSettings(); this.renderBasic(containerEl); }));

    // Azure key (only in Local mode)
    if (!this.plugin.settings.useBackend) {
      new Setting(containerEl)
        .setName("Azure API Key")
        .setDesc("Przechowywany lokalnie w danych wtyczki")
        .addText((t) => t.setPlaceholder("••••••••").setValue(this.plugin.settings.azureApiKey).onChange(async (v) => { this.plugin.settings.azureApiKey = v.trim(); await this.plugin.saveSettings(); }));
    }

    // Speed slider (-100%..+500%)
    const speedRow = new Setting(containerEl)
      .setName("Speed")
      .setDesc("Tempo czytania: -100% do +500% (domyślnie +10%)");
    const currentRate = this.plugin.settings.rate || "+10%";
    const toNum = (s: string) => { const m = s.match(/(-?\d+)\s*%/); return m ? Math.max(-100, Math.min(500, parseInt(m[1], 10))) : 10; };
    const toStr = (n: number) => `${n >= 0 ? "+" : ""}${n}%`;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = "-100";
    slider.max = "500";
    slider.value = String(toNum(currentRate));
    slider.style.width = '200px';
    const label = document.createElement('span');
    label.style.marginLeft = '8px';
    label.textContent = toStr(toNum(currentRate));
    slider.oninput = async () => { const n = Math.max(-100, Math.min(500, Math.floor(Number(slider.value)))); label.textContent = toStr(n); this.plugin.settings.rate = toStr(n); await this.plugin.saveSettings(); };
    speedRow.settingEl.appendChild(slider);
    speedRow.settingEl.appendChild(label);

    // Language (auto/pl/en)
    new Setting(containerEl)
      .setName("Language")
      .setDesc("Automatycznie (PL/EN) lub wymuś język")
      .addDropdown((dd) => {
        dd.addOption('auto', 'Auto');
        dd.addOption('pl-PL', 'Polski');
        dd.addOption('en-US', 'English');
        dd.setValue(this.plugin.settings.language || 'auto');
        dd.onChange(async (v) => { this.plugin.settings.language = v as any; this.plugin.settings.languageOverride = v === 'auto' ? '' : v; await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Streaming (realtime)")
      .setDesc("Wyłącz, jeśli odtwarzanie nie działa na iOS")
      .addToggle((tg) => tg.setValue(this.plugin.settings.enableStreaming).onChange(async (v) => { this.plugin.settings.enableStreaming = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Merge parts into single audio file (MP3)")
      .setDesc("Zapisuje jeden scalony plik zamiast wielu części")
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.mergeParts).onChange(async (v) => { this.plugin.settings.mergeParts = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Audio folder")
      .setDesc("Folder docelowy na pliki audio")
      .addText((t) => t.setPlaceholder("Audio").setValue(this.plugin.settings.audioFolder).onChange(async (v) => { this.plugin.settings.audioFolder = v.trim() || "Audio"; await this.plugin.saveSettings(); }));
  }

  private renderAdvanced(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("TTS Provider")
      .setDesc("Obecnie dostępny: Azure")
      .addDropdown((dd) => { dd.addOption("azure", "Azure"); dd.setValue(this.plugin.settings.ttsProvider || "azure"); dd.onChange(async (v) => { this.plugin.settings.ttsProvider = v as any; await this.plugin.saveSettings(); }); });

    new Setting(containerEl)
      .setName("Output format")
      .setDesc("np. audio-24khz-48kbitrate-mono-mp3")
      .addText((t) => t.setPlaceholder("audio-24khz-48kbitrate-mono-mp3").setValue(this.plugin.settings.outputFormat).onChange(async (v) => { this.plugin.settings.outputFormat = v.trim(); await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Chunk size (characters)")
      .setDesc("Maks. znaki na część (500–9000)")
      .addText((t) => t.setPlaceholder("5000").setValue(String(this.plugin.settings.chunkSize || 5000)).onChange(async (v) => {
        const n = Math.floor(Number(v));
        const clamped = isFinite(n) ? Math.max(500, Math.min(9000, n)) : 5000;
        this.plugin.settings.chunkSize = clamped; await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Debug logs")
      .setDesc("Szczegółowe logi w konsoli")
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.debugLogs).onChange(async (v) => { this.plugin.settings.debugLogs = v; await this.plugin.saveSettings(); try { (await import("../utils/logger")).setDebugLogging(v); } catch {} }));

    const reset = new Setting(containerEl)
      .setName("Przywróć domyślne")
      .setDesc("Resetuje ustawienia do wartości domyślnych");
    reset.addButton((b) => b.setButtonText("Reset").onClick(async () => {
      try {
        const { DEFAULT_SETTINGS } = await import('../core/settings');
        const keep = { licenseKey: this.plugin.settings.licenseKey, clientId: this.plugin.settings.clientId } as any;
        this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS, keep);
        await this.plugin.saveSettings();
        new Notice('Ustawienia przywrócone');
        this.display();
      } catch (e: any) { new Notice(`Nie udało się przywrócić: ${e?.message || String(e)}`); }
    }));
  }
}

