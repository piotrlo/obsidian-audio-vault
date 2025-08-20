/**
 * Minimal floating control panel.
 */

export type PanelCallbacks = {
  onPlayOrStart: () => void;
  onStop: () => void;
  onRefresh: () => void;
  onRateChange: (rate: number) => void;
};

/**
 * Create and manage a small UI panel with playback controls.
 */
export class ControlPanel {
  private root: HTMLElement | null = null;
  private slider: HTMLInputElement | null = null;

  /**
   * Create the panel if not present.
   *
   * @param {PanelCallbacks} cb Event callbacks.
   * @param {number} initialRate Initial playback rate.
   */
  create(cb: PanelCallbacks, initialRate: number): void {
    if (this.root) return;
    const el = document.createElement("div");
    el.setAttr(
      "style",
      "position:fixed;bottom:12px;right:12px;z-index:9999;background:var(--background-primary);border:1px solid var(--background-modifier-border);padding:6px 8px;border-radius:8px;display:flex;gap:8px;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,.15);"
    );
    const mkBtn = (label: string, title: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.title = title;
      b.setAttr("style", "padding:2px 6px;font-size:12px;");
      b.addEventListener("click", (e) => { e.preventDefault(); onClick(); });
      return b;
    };
    const playPause = mkBtn("⏯️", "Play/Pause or Start", () => cb.onPlayOrStart());
    const stop = mkBtn("⏹️", "Stop", () => cb.onStop());
    const refresh = mkBtn("🔁", "Restart", () => cb.onRefresh());

    const label = document.createElement("span");
    label.textContent = "Speed";
    label.setAttr("style", "font-size:12px;margin-left:4px;");

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0.5";
    slider.max = "2.0";
    slider.step = "0.05";
    slider.value = String(initialRate);
    slider.setAttr("style", "width:120px;");
    slider.addEventListener("input", () => cb.onRateChange(parseFloat(slider.value)));

    el.appendChild(playPause);
    el.appendChild(stop);
    el.appendChild(refresh);
    el.appendChild(label);
    el.appendChild(slider);

    document.body.appendChild(el);
    this.root = el;
    this.slider = slider;
  }

  /**
   * Destroy the panel.
   */
  destroy(): void {
    if (this.root) { this.root.detach(); this.root = null; this.slider = null; }
  }
}

