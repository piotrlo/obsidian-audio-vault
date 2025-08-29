/**
 * Settings tab implementation for AudioVault.
 */

import type { App } from "obsidian";
import { Notice, PluginSettingTab, Setting, ExtraButtonComponent } from "obsidian";
import type AudioVaultPlugin from "../index";
import type { SupportedLang } from "../types";

/**
 * Build the settings tab UI.
 */
export class AudioVaultSettingsTab extends PluginSettingTab {
  private plugin: AudioVaultPlugin;
  private advancedVisible: boolean = false;

  /**
   * @param {App} app Obsidian app.
   * @param {AudioVaultPlugin} plugin Plugin instance.
   */
  constructor(app: App, plugin: AudioVaultPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const root = containerEl.createDiv();
    const content = root.createDiv({ cls: 'audiovault-content' });

    // Basic section
    this.renderBasic(content);

    // Advanced toggle row
    let advContainer: HTMLDivElement | null = null;
    let toggleBtn: ExtraButtonComponent | null = null;
    const advToggle = new Setting(content)
      .setName("Advanced options")
      .setDesc("Settings for advanced users");
    advToggle.addExtraButton((b) => {
      toggleBtn = b;
      b.setIcon(this.advancedVisible ? 'chevron-up' : 'chevron-down')
        .setTooltip(this.advancedVisible ? 'Hide advanced options' : 'Show advanced options')
        .onClick(() => {
          this.advancedVisible = !this.advancedVisible;
          if (toggleBtn) {
            toggleBtn.setIcon(this.advancedVisible ? 'chevron-up' : 'chevron-down');
            toggleBtn.setTooltip(this.advancedVisible ? 'Hide advanced options' : 'Show advanced options');
          }
          if (advContainer) advContainer.style.display = this.advancedVisible ? '' : 'none';
        });
    });

    // Advanced container (initially hidden)
    advContainer = content.createDiv();
    advContainer.style.marginTop = '8px';
    advContainer.style.display = this.advancedVisible ? '' : 'none';
    this.renderAdvanced(advContainer);
  }

