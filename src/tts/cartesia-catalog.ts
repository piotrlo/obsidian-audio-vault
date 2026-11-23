import { z } from "zod";
import { CARTESIA_API_VERSION, CARTESIA_VOICES } from "./cartesia-provider";

const voiceId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const locale = z.string().regex(/^[a-z]{2,3}(?:-[a-z]{2})?$/i);
const pageSchema = z.object({
  data: z.array(z.object({
    id: voiceId,
    name: z.string().trim().min(1).max(256),
    tagline: z.string().optional(),
    description: z.string().optional(),
    language: z.string().nullish(),
    accents: z.array(z.object({ locale, is_native: z.boolean() })).nullish(),
  })).max(100),
  has_more: z.boolean(),
  next_page: voiceId.nullish(),
});

export type CatalogVoice = z.infer<typeof pageSchema>["data"][number];
export type CatalogSort = "recommended" | "name" | "cartesia";
const recommended = new Set(CARTESIA_VOICES.map(({ shortName }) => shortName));

export function validVoiceId(value: unknown): value is string {
  return voiceId.safeParse(value).success;
}

export function normalizeVoiceLocale(value: string): string | undefined {
  const cleaned = value.trim().replace(/_/g, "-");
  if (!locale.safeParse(cleaned).success) return;
  const [language, region] = cleaned.split("-");
  return region ? `${language.toLowerCase()}-${region.toUpperCase()}` : language.toLowerCase();
}

function matchesLocale(value: string, filter: string): boolean {
  const a = value.toLowerCase();
  const b = filter.toLowerCase();
  return a === b || a.startsWith(`${b}-`);
}

export function catalogVoiceLocale(voice: CatalogVoice, filter: string): string | undefined {
  const accents = voice.accents ?? [];
  const matches = accents.filter((accent) => filter && matchesLocale(accent.locale, filter));
  return normalizeVoiceLocale(matches.find((accent) => accent.is_native)?.locale ?? matches[0]?.locale ??
    (filter && voice.language && matchesLocale(voice.language, filter) ? voice.language :
      accents.find((accent) => accent.is_native)?.locale ?? voice.language ?? accents[0]?.locale ?? ""));
}

export function sortCatalogVoices(voices: CatalogVoice[], filter: string, sort: CatalogSort): CatalogVoice[] {
  if (sort === "cartesia") return [...voices];
  const nativeMatch = (voice: CatalogVoice) => !!filter && !!voice.accents?.some(
    (accent) => accent.is_native && matchesLocale(accent.locale, filter),
  );
  const rank = (voice: CatalogVoice) => (nativeMatch(voice) ? 2 : 0) + (recommended.has(voice.id) ? 1 : 0);
  return [...voices].sort((a, b) =>
    (sort === "recommended" ? rank(b) - rank(a) : 0) || a.name.localeCompare(b.name, "en"),
  );
}

export async function fetchCatalogPage(key: string, options: {
  query: string; language: string; cursor?: string; signal: AbortSignal;
}): Promise<{ voices: CatalogVoice[]; next?: string }> {
  if (!key.trim()) throw new Error("Add your Cartesia API key in AudioVault settings.");
  const params = new URLSearchParams({ limit: "20" });
  if (options.query.trim()) params.set("q", options.query.trim());
  if (options.language) params.set("language", options.language);
  if (options.cursor) params.set("starting_after", options.cursor);
  const response = await fetch(`https://api.cartesia.ai/voices?${params}`, {
    redirect: "error",
    headers: { Authorization: `Bearer ${key.trim()}`, "Cartesia-Version": CARTESIA_API_VERSION },
    signal: options.signal,
  });
  if (response.status === 401 || response.status === 403) throw new Error("Cartesia rejected the API key. Check it in AudioVault settings.");
  if (response.status === 429) throw new Error("Cartesia is rate limiting voice searches. Try again shortly.");
  if (!response.ok) throw new Error(`Could not load voices from Cartesia (HTTP ${response.status}).`);
  const parsed = pageSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error("Cartesia returned an unexpected voice list.");
  const { data, has_more, next_page } = parsed.data;
  const next = has_more ? next_page || data.at(-1)?.id : undefined;
  return { voices: data, next: next !== options.cursor ? next : undefined };
}
