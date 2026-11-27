import { Modal, Setting, type App, type ButtonComponent } from "obsidian";
import welcome from "./first-listen-audio.json";

const accountUrl = "https://play.cartesia.ai/";
const keysUrl = "https://play.cartesia.ai/keys";

type FirstListenOptions = {
  autoplay: boolean;
  saveKey: (key: string) => void;
  listen: () => void;
  closed: () => void;
};

export class FirstListenModal extends Modal {
  private sample?: HTMLAudioElement;

  constructor(app: App, private readonly options: FirstListenOptions) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Listen to your first note");
    this.contentEl.createEl("p", {
      text: "AudioVault reads your notes aloud with Cartesia. Set up a free Cartesia account to get started.",
    });
    const sampleLabel = this.contentEl.createEl("p", { text: "Audio setup guide" });
    const sample = this.sample = this.contentEl.createEl("audio", {
      attr: {
        "aria-label": "Audio setup guide",
        controls: "",
        preload: "none",
        src: `data:audio/mpeg;base64,${welcome.mp3Base64}`,
      },
    });
    if (this.options.autoplay) {
      void sample.play().catch(() => {
        if (this.sample === sample) sampleLabel.setText("Press play to hear the setup guide.");
      });
    }

    this.contentEl.createEl("p", {
      text: "When you generate audio, the readable text of your note is sent to Cartesia and uses credits from your account. Playing saved MP3s uses no credits.",
    });
    this.addExternalLink(this.contentEl, "Create a Cartesia account", accountUrl);
    const setup = this.contentEl.createDiv();
    new Setting(setup).addButton((button) => button.setButtonText("I have an account").setCta()
      .onClick(() => this.showKeySetup(setup)));
  }

  onClose(): void {
    this.sample?.pause();
    this.sample?.removeAttribute("src");
    this.sample?.load();
    this.sample = undefined;
    this.contentEl.empty();
    this.options.closed();
  }

  private showKeySetup(container: HTMLElement): void {
    container.empty();
    this.addExternalLink(container, "Create an API key in Cartesia", keysUrl);
    let key = "";
    let save: ButtonComponent | undefined;
    new Setting(container)
      .setName("Cartesia API key")
      .setDesc("Paste the key here to connect AudioVault to your account. It stays on this device.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
        text.inputEl.setAttribute("aria-label", "Cartesia API key");
        text.setPlaceholder("Paste your API key").onChange((value) => {
          key = value.trim();
          save?.setDisabled(!key);
        });
        text.inputEl.focus();
      })
      .addButton((button) => {
        save = button;
        button.setButtonText("Save key").setDisabled(true).onClick(() => {
          if (!key) return;
          this.options.saveKey(key);
          container.empty();
          new Setting(container).addButton((listen) => {
            listen.setButtonText("Listen to this note").setCta().onClick(() => {
              this.close();
              this.options.listen();
            });
            listen.buttonEl.focus();
          });
        });
      });
  }

  private addExternalLink(container: HTMLElement, text: string, href: string): void {
    container.createEl("p").createEl("a", {
      text,
      href,
      cls: "external-link",
      attr: { target: "_blank", rel: "noopener noreferrer" },
    });
  }
}
