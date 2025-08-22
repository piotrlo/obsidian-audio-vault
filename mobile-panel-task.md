## Implementacja hybrydowego podejścia z Ribbon Menu + Draggable Panel

**TAK, jest możliwość przenoszenia floating buttonu poprzez przytrzymanie palcem!** Oto kompletny plan implementacji:

### 1. Ribbon Menu Integration

Dodaj do `index.ts` w `onload()`:

```typescript
// Add ribbon icon for panel toggle
this.addRibbonIcon('headphones', 'Toggle ListenMode Panel', () => {
    if (this.settings.showControls) {
        this.destroyPanel();
    } else {
        this.ensurePanel();
    }
    this.settings.showControls = !this.settings.showControls;
    void this.saveSettings();
});
```

### 2. Panel Repositioning 

W `panel.ts`, zmień pozycję z `bottom: 31px` na `bottom: 80px`:

```typescript
el.setAttr(
    "style",
    "position:fixed;bottom:80px;right:4px;z-index:9999;..." // Zmiana z 31px na 80px
);
```

### 3. Draggable Functionality - Touch Support

Dodaj do `panel.ts` obsługę przeciągania:

```typescript
/**
 * Make panel draggable on touch and mouse devices
 */
private makeDraggable(element: HTMLElement): void {
    let isDragging = false;
    let startX = 0, startY = 0;
    let currentX = 0, currentY = 0;
    
    const handleStart = (e: TouchEvent | MouseEvent) => {
        isDragging = true;
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches.clientY : e.clientY;
        
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
        const clientY = 'touches' in e ? e.touches.clientY : e.clientY;
        
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
        
        e.preventDefault();
    };
    
    const handleEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        element.style.cursor = 'grab';
        element.style.transition = ''; // Re-enable transitions
        
        // Save position for persistence
        if (this.onPositionChange) {
            this.onPositionChange({ x: currentX, y: currentY });
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
```

### 4. Position Persistence

Rozszerz `TtsSettings` w `types.ts`:

```typescript
export interface TtsSettings {
    // ... existing settings
    panelPosition?: { x: number; y: number };
}
```

Aktualizuj `PanelCallbacks`:

```typescript
export type PanelCallbacks = {
    onPlayOrStart: () => void;
    onStop: () => void;
    onRefresh: () => void;
    onRateChange: (rate: number) => void;
    onPositionChange?: (position: { x: number; y: number }) => void; // Nowe
};
```

### 5. Integration w main plugin

W `index.ts`, aktualizuj `ensurePanel()`:

```typescript
ensurePanel(): void {
    this.panel.create({
        onPlayOrStart: () => this.playOrStart(),
        onStop: () => { void this.stopPlayback(); },
        onRefresh: () => { void this.readCurrentNote(true); },
        onRateChange: (rate) => this.setPlaybackRate(rate),
        onPositionChange: (pos) => {
            this.settings.panelPosition = pos;
            void this.saveSettings();
        }
    }, 
    this.getPlaybackRateFromRateSetting(this.settings.rate),
    this.settings.panelPosition // Pass saved position
    );
}
```

### Korzyści tego rozwiązania:

**✅ Mobile Experience:**
- Ribbon dostępny przez menu trzech kropek (1-click)
- Panel ponad dolną belką nawigacyjną
- **Touch drag** - przesuń palcem w dowolne miejsce
- Automatyczne ograniczenie do granic ekranu

**✅ Desktop Experience:**  
- Ribbon zawsze widoczny
- Panel przeciągalny myszą
- Pozycja zapisywana między sesjami

**✅ Obsidian Guidelines Compliance:**
- Używa natywnego `addRibbonIcon()` API[1]
- Nie koliduje z systemowymi elementami UI
- Konsystentne z innymi pluginami

Ta implementacja rozwiązuje problem nakładania się na menu mobilne i dodaje funkcjonalność drag-and-drop, którą znasz z innych aplikacji mobilnych.

[1] https://docs.obsidian.md/Reference/TypeScript+API/Plugin/addRibbonIcon
[2] https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/26496712/56daca14-c5e1-4fee-8a39-a649bf917fcf/spec-then-code-plan.md
[3] https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/26496712/d8ebfd76-9b52-4df1-8425-84687fc4db19/spec-then-code.md
[4] https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/26496712/413051b2-b3da-4663-a11f-c6214f8d9fe7/index.ts
[5] https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/26496712/4aa63d51-14ad-4196-ab84-b2a6d5198689/panel.ts
[6] https://docs.obsidian.md/Plugins/User+interface/Icons
[7] https://www.codeproject.com/Articles/1091766/Add-support-for-standard-HTML-Drag-and-Drop-operat?PageFlow=Fluid
[8] https://www.geeksforgeeks.org/flutter/flutter-draggable-floating-action-button/
[9] https://forum.obsidian.md/t/using-the-addicon-functionality-for-custom-ribbon-icons/64601
[10] https://www.npmjs.com/package/drag-drop-touch
[11] https://stackoverflow.com/questions/46370836/android-movable-draggable-floating-action-button-fab
[12] https://github.com/drag-drop-touch-js/dragdroptouch
[13] https://www.youtube.com/watch?v=DJNkkIW0DFg
[14] https://forum.obsidian.md/t/how-to-call-an-added-command-from-ribbon-icon-click/44288
[15] https://blog.pixelfreestudio.com/advanced-techniques-for-using-html5-drag-and-drop/
[16] https://horuskol.net/blog/2020-08-15/drag-and-drop-elements-on-touch-devices