  private renderBasic(containerEl: HTMLElement): void {
    containerEl.empty();
    // Auto-refresh license status on opening the tab (with basic caching)
    void (async () => {
      try {
        const s = this.plugin.settings;
        const hasBackend = !!s.useBackend && !!s.backendUrl;
        const tokenFresh = !!s.licenseTokenExpiresAt && Date.now() < (s.licenseTokenExpiresAt - 120_000);
        if (hasBackend && !tokenFresh) {
          const provider = (await import("../tts/backend-provider")).BackendTtsProvider;
          const p = new provider({ backendUrl: s.backendUrl!, licenseKey: s.licenseKey || "", clientId: s.clientId });
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
          this.display();
          return;
        }
      } catch {}
    })();

    const s0 = this.plugin.settings;
    const hasBackendCfg = !!s0.useBackend && !!s0.backendUrl;
    const tokenFresh0 = !!s0.licenseTokenExpiresAt && Date.now() < (s0.licenseTokenExpiresAt - 120_000);
    const keyMatches0 = !!s0.licenseKey && !!(s0 as any).licenseValidatedKey ? s0.licenseKey === (s0 as any).licenseValidatedKey : false;
    const autoFree0 = !s0.licenseKey && !!s0.licensePlan && tokenFresh0;
    const licenseActive0 = (!!s0.licensePlan && tokenFresh0 && keyMatches0) || autoFree0;
    const isFreePlan = (s0.licensePlan || '').toLowerCase() === 'free';

    // License CTA (show only when backend mode and license not active)
    if (this.plugin.settings.useBackend && (!licenseActive0 || isFreePlan)) {
      const licCta = new Setting(containerEl)
      .setName("AudioVault Plus — hassle-free TTS service")
      .setDesc("Free: 13 min/month to test. Basic: 133 min for $8.99/month. Skip Azure registration, API limits tracking, and complex billing. Just works.");
licCta.addButton((b) => b.setButtonText("Upgrade").setCta().onClick(() => {
        try { window.open('https://audio-vault.app/pricing', '_blank'); } catch {}
      }));
    }

    // License status with progress bar and Check button (only when backend mode & active)
    if (this.plugin.settings.useBackend && licenseActive0) {
      const licenseStatus = new Setting(containerEl)
        .setName("License status")
        .setDesc("Plan, remaining quota and expiry");
      try {
        const s = this.plugin.settings;
        const plan = s.licensePlan || 'N/D';
        const remaining = (typeof s.licenseQuotaRemaining === 'number') ? s.licenseQuotaRemaining : undefined;
        const limit = (typeof s.licenseQuotaLimit === 'number') ? s.licenseQuotaLimit : undefined;
        const tokenExpires = s.licenseTokenExpiresAt ? new Date(s.licenseTokenExpiresAt).toLocaleString() : 'N/D';

        // Active badge next to name
        const tokenFresh = !!s.licenseTokenExpiresAt && Date.now() < (s.licenseTokenExpiresAt - 120_000);
        const keyMatches = !!s.licenseKey && !!(s as any).licenseValidatedKey ? s.licenseKey === (s as any).licenseValidatedKey : true;
        const licenseActive = !!s.licensePlan && tokenFresh && keyMatches;
        if (licenseActive) {
          const badge = licenseStatus.nameEl.createEl('span');
          badge.textContent = 'Active';
          badge.style.marginLeft = '8px';
          badge.style.padding = '2px 6px';
          badge.style.borderRadius = '6px';
          badge.style.fontSize = '0.9em';
          badge.style.color = '#fff';
          badge.style.backgroundColor = '#388e3c';
        }

        // Label + progress in desc
        const label = document.createElement('div');
        const remainText = (typeof remaining === 'number' && typeof limit === 'number') ? `${remaining}/${limit}` : 'N/D';
        label.textContent = `Plan: ${plan} | Remaining: ${remainText}`;
        label.style.marginBottom = '6px';
        licenseStatus.descEl.empty();
        licenseStatus.descEl.appendChild(label);

        if (typeof limit === 'number' && limit > 0 && typeof remaining === 'number' && remaining >= 0) {
          const used = Math.max(0, limit - remaining);
          const progress = document.createElement('progress');
          progress.max = limit;
          progress.value = used;
          progress.style.width = '260px';
          licenseStatus.descEl.appendChild(progress);
        }

        // Check button (also fetch usage)
        licenseStatus.addButton((btn) =>
          btn.setButtonText("Check").onClick(async () => {
            try {
              if (!this.plugin.settings.useBackend || !this.plugin.settings.backendUrl) { new Notice("Enable Plus mode first"); return; }
              const provider = (await import("../tts/backend-provider")).BackendTtsProvider;
              const p = new provider({ backendUrl: this.plugin.settings.backendUrl!, licenseKey: this.plugin.settings.licenseKey || "", clientId: this.plugin.settings.clientId });
              // refresh token and fetch usage
              try { await p.validateLicense(); } catch {}
              const u = await p.fetchUsage();
              this.plugin.settings.licensePlan = u.plan || this.plugin.settings.licensePlan;
              this.plugin.settings.licenseQuotaRemaining = typeof u.quota_remaining === 'number' ? u.quota_remaining : this.plugin.settings.licenseQuotaRemaining;
              this.plugin.settings.licenseQuotaLimit = typeof u.quota_limit === 'number' ? u.quota_limit : this.plugin.settings.licenseQuotaLimit;
              this.plugin.settings.licenseUsagePeriod = u.period || this.plugin.settings.licenseUsagePeriod;
              await this.plugin.saveSettings();
              new Notice("Usage refreshed");
              this.display();
            } catch (e: any) {
              // Clear cached state on failure
              this.plugin.settings.licensePlan = undefined;
              this.plugin.settings.licenseQuotaRemaining = undefined;
              this.plugin.settings.licenseQuotaLimit = undefined;
              this.plugin.settings.licenseTokenExpiresAt = undefined;
              this.plugin.settings.licenseUsagePeriod = undefined;
              await this.plugin.saveSettings();
              new Notice(`Usage fetch error: ${e?.message || String(e)}`);
              this.display();
            }
          })
        );
        
        // Manage button for Basic/Pro users to open Stripe Portal using JWT cookie (no query params)
        const planLower = (s.licensePlan || '').toLowerCase();
        if (planLower === 'basic' || planLower === 'pro') {
          licenseStatus.addButton((btn) =>
            btn.setButtonText("Manage").onClick(async () => {
              try {
                const baseUrl = 'https://audio-vault.app';
                // Obtain a fresh JWT via backend provider
                const provider = (await import("../tts/backend-provider")).BackendTtsProvider;
                const p = new provider({ backendUrl: this.plugin.settings.backendUrl!, licenseKey: this.plugin.settings.licenseKey || "", clientId: this.plugin.settings.clientId });
                const v = await p.validateLicense();
                const token = v.token;
                
                // Try cookie method first
                try {
                  await fetch(`${baseUrl}/v1/auth/upgrade-cookie`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                    credentials: 'include',
                    mode: 'cors'
                  });
                  // If cookie method works, open without parameters
                  window.open(`${baseUrl}/upgrade`, '_blank');
                } catch (e) {
                  console.log('Cookie method failed, using secure hash method:', e);
                  // Fallback: create secure hash for URL
                  try {
                    const hashRes = await fetch(`${baseUrl}/v1/auth/manage-hash`, {
                      method: 'POST',
                      headers: { Authorization: `Bearer ${token}` },
                      mode: 'cors'
                    });
                    if (hashRes.ok) {
                      const hashData = await hashRes.json();
                      const hash = hashData?.data?.hash;
                      if (hash) {
                        // Open with secure hash parameter (valid for 5 minutes)
                        window.open(`${baseUrl}/upgrade?h=${hash}`, '_blank');
                      } else {
                        throw new Error('No hash in response');
                      }
                    } else {
                      throw new Error(`Hash request failed: ${hashRes.status}`);
                    }
                  } catch (hashError) {
                    console.error('Hash method also failed:', hashError);
                    new Notice('Failed to open management portal');
                  }
                }
              } catch (e) {
                console.error('Error opening manage portal:', e);
                new Notice('Failed to open management portal');
              }
            })
          );
        }
      } catch {}
    }

