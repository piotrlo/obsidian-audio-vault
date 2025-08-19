import { describe, expect, test } from "bun:test";
import { toSafeBase } from "../../src/utils/safe-name";

/**
 * Basic tests for toSafeBase utility.
 */
describe("toSafeBase", () => {
  test("normalizes and lowercases", () => {
    expect(toSafeBase("Hello World.txt")).toBe("hello-world-txt");
  });
  test("collapses dashes and trims edges", () => {
    expect(toSafeBase("--A  B__C--")).toBe("a-b__c");
  });
});

