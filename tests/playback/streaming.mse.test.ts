import { describe, it, expect } from "bun:test";
import { playStreamedPartAndSave } from "../../src/playback/streaming";

function makeEnv(){
  const written: Array<{ path: string; buf: ArrayBuffer }> = [];
  const refs: string[] = [];
  const app: any = { vault: { adapter: { writeBinary: async (p: string, b: ArrayBuffer) => { written.push({ path: p, buf: b }); } }, read: async () => "", modify: async (_f: any, _c: string) => {} } };
  const file: any = { path: "Note.md" };
  return { app, file, written, refs };
}

describe("playback/streaming MSE success", () => {
  it("streams via MediaSource/SourceBuffer and saves part", async () => {
    const { app, file, written } = makeEnv();

    const chunks: Uint8Array[] = [new Uint8Array([1,2,3]), new Uint8Array([4,5])];
    const stream = new ReadableStream<Uint8Array>({
      start(controller){
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      }
    });

    const provider = { synthesize: async () => stream } as any;
    const abort = new AbortController();

    // Mock MSE fully
    class MockSourceBuffer {
      updating = false;
      private listeners: Record<string, Function[]> = {};
      appendBuffer(_b: ArrayBuffer){
        setTimeout(() => { this.emit('updateend'); }, 0);
      }
      addEventListener(ev: string, cb: any){ (this.listeners[ev] ||= []).push(cb); }
      emit(ev: string){ for (const cb of this.listeners[ev] || []) cb(); }
    }
    class MockMediaSource {
      readyState = "open";
      private listeners: Record<string, Function[]> = {};
      constructor(){
        setTimeout(() => this.open(), 0);
      }
      addEventListener(ev: string, cb: any){ (this.listeners[ev] ||= []).push(cb); }
      addSourceBuffer(_mime: string){ return new MockSourceBuffer() as any; }
      endOfStream(){}
      open(){ for (const cb of this.listeners['sourceopen'] || []) cb(); }
    }
    (globalThis as any).MediaSource = MockMediaSource as any;
    (globalThis as any).URL = { createObjectURL: () => "blob:mock" } as any;
    (globalThis as any).Audio = class {
      playbackRate = 1;
      private listeners: Record<string, Function[]> = {};
      constructor(public url?: string){}
      addEventListener(ev: string, cb: any){ (this.listeners[ev] ||= []).push(cb); }
      removeEventListener(){}
      play(){
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            for (const cb of this.listeners['ended'] || []) cb();
            resolve();
          }, 0);
        });
      }
      pause(){}
    } as any;

    const settings = { outputFormat: 'audio-24khz-48kbitrate-mono-mp3', rate: 0 } as any;
    const setSession = (_s: any) => {};

    await playStreamedPartAndSave({ app, settings, provider, ssml: '<speak>x</speak>', base: 'base', part: 1, folder: 'Audio', file, abort, setSession, savePerPart: true });
    expect(written.length).toBe(1);
    expect(written[0].path.endsWith('base_part_1.mp3')).toBe(true);
  });
});