    // License input + actions
    if (this.plugin.settings.useBackend) {
      const licInput = new Setting(containerEl)
        .setName("License key")
        .setDesc("Paste your key to activate Plus")
        .addText((t) => t.setPlaceholder("LM-...-...").setValue(this.plugin.settings.licenseKey || "").onChange(async (v) => {
          this.plugin.settings.licenseKey = v.trim();
          await this.plugin.saveSettings();
        }));
      licInput.addButton((btn) => btn.setButtonText("Activate").setCta().onClick(async () => {
        try {
          if (!this.plugin.settings.useBackend || !this.plugin.settings.backendUrl || !this.plugin.settings.licenseKey) { new Notice("Enable Plus mode and paste your license key"); return; }
          const provider = (await import("../tts/backend-provider")).BackendTtsProvider;
          const p = new provider({ backendUrl: this.plugin.settings.backendUrl!, licenseKey: this.plugin.settings.licenseKey!, clientId: this.plugin.settings.clientId });
          const v = await p.validateLicense();
          this.plugin.settings.licensePlan = v.plan;
          this.plugin.settings.licenseQuotaRemaining = v.quota_remaining;
          this.plugin.settings.licenseQuotaLimit = v.quota_limit;
          this.plugin.settings.licenseTokenExpiresAt = v.expiresAtMs;
          try {
            const u = await p.fetchUsage();
            this.plugin.settings.licensePlan = u.plan || this.plugin.settings.licensePlan;
            this.plugin.settings.licenseQuotaRemaining = typeof u.quota_remaining === 'number' ? u.quota_remaining : this.plugin.settings.licenseQuotaRemaining;
            this.plugin.settings.licenseQuotaLimit = typeof u.quota_limit === 'number' ? u.quota_limit : this.plugin.settings.licenseQuotaLimit;
            this.plugin.settings.licenseUsagePeriod = u.period || this.plugin.settings.licenseUsagePeriod;
          } catch {}
          this.plugin.settings.licenseValidatedKey = this.plugin.settings.licenseKey;
          await this.plugin.saveSettings();
          new Notice("License validated");
          this.display();
        } catch (e: any) {
          // Clear cached state on failure
          this.plugin.settings.licensePlan = undefined;
          this.plugin.settings.licenseQuotaRemaining = undefined;
          this.plugin.settings.licenseQuotaLimit = undefined;
          this.plugin.settings.licenseTokenExpiresAt = undefined;
          this.plugin.settings.licenseUsagePeriod = undefined;
          await this.plugin.saveSettings();
          new Notice(`Validation error: ${e?.message || String(e)}`);
          this.display();
        }
      }));
    }

    // Removed separate "License verification / usage" setting; Check button moved to status row

