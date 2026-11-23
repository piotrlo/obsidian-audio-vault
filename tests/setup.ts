// Minimal globals/mocks for browser APIs used in plugin tests
// Note: we don't set MediaSource by default so tests can check for missing MSE.

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


import { mock } from "bun:test";
import * as obsidian from "./__mocks__/obsidian";

mock.module("obsidian", () => obsidian);
