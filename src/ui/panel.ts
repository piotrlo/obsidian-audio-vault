/**
 * Minimal floating control panel.
 */

export type PanelCallbacks = {
  onPlayOrStart: () => void;
  onStop: () => void;
  onRefresh: () => void;
  onRateChange: (rate: number) => void;
  onPositionChange?: (position: { x: number; y: number }) => void;
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
  private callbacks: PanelCallbacks | null = null;
  private currentPosition: { x: number; y: number } | null = null;
  private modalObserver: MutationObserver | null = null;

  /** Update z-index to be below settings modal when open, otherwise above content. */
  private updateZIndexBasedOnModal(): void {
    const modalPresent = !!document.querySelector('.modal-container, .modal-bg, .modal');
    const z = modalPresent ? 500 : 9999;
    if (this.root) this.root.style.zIndex = String(z);
    if (this.miniBtn) this.miniBtn.style.zIndex = String(z);
  }

  /**
   * Create the panel if not present.
   *
   * @param {PanelCallbacks} cb Event callbacks.
   * @param {number} initialRate Initial playback rate.
   * @param {object} position Optional initial position {x, y}.
   */
  create(cb: PanelCallbacks, initialRate: number, position?: { x: number; y: number }): void {
    if (this.root) return;
    this.injectStyleIfNeeded();
    const el = document.createElement("div");
    el.className = "lm-panel";
    // Apply position if provided, otherwise use default
    let positionStyle = "position:fixed;bottom:80px;right:4px;";
    if (position) {
      positionStyle = `position:fixed;left:${position.x}px;top:${position.y}px;`;
      this.currentPosition = position;
    }

    el.setAttr(
      "style",
      `${positionStyle}z-index:9999;background:var(--background-primary);border:1px solid var(--background-modifier-border);padding:6px 10px;border-radius:12px;display:flex;gap:10px;align-items:center;box-shadow:0 6px 16px rgba(0,0,0,.2);min-width:220px;cursor:grab;user-select:none;pointer-events:auto;`
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

    // Mini button uses same position as main panel
    let miniPositionStyle = "display:none;position:fixed;bottom:80px;right:4px;";
    if (position) {
      miniPositionStyle = `display:none;position:fixed;left:${position.x}px;top:${position.y}px;`;
    }

    mini.setAttr("style", `${miniPositionStyle}z-index:9999;background:var(--background-primary);border:1px solid var(--background-modifier-border);padding:6px 10px;border-radius:12px;display:flex;gap:10px;align-items:center;box-shadow:0 6px 16px rgba(0,0,0,.2);cursor:grab;user-select:none;pointer-events:auto;`);
    mini.addEventListener("click", (e) => { e.preventDefault(); this.setCollapsed(false); });
    document.body.appendChild(mini);

    document.body.appendChild(el);
    this.root = el;
    this.bodyRow = body;
    this.miniBtn = mini;
    this.callbacks = cb;

    // Make panel draggable
    this.makeDraggable(el);
    if (mini) this.makeDraggable(mini);

    // Clamp saved position into current viewport (desktop -> mobile, rotation, etc.)
    this.clampToViewport();
    // Re-clamp on viewport/rotation changes
    window.addEventListener('resize', this._onResize);
    // orientationchange may not exist everywhere
    try { (window as any).addEventListener('orientationchange', this._onResize); } catch {}

    // Adjust stacking relative to settings modal
    this.updateZIndexBasedOnModal();
    if (!this.modalObserver) {
      this.modalObserver = new MutationObserver(() => this.updateZIndexBasedOnModal());
      this.modalObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  /**
   * Destroy the panel.
   */
  destroy(): void {
    try { this.modalObserver?.disconnect(); } catch {}
    this.modalObserver = null;
    if (this.miniBtn) { this.miniBtn.detach(); }
    if (this.root) { this.root.detach(); }
    // Remove listeners
    window.removeEventListener('resize', this._onResize);
    try { (window as any).removeEventListener('orientationchange', this._onResize); } catch {}
    this.root = null; this.slider = null; this.bodyRow = null; this.collapsed = false; this.playBtn = null; this.playMainBtn = null; this.rateLabel = null; this.miniBtn = null; this.callbacks = null; this.currentPosition = null;
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
    .lm-panel {
      backdrop-filter: blur(6px);
      z-index: 500;
      pointer-events: auto;
    }
    .lm-mini {
      z-index: 500;
      pointer-events: auto;
    }
    .lm-btn {
      transition: background .2s ease, transform .05s ease, border-color .2s ease, color .2s ease;
      background: var(--background-primary);
      user-select: none;
    }
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

    /* Mobile-specific styles */
    @media (max-width: 768px) {
      .lm-panel, .lm-mini {
        z-index: 501;
        position: fixed;
        touch-action: none;
      }
    }
    `;
    document.head.appendChild(style);
  }

private setCollapsed(next: boolean): void {
    this.collapsed = next;
    if (!this.root) return;
    if (this.miniBtn) this.miniBtn.style.display = this.collapsed ? "grid" : "none";
    this.root.style.display = this.collapsed ? "none" : "flex";
  }

  /**
   * Make panel draggable on touch and mouse devices
   */
  private makeDraggable(element: HTMLElement): void {
    let isDragging = false;
    let startX = 0, startY = 0;
    let currentX = 0, currentY = 0;
    let hasMoved = false; // Track if element has actually moved

    const handleStart = (e: TouchEvent | MouseEvent) => {
      isDragging = true;
      hasMoved = false;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      const rect = element.getBoundingClientRect();
      startX = clientX - rect.left;
      startY = clientY - rect.top;

      element.style.cursor = 'grabbing';
      element.style.transition = 'none'; // Disable transitions during drag
      e.preventDefault();
    };

    const handleMove = (e: TouchEvent | MouseEvent) => {
      if (!isDragging) return;

      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      currentX = clientX - startX;
      currentY = clientY - startY;

      // Constrain to viewport bounds
      const maxX = window.innerWidth - element.offsetWidth;
      const maxY = window.innerHeight - element.offsetHeight;

      currentX = Math.max(0, Math.min(maxX, currentX));
      currentY = Math.max(0, Math.min(maxY, currentY));

      element.style.left = currentX + 'px';
      element.style.top = currentY + 'px';
      element.style.right = 'auto';
      element.style.bottom = 'auto';

      // Update both panel and mini button positions
      this.updatePosition({ x: currentX, y: currentY });

      hasMoved = true;
      e.preventDefault();
    };

    const handleEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      element.style.cursor = 'grab';
      element.style.transition = ''; // Re-enable transitions

      // Save position for persistence only if it actually moved
      if (hasMoved && this.callbacks?.onPositionChange) {
        this.callbacks.onPositionChange({ x: currentX, y: currentY });
      }

      // Prevent click event if we were dragging
      if (hasMoved) {
        const preventClick = (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
          element.removeEventListener('click', preventClick, { capture: true });
        };
        element.addEventListener('click', preventClick, { capture: true, once: true });
      }
    };

    // Touch events
    element.addEventListener('touchstart', handleStart, { passive: false });
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);
    document.addEventListener('touchcancel', handleEnd);

    // Mouse events (desktop)
    element.addEventListener('mousedown', handleStart);
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);

    // Visual feedback
    element.style.cursor = 'grab';
  }

  /**
   * Update position for both panel and mini button
   */
  private updatePosition(position: { x: number; y: number }): void {
    this.currentPosition = position;

    // Update main panel position
    if (this.root) {
      this.root.style.left = position.x + 'px';
      this.root.style.top = position.y + 'px';
      this.root.style.right = 'auto';
      this.root.style.bottom = 'auto';
    }

    // Update mini button position to match
    if (this.miniBtn) {
      this.miniBtn.style.left = position.x + 'px';
      this.miniBtn.style.top = position.y + 'px';
      this.miniBtn.style.right = 'auto';
      this.miniBtn.style.bottom = 'auto';
    }
  }

  /** Resize handler to keep the panel within viewport on device changes. */
  private _onResize = (): void => {
    this.clampToViewport();
  };

  /**
   * Clamp current saved position to fit within the current viewport and apply it.
   * If no saved position exists, keep default bottom/right positioning.
   */
  private clampToViewport(): void {
    if (!this.root) return;
    if (!this.currentPosition) return;
    const width = this.root.offsetWidth || 240;
    const height = this.root.offsetHeight || 56;
    const maxX = Math.max(0, window.innerWidth - width);
    const maxY = Math.max(0, window.innerHeight - height);
    const x = Math.max(0, Math.min(maxX, this.currentPosition.x));
    const y = Math.max(0, Math.min(maxY, this.currentPosition.y));
    this.updatePosition({ x, y });
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

