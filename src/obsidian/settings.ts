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

    // Auto-refresh license status on opening the tab (with basic caching)
    void (async () => {
      try {
        const s = this.plugin.settings;
        const hasBackend = !!s.useBackend && !!s.backendUrl && !!s.licenseKey;
        const tokenFresh = !!s.licenseTokenExpiresAt && Date.now() < (s.licenseTokenExpiresAt - 120_000);
        if (hasBackend && !tokenFresh) {
          const provider = (await import("../tts/backend-provider")).BackendTtsProvider;
          const p = new provider({ backendUrl: s.backendUrl!, licenseKey: s.licenseKey!, region: s.azureRegion });
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
          // Re-render with updated info
          this.display();
          return;
        }
      } catch {}
    })();

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
      .setDesc("Choose voice; fetch via Azure or backend depending on settings");

    let voiceDropdown: import("obsidian").DropdownComponent | null = null;
    voiceRow.addDropdown((dd) => {
      voiceDropdown = dd;
      dd.addOption(this.plugin.settings.voiceName, this.plugin.settings.voiceName);
      dd.setValue(this.plugin.settings.voiceName);
      dd.onChange(async (v) => { this.plugin.settings.voiceName = v; await this.plugin.saveSettings(); });
    });
    voiceRow.addButton((btn) =>
      btn.setButtonText("Fetch voices for region").setCta().onClick(async () => {
        try {
          let list: Array<{ ShortName?: string; Name?: string }> = [];
          if (this.plugin.settings.useBackend && this.plugin.settings.backendUrl) {
            const url = `${this.plugin.settings.backendUrl.replace(/\/$/, '')}/v1/voices?region=${encodeURIComponent(this.plugin.settings.azureRegion)}`;
            const res = await fetch(url);
            if (!res.ok) { let t = ""; try { t = await res.text(); } catch {} ; new Notice(`Voice list failed: ${res.status}${t?` - ${t}`:""}`); return; }
            const payload = await res.json();
            const items = Array.isArray(payload?.data) ? payload.data : [];
            list = items.map((v: any) => ({ ShortName: v?.shortName, Name: v?.name }));
          } else {
            if (!this.plugin.settings.azureApiKey?.trim() || !this.plugin.settings.azureRegion?.trim()) {
              new Notice("Set Azure API Key and Region first");
              return;
            }
            const url = `https://${this.plugin.settings.azureRegion}.tts.speech.microsoft.com/cognitiveservices/voices/list`;
            const res = await fetch(url, { headers: { "Ocp-Apim-Subscription-Key": this.plugin.settings.azureApiKey } });
            if (!res.ok) { let t = ""; try { t = await res.text(); } catch {} ; new Notice(`Voice list failed: ${res.status}${t?` - ${t}`:""}`); return; }
            const data = await res.json();
            list = Array.isArray(data) ? data : [];
          }

          // Build options with robust HD detection/mapping.
          // Many Azure entries for personas (e.g., Ava) do not include ":DragonHDLatestNeural" in ShortName,
          // so we map known HD personas to DragonHDLatestNeural explicitly when the toggle is enabled.
          const hdPersonas = new Set([
            'Ava','Ava3','Andrew','Andrew2','Andrew3','Aria','Brian','Davis','Emma','Emma2','Jenny','Steffan','Serena','Adam','Alloy','Nova','Phoebe',
            'Remy','Vivienne','Florian','Seraphina','Tristan','Ximena','Masaru','Nanami','Xiaochen','Yunfan','MultiTalker-Ava-Andrew'
          ]);
          const deriveLocaleAndPersona = (key: string) => {
            const m = key.match(/^([a-z]{2}-[A-Z]{2})-/);
            const locale = m ? m[1] : '';
            let rest = key.replace(/^([a-z]{2}-[A-Z]{2})-/, '');
            rest = rest.split(':')[0];
            rest = rest.replace(/Multilingual/i, '');
            rest = rest.replace(/Neural/i, '');
            return { locale, persona: rest };
          };

          const options: Record<string, string> = {};
          for (const v of list) {
            const rawKey = (v.ShortName || v.Name || '').toString();
            if (!rawKey) continue;
            if (!this.plugin.settings.onlyHdVoices) {
              options[rawKey] = rawKey;
              continue;
            }
            const isNeural = /Neural/i.test(rawKey);
            const hasDragon = /DragonHD/i.test(rawKey);
            const { locale, persona } = deriveLocaleAndPersona(rawKey);
            const isHdPersona = hdPersonas.has(persona);
            if (isNeural && (hasDragon || isHdPersona) && locale) {
              const hdKey = `${locale}-${persona}:DragonHDLatestNeural`;
              options[hdKey] = hdKey;
            }
          }
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
      .setName("Use backend (Cloudflare Workers)")
      .setDesc("Proxy via Hono API; hides Azure key and enforces limits")
      .addToggle((tg) => tg
        .setValue(!!this.plugin.settings.useBackend)
        .onChange(async (v) => { this.plugin.settings.useBackend = v; await this.plugin.saveSettings(); })
      );

    // License status row (plan/quota/expiry)
    const licenseStatus = new Setting(containerEl)
      .setName("License status")
      .setDesc("Plan, pozostałe tokeny i ważność")
      .addText((t) => {
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
    // Colored badge appended to the setting name
    try {
      const s = this.plugin.settings;
      const span = licenseStatus.nameEl.createEl('span');
      span.style.marginLeft = '8px';
      span.style.padding = '2px 6px';
      span.style.borderRadius = '6px';
      span.style.fontSize = '0.9em';
      span.style.color = '#fff';
      const hasCfg = !!s.useBackend && !!s.backendUrl && !!s.licenseKey;
      if (!hasCfg) {
        span.textContent = 'Brak konfiguracji';
        span.style.backgroundColor = '#b00020';
      } else if (typeof s.licenseQuotaRemaining === 'number' && typeof s.licenseQuotaLimit === 'number' && s.licenseQuotaLimit > 0) {
        const pct = s.licenseQuotaRemaining / s.licenseQuotaLimit;
        span.textContent = pct <= 0 ? '0%' : `${Math.round(pct * 100)}%`;
        if (pct <= 0.05) span.style.backgroundColor = '#b00020';
        else if (pct <= 0.15) span.style.backgroundColor = '#f57c00';
        else span.style.backgroundColor = '#388e3c';
      } else {
        span.textContent = 'N/D';
        span.style.backgroundColor = '#616161';
      }
    } catch {}

    // License actions (validate + usage)
    const licenseActions = new Setting(containerEl)
      .setName("Weryfikacja licencji")
      .setDesc("Sprawdź licencję i pobierz limit/pozostałe tokeny")
    licenseActions.addButton((btn) =>
      btn.setButtonText("Zweryfikuj licencję").setCta().onClick(async () => {
        try {
          if (!this.plugin.settings.useBackend || !this.plugin.settings.backendUrl || !this.plugin.settings.licenseKey) {
            new Notice("Włącz backend, ustaw URL i klucz licencyjny");
            return;
          }
          const provider = (await import("../tts/backend-provider")).BackendTtsProvider;
          const p = new provider({ backendUrl: this.plugin.settings.backendUrl!, licenseKey: this.plugin.settings.licenseKey!, region: this.plugin.settings.azureRegion });
          const v = await p.validateLicense();
          this.plugin.settings.licensePlan = v.plan;
          this.plugin.settings.licenseQuotaRemaining = v.quota_remaining;
          this.plugin.settings.licenseQuotaLimit = v.quota_limit;
          this.plugin.settings.licenseTokenExpiresAt = v.expiresAtMs;
          await this.plugin.saveSettings();
          new Notice("Licencja zweryfikowana");
          this.display();
        } catch (e: any) {
          new Notice(`Błąd weryfikacji: ${e?.message || String(e)}`);
        }
      })
    );
    licenseActions.addButton((btn) =>
      btn.setButtonText("Odśwież użycie").onClick(async () => {
        try {
          if (!this.plugin.settings.useBackend || !this.plugin.settings.backendUrl || !this.plugin.settings.licenseKey) {
            new Notice("Włącz backend, ustaw URL i klucz licencyjny");
            return;
          }
          const provider = (await import("../tts/backend-provider")).BackendTtsProvider;
          const p = new provider({ backendUrl: this.plugin.settings.backendUrl!, licenseKey: this.plugin.settings.licenseKey!, region: this.plugin.settings.azureRegion });
          const u = await p.fetchUsage();
          this.plugin.settings.licensePlan = u.plan || this.plugin.settings.licensePlan;
          this.plugin.settings.licenseQuotaRemaining = typeof u.quota_remaining === 'number' ? u.quota_remaining : this.plugin.settings.licenseQuotaRemaining;
          this.plugin.settings.licenseQuotaLimit = typeof u.quota_limit === 'number' ? u.quota_limit : this.plugin.settings.licenseQuotaLimit;
          this.plugin.settings.licenseUsagePeriod = u.period || this.plugin.settings.licenseUsagePeriod;
          await this.plugin.saveSettings();
          new Notice("Użycie odświeżone");
          this.display();
        } catch (e: any) {
          new Notice(`Błąd pobierania użycia: ${e?.message || String(e)}`);
        }
      })
    );

    new Setting(containerEl)
      .setName("Backend URL")
      .setDesc("Base URL to your Worker, e.g., https://listenmode-backend.<subdomain>.workers.dev")
      .addText((t) => t
        .setPlaceholder("https://listenmode-backend...workers.dev")
        .setValue(this.plugin.settings.backendUrl || "")
        .onChange(async (v) => { this.plugin.settings.backendUrl = v.trim(); await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName("License key")
      .setDesc("Used to obtain a short-lived JWT from backend")
      .addText((t) => t
        .setPlaceholder("LM-...-...")
        .setValue(this.plugin.settings.licenseKey || "")
        .onChange(async (v) => { this.plugin.settings.licenseKey = v.trim(); await this.plugin.saveSettings(); })
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

