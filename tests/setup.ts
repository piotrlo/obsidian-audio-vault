// Minimal globals/mocks for browser APIs used in plugin tests
if (!(globalThis as any).MediaSource) {
  (globalThis as any).MediaSource = class {
    static isTypeSupported(_mime: string){ return false; }
  } as any;
}

if (!(globalThis as any).Audio) {
  (globalThis as any).Audio = class {
    src = "";
    playbackRate = 1;
    ended = false;
    duration = 0;
    currentTime = 0;
    constructor(public url?: string) {}
    play(){ return Promise.resolve(); }
    pause(){ }
    addEventListener(){ }
    removeEventListener(){ }
  } as any;
}


