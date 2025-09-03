/**
 * Tests for schema validation and manifest handling.
 */

import { test, expect } from "bun:test";
import { manifestSchema, createValidManifest, updateManifestWithParts, safeParseManifest } from "../src/schema";
import type { AudioManifest } from "../src/types";

test("manifestSchema validates correct manifest", () => {
  const validManifest: AudioManifest = {
    version: 1,
    ext: "mp3",
    totalParts: 5,
    fetchedParts: [1, 2, 4],
    mergedUntil: 2,
    updatedAt: Date.now(),
  };

  const result = manifestSchema.safeParse(validManifest);
  expect(result.success).toBe(true);
});

test("manifestSchema rejects unsorted fetchedParts", () => {
  const invalidManifest = {
    version: 1,
    ext: "mp3",
    totalParts: 5,
    fetchedParts: [2, 1, 4], // Unsorted
    mergedUntil: 2,
    updatedAt: Date.now(),
  };

  const result = manifestSchema.safeParse(invalidManifest);
  expect(result.success).toBe(false);
});

test("createValidManifest sorts and deduplicates fetchedParts", () => {
  const input = {
    version: 1,
    ext: "mp3",
    totalParts: 5,
    fetchedParts: [3, 1, 2, 1, 3], // Unsorted with duplicates
    mergedUntil: 2,
    updatedAt: Date.now(),
  };

  const result = createValidManifest(input);
  expect(result.fetchedParts).toEqual([1, 2, 3]);
  expect(result.mergedUntil).toBe(2);
});

test("updateManifestWithParts adds new parts correctly", () => {
  const manifest: AudioManifest = {
    version: 1,
    ext: "mp3",
    totalParts: 5,
    fetchedParts: [1, 3],
    mergedUntil: 1,
    updatedAt: 1000,
  };

  const updated = updateManifestWithParts(manifest, [2, 4, 3]); // 3 is duplicate
  expect(updated.fetchedParts).toEqual([1, 2, 3, 4]);
  expect(updated.updatedAt).toBeGreaterThan(1000);
});

test("safeParseManifest handles invalid data gracefully", () => {
  const invalidData = {
    version: "not a number",
    ext: "",
    totalParts: 0,
  };

  const result = safeParseManifest(invalidData);
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues.length).toBeGreaterThan(0);
  }
});
