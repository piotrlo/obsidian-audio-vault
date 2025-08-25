// Minimal globals/mocks for browser APIs used in plugin tests
// Uwaga: nie ustawiamy domyślnie MediaSource, aby testy mogły sprawdzić brak MSE.

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


