import { Modal, Setting, type App } from "obsidian";
import {
  catalogVoiceLocale, fetchCatalogPage, normalizeVoiceLocale, sortCatalogVoices,
  type CatalogSort, type CatalogVoice,
} from "../tts/cartesia-catalog";

export class CartesiaVoiceBrowser extends Modal {
  private query = "";
  private language = "";
  private sort: CatalogSort = "recommended";
  private voices: CatalogVoice[] = [];
  private next?: string;
  private request?: AbortController;
  private timer?: number;
  private results!: HTMLElement;
  private status!: HTMLElement;
  private selecting = false;

  constructor(app: App, private readonly key: string,
    private readonly selected: { id?: string; locale?: string },
    private readonly choose: (voice: CatalogVoice, locale: string | undefined) => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("Browse Cartesia voices");
    this.contentEl.createEl("p", {
      text: "Recommended puts native accent matches and AudioVault picks first among loaded results.",
    });
    new Setting(this.contentEl).setName("Search").setDesc("Name, description, or voice ID.")
      .addText((input) => {
        input.inputEl.maxLength = 200;
        input.inputEl.setAttribute("aria-label", "Search voices");
        input.setPlaceholder("Search voices").onChange((value) => {
          this.query = value;
          this.schedule();
        });
      });
    new Setting(this.contentEl).setName("Language or accent").setDesc("Enter a code such as en, en-GB, pl, or fr. Leave blank for all.")
      .addText((input) => {
        input.inputEl.maxLength = 6;
        input.inputEl.setAttribute("aria-label", "Language or accent");
        input.setPlaceholder("All languages").onChange((value) => {
          this.language = value.trim();
          this.schedule();
        });
      });
    new Setting(this.contentEl).setName("Sort")
      .addDropdown((dropdown) => {
        dropdown.selectEl.setAttribute("aria-label", "Sort voices");
        dropdown.addOption("recommended", "Recommended")
          .addOption("name", "Name (A–Z)").addOption("cartesia", "Cartesia order")
          .setValue(this.sort).onChange((value) => {
            if (value === "recommended" || value === "name" || value === "cartesia") this.sort = value;
            this.render();
          });
      });
    this.status = this.contentEl.createDiv({ attr: { role: "status" } });
    this.results = this.contentEl.createDiv();
    void this.load();
  }

  onClose(): void {
    this.request?.abort();
    this.request = undefined;
    window.clearTimeout(this.timer);
    this.contentEl.empty();
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    this.request?.abort();
    this.request = undefined;
    this.voices = [];
    this.next = undefined;
    this.render();
    this.status.setText("Searching…");
    this.timer = window.setTimeout(() => void this.load(), 350);
  }

  private async load(cursor?: string): Promise<void> {
    const language = normalizeVoiceLocale(this.language);
    if (this.language && !language) {
      this.status.setText("Enter a language or locale code, such as pl or en-GB.");
      return;
    }
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.status.setText("Loading voices…");
    const timeout = window.setTimeout(() => request.abort(), 12_000);
    try {
      const page = await fetchCatalogPage(this.key, { query: this.query, language: language ?? "", cursor, signal: request.signal });
      if (request.signal.aborted) return;
      const unique = new Map(this.voices.map((voice) => [voice.id, voice]));
      for (const voice of page.voices) unique.set(voice.id, voice);
      this.voices = [...unique.values()];
      this.next = page.next;
      this.status.setText(this.voices.length ? `${this.voices.length} voices loaded.` : "No matching voices.");
      this.render();
    } catch (error) {
      if (this.request !== request) return;
      this.status.setText(request.signal.aborted ? "Voice search timed out." :
        error instanceof Error ? error.message : "Could not load voices.");
      if (!cursor) new Setting(this.results).addButton((button) => button.setButtonText("Retry").onClick(() => {
        this.render();
        void this.load();
      }));
    } finally {
      window.clearTimeout(timeout);
    }
  }

  private render(): void {
    this.results.empty();
    const filter = normalizeVoiceLocale(this.language) ?? "";
    for (const voice of sortCatalogVoices(this.voices, filter, this.sort)) {
      const locale = catalogVoiceLocale(voice, filter);
      const active = voice.id === this.selected.id && locale === this.selected.locale;
      new Setting(this.results).setName(voice.name)
        .setDesc([locale, voice.tagline || voice.description].filter(Boolean).join(" · ").slice(0, 250))
        .addButton((button) => button.setButtonText(active ? "Selected" : "Use voice")
          .setDisabled(active).onClick(() => {
            if (this.selecting) return;
            this.selecting = true;
            button.setDisabled(true);
            void this.choose(voice, locale).then(() => this.close()).catch(() => {
              this.status.setText("Could not save your voice selection. Try again.");
              button.setDisabled(false);
            }).finally(() => {
              this.selecting = false;
            });
          }));
    }
    const next = this.next;
    if (next) new Setting(this.results).addButton((button) => button.setButtonText("Load more").onClick(() => {
      button.setDisabled(true);
      void this.load(next).finally(() => button.setDisabled(false));
    }));
  }
}