    // Auth mode: Azure key vs Plus (license)
    new Setting(containerEl)
      .setName("Own Azure API key")
      .setDesc("Use your own Azure key (self-billed) or a simple Plus subscription with a free monthly limit")
      .addToggle((tg) => tg
        // Toggle ON means: using own Azure key → useBackend = false
        .setValue(!this.plugin.settings.useBackend)
        .onChange(async (v) => { 
          this.plugin.settings.useBackend = !v; 
          if (this.plugin.settings.useBackend) {
            this.plugin.settings.outputFormat = "audio-24khz-48kbitrate-mono-mp3";
          }
          await this.plugin.saveSettings(); 
          this.display(); 
        })
      );

    // Azure key (only in Local mode)
    if (!this.plugin.settings.useBackend) {
      new Setting(containerEl)
        .setName("Azure API key")
        .setDesc("Stored locally in plugin data")
        .addText((t) => t.setPlaceholder("••••••••").setValue(this.plugin.settings.azureApiKey).onChange(async (v) => { this.plugin.settings.azureApiKey = v.trim(); await this.plugin.saveSettings(); }));
    }

    // Speed as text input (e.g., +10%)
    new Setting(containerEl)
      .setName("Speed")
      .setDesc("Reading speed, e.g., +10% (range −100%..+500%)")
      .addText((t) => t
        .setPlaceholder("+10%")
        .setValue(this.plugin.settings.rate || "+10%")
        .onChange(async (v) => {
          const m = (v || "").match(/^-?\s*\d+\s*%$/);
          if (!m) { this.plugin.settings.rate = "+10%"; } else {
            const n = parseInt(v.replace(/%/g, '').trim(), 10);
            const clamped = Math.max(-100, Math.min(500, n));
            this.plugin.settings.rate = `${clamped >= 0 ? "+" : ""}${clamped}%`;
          }
          await this.plugin.saveSettings();
        })
      );

