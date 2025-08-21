import { test, expect } from "bun:test";
import { escapeXml, buildSsml } from "../../src/utils/ssml";

test("escapeXml escapes &, <, >", () => {
  const input = "A & B < C > D";
  const out = escapeXml(input);
  expect(out).toBe("A &amp; B &lt; C &gt; D");
});

test("buildSsml includes voice, rate and escaped text", () => {
  const ssml = buildSsml({ text: "Hello & <world>", voiceName: "en-US-ExampleNeural", rate: "+10%", lang: "en-US" });
  expect(ssml).toContain("voice name=\"en-US-ExampleNeural\"");
  expect(ssml).toContain("prosody rate=\"+10%\"");
  expect(ssml).toContain("Hello &amp; &lt;world&gt;");
});
