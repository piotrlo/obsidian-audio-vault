import { expect, test } from "bun:test";
import { sortGeneratedAudioLines } from "../../src/core/helpers";

test("sortGeneratedAudioLines orders by part number and keeps non-matching last", () => {
  const lines = [
    "Generated audio: [[Audio/note_part_10.mp3]]",
    "Generated audio: [[Audio/note_part_2.mp3]]",
    "Generated audio: [[Audio/note_part_1.wav]]",
    "Generated audio: [[Audio/other-file.mp3]]",
  ];
  const sorted = sortGeneratedAudioLines(lines);
  expect(sorted[0]).toContain("_part_1.");
  expect(sorted[1]).toContain("_part_2.");
  expect(sorted[2]).toContain("_part_10.");
  // Non-matching goes to the end (MAX_SAFE_INTEGER)
  expect(sorted[3]).toContain("other-file");
});
