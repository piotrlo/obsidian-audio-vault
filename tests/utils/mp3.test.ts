import { describe, it, expect } from "bun:test";
import { stripId3v2, Mp3Assembler } from "../../src/utils/mp3";

function makeId3v2(size: number): Uint8Array {
  const buf = new Uint8Array(10 + size);
  buf[0] = 0x49; buf[1] = 0x44; buf[2] = 0x33; // 'ID3'
  // synchsafe size
  buf[6] = (size >> 21) & 0x7f;
  buf[7] = (size >> 14) & 0x7f;
  buf[8] = (size >> 7) & 0x7f;
  buf[9] = size & 0x7f;
  for (let i = 10; i < 10 + size; i++) buf[i] = 0xff; // payload dummy
  return buf;
}

describe("mp3 utils", () => {
  it("stripId3v2 removes header", () => {
    const id3 = makeId3v2(20);
    const audio = new Uint8Array([0,1,2,3,4,5]);
    const combined = new Uint8Array(id3.byteLength + audio.byteLength);
    combined.set(id3, 0);
    combined.set(audio, id3.byteLength);
    const out = stripId3v2(combined);
    expect(out.length).toBe(audio.length);
    expect(Array.from(out)).toEqual(Array.from(audio));
  });

  it("Mp3Assembler concatenates parts", () => {
    const a = new Uint8Array([1,2]);
    const b = new Uint8Array([3,4,5]);
    const asm = new Mp3Assembler();
    asm.append(a);
    asm.append(b);
    const out = asm.build();
    expect(Array.from(out)).toEqual([1,2,3,4,5]);
  });
});


