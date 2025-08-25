import { describe, it, expect, spyOn } from 'bun:test';
import { playStreamedPartAndSave } from '../../src/playback/streaming';

function readableFromChunks(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    }
  });
}

describe('streaming save guard', () => {
  it('skips saving/linking when blob is empty', async () => {
    const provider = {
      synthesize: async () => readableFromChunks([]),
      listVoices: async () => []
    } as any;
    const writeBinary = spyOn({ f: async () => {} }, 'f');
    const upsert = spyOn({ f: async () => {} }, 'f');
    const app = {} as any;
    const file = {} as any;

    await playStreamedPartAndSave({
      app,
      settings: { outputFormat: 'audio-24khz-48kbitrate-mono-mp3', rate: '+0%' } as any,
      provider,
      ssml: '<speak/>',
      base: 'note',
      part: 1,
      folder: 'Audio',
      file,
      abort: new AbortController(),
      setSession: () => {},
      savePerPart: true
    });

    expect(writeBinary).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});


