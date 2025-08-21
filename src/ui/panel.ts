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
  private bodyRow: HTMLElement | null = null;
  private collapsed = false;
  private playBtn: HTMLButtonElement | null = null;
  private playMainBtn: HTMLButtonElement | null = null;
  private rateLabel: HTMLButtonElement | null = null;
  private miniBtn: HTMLButtonElement | null = null;

  /**
   * Create the panel if not present.
   *
   * @param {PanelCallbacks} cb Event callbacks.
   * @param {number} initialRate Initial playback rate.
   */
  create(cb: PanelCallbacks, initialRate: number): void {
    if (this.root) return;
    this.injectStyleIfNeeded();
    const el = document.createElement("div");
    el.className = "lm-panel";
    el.setAttr(
      "style",
      "position:fixed;bottom:31px;right:4px;z-index:9999;background:var(--background-primary);border:1px solid var(--background-modifier-border);padding:6px 10px;border-radius:12px;display:flex;gap:10px;align-items:center;box-shadow:0 6px 16px rgba(0,0,0,.2);min-width:220px;"
    );

    const body = document.createElement("div");
    body.className = "lm-row";
    body.setAttr("style", "display:flex;gap:10px;align-items:center;");

    const iconBtn = (svg: string, title: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.innerHTML = svg;
      b.title = title;
      b.className = "lm-btn lm-icon clickable-icon";
      b.addEventListener("click", (e) => { e.preventDefault(); onClick(); });
      return b;
    };
    const refresh = iconBtn(this.refreshSvg(), "Restart", () => cb.onRefresh());
    (refresh as HTMLButtonElement).classList.add("lm-icon-refresh");
    const stop = iconBtn(this.stopSvg(), "Stop", () => cb.onStop());

    const playMain = document.createElement("button");
    playMain.innerHTML = this.playCircleSvg();
    playMain.title = "Play/Pause";
    playMain.className = "lm-btn lm-play-main";
    playMain.setAttr("style", "width:38px;height:38px;border-radius:999px;display:grid;place-items:center;box-shadow:0 4px 10px rgba(0,0,0,.25);");
    playMain.addEventListener("click", (e) => { e.preventDefault(); cb.onPlayOrStart(); });

    const rate = document.createElement("button");
    rate.className = "lm-btn lm-rate clickable-icon";
    rate.title = "Speed";
    const pretty = (n: number) => `${(Math.round(n*100)/100).toFixed(2).replace(/\.00$/, "").replace(/\.(\d)$/, ".$1")}x`;
    const start = Number.isFinite(initialRate) ? initialRate : 1.1;
    rate.textContent = pretty(start);
    const presets = [0.75, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];
    rate.addEventListener("click", () => {
      const fallback = Number.isFinite(initialRate) ? initialRate : 1.1;
      const current = parseFloat(rate.textContent?.replace("x", "") || String(fallback));
      const idx = presets.findIndex((v) => Math.abs(v - current) < 0.001);
      const next = presets[(idx + 1) % presets.length];
      rate.textContent = pretty(next);
      cb.onRateChange(next);
    });
    this.playBtn = playMain; // used for playing animation class
    this.playMainBtn = playMain;
    this.rateLabel = rate;

    const collapseBtn = document.createElement("button");
    collapseBtn.innerHTML = this.chevronSvg();
    collapseBtn.title = "Collapse";
    collapseBtn.className = "lm-btn lm-icon clickable-icon";
    collapseBtn.addEventListener("click", (e) => { e.preventDefault(); this.setCollapsed(true); });

    body.appendChild(refresh);
    body.appendChild(stop);
    body.appendChild(playMain);
    body.appendChild(rate);
    body.appendChild(collapseBtn);

    el.appendChild(body);

    // Mini button for collapsed state (shown alone)
    const mini = document.createElement("button");
    mini.innerHTML = this.speakerSvg();
    mini.title = "ListenMode";
    mini.className = "lm-btn lm-mini";
    mini.setAttr("style", "display:none;position:fixed;bottom:31px;right:4px;z-index:9999;background:var(--background-primary);border:1px solid var(--background-modifier-border);padding:6px 10px;border-radius:12px;display:flex;gap:10px;align-items:center;box-shadow:0 6px 16px rgba(0,0,0,.2);");
    mini.addEventListener("click", (e) => { e.preventDefault(); this.setCollapsed(false); });
    document.body.appendChild(mini);

    document.body.appendChild(el);
    this.root = el;
    this.bodyRow = body;
    this.miniBtn = mini;
  }

  /**
   * Destroy the panel.
   */
  destroy(): void {
    if (this.root) { this.root.detach(); this.root = null; this.slider = null; this.bodyRow = null; this.collapsed = false; this.playBtn = null; this.playMainBtn = null; this.rateLabel = null; this.miniBtn = null; }
  }

  /**
   * Signal playing state to update subtle animation on the play button.
   * @param {boolean} playing Whether currently playing.
   */
  setPlaying(playing: boolean): void {
    if (this.playBtn) {
      if (playing) this.playBtn.classList.add("lm-playing"); else this.playBtn.classList.remove("lm-playing");
    }
  }

  /**
   * Inject minimal CSS for animations, once per document.
   */
  private injectStyleIfNeeded(): void {
    if (document.getElementById("lm-style")) return;
    const style = document.createElement("style");
    style.id = "lm-style";
    style.textContent = `
    @keyframes lm-pulse { 0%{ box-shadow:0 0 0 0 var(--interactive-accent, rgba(0,150,255,.35));} 70%{ box-shadow:0 0 0 6px rgba(0,0,0,0);} 100%{ box-shadow:0 0 0 0 rgba(0,0,0,0);} }
    .lm-panel { backdrop-filter: blur(6px); }
    .lm-btn { transition: background .2s ease, transform .05s ease, border-color .2s ease, color .2s ease; background: var(--background-primary); }
    .lm-btn:hover { background: var(--background-modifier-hover); }
    .lm-btn:active { transform: scale(0.98); }
    /* Make icons inherit theme icon color and opacity like other Obsidian clickable icons */
    .lm-icon { border: none; background: transparent; }
    .lm-icon svg, .lm-mini svg { width:18px; height:18px; stroke: currentColor; fill: none; }
    .lm-icon-refresh svg { width:14px; height:14px; }
    .lm-play-main { background: var(--background-primary); border: 1px solid var(--background-modifier-border); }
    .lm-play-main svg { width:18px; height:18px; stroke: none; fill: currentColor; }
    .lm-rate { font-weight: 600; background: transparent !important; border: none !important; box-shadow: none !important; }
    .lm-playing { animation: lm-pulse 1.8s ease-out infinite; border-color: var(--interactive-accent, rgba(0,150,255,.6)); color: var(--text-normal); }

    /* Collapsed: panel hides, only mini button stays */
    .lm-collapsed { background: transparent !important; border: none !important; box-shadow:none !important; padding:0 !important; }
    .lm-collapsed .lm-row { display:none !important; }
    `;
    document.head.appendChild(style);
  }

private setCollapsed(next: boolean): void {
    this.collapsed = next;
    if (!this.root) return;
    if (this.miniBtn) this.miniBtn.style.display = this.collapsed ? "grid" : "none";
    this.root.style.display = this.collapsed ? "none" : "flex";
  }

  private stopSvg(): string {
    return `<svg viewBox="0 0 24 24" stroke-width="2"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>`;
  }
  private refreshSvg(): string {
    return `<svg viewBox="0 0 24 24" stroke-width="2"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><polyline points="20 4 20 10 14 10"/></svg>`;
  }
  private playCircleSvg(): string {
    return `<svg viewBox="0 0 24 24" stroke-width="1.5"><circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.15"/><polygon points="10,8 10,16 16,12" fill="currentColor"/></svg>`;
  }
  private chevronSvg(): string {
    return `<svg viewBox="0 0 24 24" stroke-width="2"><polyline points="8 10 12 14 16 10"/></svg>`;
  }
  private speakerSvg(): string {
    return `<svg viewBox="0 0 24 24" stroke-width="2"><polygon points="5,10 9,10 13,6 13,18 9,14 5,14" fill="currentColor" opacity="0.2"/><path d="M16 10c1.333 1.333 1.333 2.667 0 4"/></svg>`;
  }
}

