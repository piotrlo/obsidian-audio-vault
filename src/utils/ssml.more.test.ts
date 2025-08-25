import { describe, it, expect } from "bun:test";
import { escapeXml, deriveLangFromVoiceName, buildSsml } from "./ssml";

describe("utils/ssml", () => {
  it("escapeXml escapes &, <, >", () => {
    expect(escapeXml("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });
  it("deriveLangFromVoiceName extracts tag", () => {
    expect(deriveLangFromVoiceName("en-US-AvaNeural")).toBe("en-US");
    expect(deriveLangFromVoiceName("Ava:DragonHDLatestNeural")).toBe(null);
  });
  it("buildSsml produces xml with voice and rate", () => {
    const ssml = buildSsml({ text: "Hello & <you>", voiceName: "en-US-AvaNeural", rate: "+10%", lang: "en-US" });
    expect(ssml).toContain("<voice name=\"en-US-AvaNeural\">");
    expect(ssml).toContain("&amp; &lt;you&gt;");
  });
});


