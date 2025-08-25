// Minimal globals/mocks for browser APIs used in plugin tests
if (!(globalThis as any).MediaSource) {
  (globalThis as any).MediaSource = class {
    static isTypeSupported(_mime: string){ return true; }
    readyState = 'open';
    private listeners: Record<string, Array<() => void>> = {};
    addEventListener(type: string, cb: () => void, _opts?: any){
      (this.listeners[type] ||= []).push(cb);
      if (type === 'sourceopen') setTimeout(() => { for (const f of this.listeners[type] || []) f(); }, 0);
    }
    removeEventListener(type: string, cb: () => void){
      this.listeners[type] = (this.listeners[type] || []).filter(f => f !== cb);
    }
    addSourceBuffer(_mime: string){
      const evts: Record<string, Array<() => void>> = {};
      return {
        updating: false,
        addEventListener: (t: string, cb: () => void) => { (evts[t] ||= []).push(cb); },
        removeEventListener: (t: string, cb: () => void) => { evts[t] = (evts[t] || []).filter(f => f !== cb); },
        appendBuffer: (_buf: ArrayBuffer) => { setTimeout(() => { for (const f of evts['updateend'] || []) f(); }, 0); }
      } as any;
    }
    endOfStream(){ this.readyState = 'ended'; }
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

if (!(globalThis as any).URL) {
  (globalThis as any).URL = {
    createObjectURL: (_b: any) => 'blob:mock',
    revokeObjectURL: (_u: string) => {}
  } as any;
}


