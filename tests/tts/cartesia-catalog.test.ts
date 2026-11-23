import { expect, mock, test } from "bun:test";
import { resolveLang } from "../../src/core/helpers";
import { loadTtsSettings } from "../../src/core/settings";
import { catalogVoiceLocale, fetchCatalogPage, sortCatalogVoices } from "../../src/tts/cartesia-catalog";
import { CARTESIA_VOICES } from "../../src/tts/cartesia-provider";

const curated = { id: CARTESIA_VOICES[0].shortName, name: "Jacqueline", language: "en" };
const native = { id: "voice-native", name: "Zofia", accents: [{ locale: "pl-PL", is_native: true }] };
const other = { id: "voice-other", name: "Anya", accents: [{ locale: "pl-PL", is_native: false }] };

test("sorts by native accent and curated picks, name, or original order", () => {
  const voices = [other, curated, native];
  expect(sortCatalogVoices(voices, "pl", "recommended")).toEqual([native, curated, other]);
  expect(sortCatalogVoices(voices, "pl", "name")).toEqual([other, curated, native]);
  expect(sortCatalogVoices(voices, "pl", "cartesia")).toEqual(voices);
  expect(catalogVoiceLocale({ ...curated, accents: [
    { locale: "en-US", is_native: true }, { locale: "en-GB", is_native: false },
  ] }, "en-GB")).toBe("en-GB");
});

test("keeps catalog choices across reloads and gives the manual override priority", () => {
  const settings = loadTtsSettings({
    cartesiaVoiceId: "voice-custom", cartesiaVoiceLabel: "A Voice", cartesiaVoiceLocale: "fr_fr",
  });
  expect(settings.cartesiaVoiceId).toBe("voice-custom");
  expect(settings.cartesiaVoiceLabel).toBe("A Voice");
  expect(resolveLang("Example note", settings)).toBe("fr-FR");
  expect(resolveLang("Example note", { ...settings, languageOverride: "pl-PL" })).toBe("pl-PL");
  expect(loadTtsSettings({ cartesiaVoiceId: "invalid id" }).cartesiaVoiceId).toBe(curated.id);
});

test("searches Cartesia directly with a language filter and pagination cursor", async () => {
  const original = globalThis.fetch;
  const fetcher = mock(async () => Response.json({ data: [native], has_more: true, next_page: native.id }));
  globalThis.fetch = fetcher as unknown as typeof fetch;
  try {
    const signal = new AbortController().signal;
    const page = await fetchCatalogPage(" test-key ", { query: " A & B ", language: "pl", cursor: "voice-previous", signal });
    expect(page).toEqual({ voices: [native], next: native.id });
    const [address, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const [endpoint, query] = address.split("?");
    expect(endpoint).toBe("https://api.cartesia.ai/voices");
    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({ limit: "20", q: "A & B", language: "pl", starting_after: "voice-previous" });
    expect(init.redirect).toBe("error");
    expect(init.signal).toBe(signal);
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-key");
  } finally {
    globalThis.fetch = original;
  }
});

test("handles missing credentials, throttling, and invalid responses without retry", async () => {
  const original = globalThis.fetch;
  const fetcher = mock(async () => new Response("private body", { status: 429 }));
  globalThis.fetch = fetcher as unknown as typeof fetch;
  const options = { query: "", language: "", signal: new AbortController().signal };
  try {
    await expect(fetchCatalogPage("", options)).rejects.toThrow("Add your Cartesia API key");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(fetchCatalogPage("test-key", options)).rejects.toThrow("rate limiting");
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(Response.json({ data: "not a list" }));
    await expect(fetchCatalogPage("test-key", options)).rejects.toThrow("unexpected voice list");
  } finally {
    globalThis.fetch = original;
  }
});