    // Language (optional text input)
    new Setting(containerEl)
      .setName("Language (optional override)")
      .setDesc("BCP-47 code (e.g., en-US). Leave empty for auto (PL/EN)")
      .addText((t) => t
        .setPlaceholder("e.g., en-US")
        .setValue(this.plugin.settings.languageOverride || "")
        .onChange(async (v) => { this.plugin.settings.languageOverride = v.trim(); await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName("Streaming (realtime)")
      .setDesc("Disable if playback fails on iOS")
      .addToggle((tg) => tg.setValue(this.plugin.settings.enableStreaming).onChange(async (v) => { this.plugin.settings.enableStreaming = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Merge parts into single audio file (MP3)")
      .setDesc("Saves a single merged file instead of many parts")
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.mergeParts).onChange(async (v) => { this.plugin.settings.mergeParts = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Audio folder")
      .setDesc("Target folder for generated audio files")
      .addText((t) => t.setPlaceholder("Audio").setValue(this.plugin.settings.audioFolder).onChange(async (v) => { this.plugin.settings.audioFolder = v.trim() || "Audio"; await this.plugin.saveSettings(); }));
  }

  private renderAdvanced(containerEl: HTMLElement): void {
    containerEl.empty();
    // Voice selection (Advanced)
    const voiceRow = new Setting(containerEl)
      .setName("Voice")
      .setDesc("Choose voice; fetch via backend or Azure");
    let voiceDropdown: import("obsidian").DropdownComponent | null = null;
    voiceRow.addDropdown((dd) => {
      voiceDropdown = dd;
      const current = this.plugin.settings.voiceName || "en-US-Ava3:DragonHDLatestNeural";
      dd.addOption(current, current);
      dd.setValue(current);
      dd.onChange(async (v) => { this.plugin.settings.voiceName = v; await this.plugin.saveSettings(); });
    });
    voiceRow.addButton((btn) => btn.setButtonText("Fetch voices").setCta().onClick(async () => {
      try {
        let list: Array<{ ShortName?: string; Name?: string; VoiceType?: string }>; list = [];
        if (this.plugin.settings.useBackend && this.plugin.settings.backendUrl) {
          const url = `${this.plugin.settings.backendUrl!.replace(/\/$/, '')}/v1/voices`;
          const res = await fetch(url);
          if (!res.ok) { let t = ""; try { t = await res.text(); } catch {} ; new Notice(`Voice list failed: ${res.status}${t?` - ${t}`:""}`); return; }
          const payload = await res.json();
          const items: Array<{ name?: string; shortName?: string }> = Array.isArray(payload?.data) ? payload.data : [];
          list = items.map(v => ({ Name: v?.name, ShortName: v?.shortName }));
        } else {
          const apiKey = this.plugin.settings.azureApiKey?.trim();
          const region = (this.plugin.settings as any).azureRegion || 'westeurope';
          if (!apiKey) { new Notice("Set Azure API key first"); return; }
          const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`;
          const res = await fetch(url, { headers: { "Ocp-Apim-Subscription-Key": apiKey } });
          if (!res.ok) { let t = ""; try { t = await res.text(); } catch {} ; new Notice(`Voice list failed: ${res.status}${t?` - ${t}`:""}`); return; }
          const data = await res.json();
          list = Array.isArray(data) ? data : [];
        }

        const options: Record<string, string> = {};
        for (const v of list) {
          const key = String(v.ShortName || v.Name || "");
          if (!key) continue;
          const isNeural = /Neural/i.test(key);
          const isMultilingual = /MultilingualNeural/i.test(key);
          if (isNeural && isMultilingual) options[key] = key;
        }
        if (voiceDropdown) {
          while (voiceDropdown.selectEl.firstChild) voiceDropdown.selectEl.removeChild(voiceDropdown.selectEl.firstChild);
          const entries = Object.entries(options);
          if (entries.length === 0) {
            const all: Record<string, string> = {};
            for (const v of list) { const k = String(v.ShortName || v.Name || ""); if (k) all[k] = k; }
            Object.entries(all).forEach(([k, label]) => voiceDropdown!.addOption(k, label));
          } else {
            entries.forEach(([k, label]) => voiceDropdown!.addOption(k, label));
          }
          const preferred = this.plugin.settings.voiceName;
          const canKeep = preferred && (options[preferred] || true);
          if (canKeep) voiceDropdown.setValue(preferred);
          else {
            const first = (Object.keys(options).length ? Object.keys(options)[0] : (list.length ? String(list[0].ShortName || list[0].Name || "") : ""));
            if (first) { voiceDropdown.setValue(first); this.plugin.settings.voiceName = first; await this.plugin.saveSettings(); }
          }
        }
        new Notice(`Voices loaded: ${Object.keys(options).length || list.length}`);
      } catch (e: any) {
        new Notice(`Voice list error: ${e?.message || String(e)}`);
      }
    }));

    new Setting(containerEl)
      .setName("TTS provider")
      .setDesc("Currently available: Azure")
      .addDropdown((dd) => { dd.addOption("azure", "Azure"); dd.setValue(this.plugin.settings.ttsProvider || "azure"); dd.onChange(async (v) => { this.plugin.settings.ttsProvider = v as any; await this.plugin.saveSettings(); }); });

    new Setting(containerEl)
      .setName("Output format")
      .setDesc(this.plugin.settings.useBackend ? "MP3 format enforced in Plus mode" : "e.g., audio-24khz-48kbitrate-mono-mp3")
      .addText((t) => {
        t.setPlaceholder("audio-24khz-48kbitrate-mono-mp3")
          .setValue(this.plugin.settings.outputFormat)
          .onChange(async (v) => { this.plugin.settings.outputFormat = v.trim(); await this.plugin.saveSettings(); });
        if (this.plugin.settings.useBackend) {
          t.setDisabled(true);
          t.setValue("audio-24khz-48kbitrate-mono-mp3");
        }
      });

    new Setting(containerEl)
      .setName("Chunk size (characters)")
      .setDesc("Max chars per part (500–9000)")
      .addText((t) => t.setPlaceholder("5000").setValue(String(this.plugin.settings.chunkSize || 5000)).onChange(async (v) => {
        const n = Math.floor(Number(v));
        const clamped = isFinite(n) ? Math.max(500, Math.min(9000, n)) : 5000;
        this.plugin.settings.chunkSize = clamped; await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Debug logs")
      .setDesc("Verbose logs in console")
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.debugLogs).onChange(async (v) => { this.plugin.settings.debugLogs = v; await this.plugin.saveSettings(); try { (await import("../utils/logger")).setDebugLogging(v); } catch {} }));

    const reset = new Setting(containerEl)
      .setName("Restore defaults")
      .setDesc("Reset settings to default values");
    reset.addButton((b) => b.setButtonText("Reset").onClick(async () => {
      try {
        const { DEFAULT_SETTINGS } = await import('../core/settings');
        const keep = { licenseKey: this.plugin.settings.licenseKey, clientId: this.plugin.settings.clientId } as any;
        this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS, keep);
        await this.plugin.saveSettings();
        new Notice('Settings restored');
        this.display();
      } catch (e: any) { new Notice(`Restore failed: ${e?.message || String(e)}`); }
    }));
  }
}

