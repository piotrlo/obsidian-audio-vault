import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the retired floating panel is not part of the scanned source", () => {
  expect(existsSync(new URL("../src/ui/panel.ts", import.meta.url))).toBe(false);
});

test("the release uses Obsidian's default entry point and matching version metadata", () => {
  const manifest = JSON.parse(read("manifest.json"));
  expect(manifest).not.toHaveProperty("main");
  expect(JSON.parse(read("package.json")).version).toBe(manifest.version);
  expect(JSON.parse(read("versions.json"))[manifest.version]).toBe(manifest.minAppVersion);
});
