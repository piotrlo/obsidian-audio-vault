import type { TtsProvider, TtsSettings } from "../types";
import { buildSsml } from "../utils/ssml";

export function synthesisInput(provider: TtsProvider, text: string, settings: TtsSettings, lang: string): string {
  return provider.inputType === "text" ? text : buildSsml({
    text, lang, voiceName: settings.voiceName, rate: settings.rate,
  });
}
