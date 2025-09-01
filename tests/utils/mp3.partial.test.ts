import { test, expect } from "bun:test";
import { Mp3Assembler, buildPartialSnapshot } from "../../src/utils/mp3";

test("buildPartialSnapshot returns concatenated bytes as ArrayBuffer", () => {
  const asm = new Mp3Assembler();
  asm.append(new Uint8Array([1,2]));
  asm.append(new Uint8Array([3]));
  const ab = buildPartialSnapshot(asm);
  const out = Array.from(new Uint8Array(ab));
  expect(out).toEqual([1,2,3]);
});


