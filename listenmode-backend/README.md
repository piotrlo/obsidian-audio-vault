# AudioVault Backend (Cloudflare Workers + Hono)

Krawędziowe API dla wtyczki AudioVault (Obsidian). Proxy'uje TTS do Azure, wydaje krótkotrwałe JWT, egzekwuje miesięczne limity w D1 i cache'uje listę głosów w KV.

Uwaga: pracujemy wyłącznie na środowisku produkcyjnym (bez lokalnego dev dla backendu).

Co to jest Cloudflare Workers?
- To serwery bezserwerowe uruchamiane globalnie „na krawędzi”. Kod (TypeScript/JavaScript) działa bardzo blisko użytkownika, ma niski latency i prostą konfigurację. Dodatki:
  - D1 (SQLite w chmurze) — relacyjna baza do prostych danych/liczników.
  - KV (Key-Value) — bardzo szybki cache na krawędzi.
  - Sekrety/zmienne środowiskowe — do bezpiecznego przechowywania kluczy.

Endpointy
- POST /v1/auth/validate → License‑Key → krótkotrwały JWT (15 min)
- GET  /v1/auth/usage → bieżące zużycie (Bearer JWT)
- POST /v1/tts → strumieniowe proxy do Azure TTS (Bearer JWT)
- GET  /v1/voices → lista głosów (cache 24h w KV)
- DELETE /v1/voices/cache → czyszczenie cache (wymaga X-Admin-Token)
 - GET  /v1/admin/licenses → lista licencji (paginacja, filtry plan/status/q; wymaga X-Admin-Token)
 - GET  /v1/admin/licenses/:id → szczegóły licencji (wymaga X-Admin-Token)
 - PATCH /v1/admin/licenses/:id → edycja pól: status/plan/expires_at (wymaga X-Admin-Token)
 - POST /v1/admin/licenses → utworzenie licencji (opcjonalne; licencja hashowana na backendzie; wymaga X-Admin-Token)
 - GET  /admin → prosty panel HTML do zarządzania licencjami (wpisz X-Admin-Token w polu „Admin Token”)

Bindings
- D1: listenmode-db (tabele: licenses, usage_monthly, events)
- KV: VOICES_CACHE (cache listy głosów)
- Sekrety/zmienne: AZURE_TTS_API_KEY, AZURE_TTS_REGION, JWT_SECRET, ADMIN_API_TOKEN, ENVIRONMENT

Wymagania
- Bun (bun.sh)
- Wrangler (CLI Cloudflare)
- jq (opcjonalnie do formatowania JSON)

Struktura projektu
- wrangler.toml — definicje bindings i konfiguracja Workera
- migrations/0001_initial.sql — schema D1
- src/
  - index.ts — wejście aplikacji, CORS, rejestracja tras
  - types.ts — typy i powiązania środowiskowe (Bindings)
  - auth/ — generowanie/ weryfikacja JWT + trasy
  - db/ — zapytania do D1 (limity, zużycie, logi)
  - tts/ — proxy TTS do Azure (stream)
  - voices/ — lista głosów z cache w KV

Szybki start (PROD only)
1) Zaloguj się do Cloudflare i wybierz konto
```bash
bunx --bun wrangler whoami
```

2) Utwórz zasoby (jednorazowo)
```bash
# Z bazy (D1) i KV otrzymasz ID — wpisz je do listenmode-backend/wrangler.toml
bunx --bun wrangler d1 create listenmode-db
bunx --bun wrangler kv:namespace create VOICES_CACHE
```

3) Ustaw sekrety (nie commitujemy sekretów)
```bash
bunx --bun wrangler secret put AZURE_TTS_API_KEY --config="$(pwd)/listenmode-backend/wrangler.toml"
bunx --bun wrangler secret put AZURE_TTS_REGION   --config="$(pwd)/listenmode-backend/wrangler.toml"
bunx --bun wrangler secret put JWT_SECRET         --config="$(pwd)/listenmode-backend/wrangler.toml"
bunx --bun wrangler secret put ADMIN_API_TOKEN    --config="$(pwd)/listenmode-backend/wrangler.toml"
```

4) Migracja DB i deploy
```bash
# Migracja (zdalnie)
bunx --bun wrangler d1 execute listenmode-db \
  --config="$(pwd)/listenmode-backend/wrangler.toml" \
  --file="$(pwd)/listenmode-backend/migrations/0001_initial.sql"

# Deploy Workera
bunx --bun wrangler deploy --config="$(pwd)/listenmode-backend/wrangler.toml"
```

5) Smoke testy (na produkcji)
```bash
BASE="https://listenmode-backend.<twoj-subdomain>.workers.dev"

# Health
curl -s "$BASE/health" | jq .

# Zasień licencję testową w D1 (remote)
LICENSE="LM-TEST-123"; HASH=$(printf "%s" "$LICENSE" | shasum -a 256 | awk '{print $1}')
bunx --bun wrangler d1 execute listenmode-db --remote \
  --config="$(pwd)/listenmode-backend/wrangler.toml" \
  --command "INSERT OR IGNORE INTO licenses (license_key_hash, plan, status) VALUES ('$HASH','basic','active');"

# Walidacja → JWT
TOKEN=$(curl -s -X POST "$BASE/v1/auth/validate" -H 'Content-Type: application/json' -d '{"license_key":"LM-TEST-123"}' | jq -r '.data.token')

# Usage
curl -s "$BASE/v1/auth/usage" -H "Authorization: Bearer $TOKEN" | jq .

# Voices (wymaga AZURE_TTS_API_KEY)
curl -s "$BASE/v1/voices?region=westeurope" | jq '.data[:3]'

# TTS → mp3
BODY='{"ssml":"<speak version=\"1.0\" xml:lang=\"en-US\"><voice name=\"en-US-Ava:DragonHDLatestNeural\"><prosody rate=\"+10%\">Hello from ListenMode on Cloudflare Workers.</prosody></voice></speak>","outputFormat":"audio-24khz-48kbitrate-mono-mp3","language":"en-US"}'
curl -s -X POST "$BASE/v1/tts" -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" --data "$BODY" -o out.mp3
```

Admin: czyszczenie cache głosów
- Sekret: `ADMIN_API_TOKEN` musi być ustawiony. Wywołanie purge:
```bash
curl -s -X DELETE "$BASE/v1/voices/cache?region=westeurope" \
  -H 'X-Admin-Token: TWÓJ_TOKEN' | jq .
```
- Uwaga dla zsh: jeśli token zawiera `!`, użyj pojedynczych cudzysłowów.

CORS i bezpieczeństwo
- CORS jest zawężony do: `https://obsidian.md`, `obsidian://`, `capacitor://localhost` oraz `http://localhost:<port>`.
- JWT ważny 15 min. Klucze licencji przechowywane jako SHA‑256.
- Treść SSML nie jest utrwalana; do D1 zapisujemy tylko zdarzenia i liczniki.
- Endpoint purge cache jest chroniony nagłówkiem `X-Admin-Token`.

Rozwiązywanie problemów
- „Missing entry-point” przy deploy: użyj `--config=.../wrangler.toml` albo wejdź do folderu `listenmode-backend`.
- „Couldn't find a D1 DB …”: sprawdź `--config` i `database_id` w `wrangler.toml` vs `wrangler d1 list`.
- 401 przy `/v1/auth/usage` lub `/v1/tts`: sprawdź poprawność Bearer JWT i ważność (15 min), oraz `JWT_SECRET` na Workerze.
- 502 z `/v1/tts` lub `/v1/voices`: upewnij się, że `AZURE_TTS_API_KEY` i `AZURE_TTS_REGION` są ustawione.

Jak działa Cloudflare Workers (w skrócie)
- Każdy deploy tworzy nową wersję Workera, replikowaną globalnie. Ruch trafia do najbliższego węzła.
- Bindings udostępniają zasoby w `c.env.*` (np. `DB`, `VOICES_CACHE`, `AZURE_TTS_API_KEY`).
- Hono upraszcza routing i middleware (CORS/logowanie). Nasz entrypoint to `src/index.ts` i eksport domyślny `app`.
- D1 to zarządzany SQLite. Zapytania wykonujemy przez `DB.prepare(...).bind(...).run()/first()`.
- KV to rozproszony storage klucz→wartość (u nas cache głosów na 24h).

Przydatne komendy (produkcja)
```bash
# Kto zalogowany
bunx --bun wrangler whoami

# Lista D1 i info o bazie
bunx --bun wrangler d1 list
bunx --bun wrangler d1 info listenmode-db

# Zapytanie SQL (remote)
bunx --bun wrangler d1 execute listenmode-db --remote \
  --config="$(pwd)/listenmode-backend/wrangler.toml" \
  --command "SELECT id, plan, status FROM licenses LIMIT 5;"

# Odczyt/zapis sekretów (uwaga: write-only)
bunx --bun wrangler secret list --config="$(pwd)/listenmode-backend/wrangler.toml"
bunx --bun wrangler secret put ADMIN_API_TOKEN --config="$(pwd)/listenmode-backend/wrangler.toml"

# Deploy aktualnej wersji
bunx --bun wrangler deploy --config="$(pwd)/listenmode-backend/wrangler.toml"

# Admin — smoke test (licenses)
BASE="https://listenmode-backend.<twoj-subdomain>.workers.dev"
TOKEN="<ADMIN_API_TOKEN>"
curl -s "$BASE/v1/admin/licenses?page=1&pageSize=10" -H "X-Admin-Token: $TOKEN" | jq .
curl -s "$BASE/v1/admin/licenses/1" -H "X-Admin-Token: $TOKEN" | jq .
curl -s -X PATCH "$BASE/v1/admin/licenses/1" -H "X-Admin-Token: $TOKEN" -H 'Content-Type: application/json' -d '{"status":"suspended"}' | jq .
curl -s -X POST "$BASE/v1/admin/licenses" -H "X-Admin-Token: $TOKEN" -H 'Content-Type: application/json' -d '{"license_key":"LM-NEW-123","plan":"basic","status":"active"}' | jq .
open "$BASE/admin"
```

Debugowanie i logi
- Podgląd logów produkcyjnych Workera:
```bash
bunx --bun wrangler tail --config="$(pwd)/listenmode-backend/wrangler.toml"
```
- Diagnoza CORS: sprawdź, czy `Origin` klienta należy do dozwolonych; middleware jest w `src/index.ts`.
- 401: brak/niepoprawny Bearer JWT lub niezgodność `JWT_SECRET`.
- 402: plan/licznik przekroczony; backend zwróci komunikat z pozostałym limitem.
- 502: błędy dostawcy TTS/Voices; sprawdź sekrety i region, oraz logi (`tts_azure_error`).

Inspekcja KV i cache
- Endpoint `GET /v1/voices` zapisuje wynik do KV pod kluczem `voices:{region}` na 24h.
- Purge cache (admin):
```bash
f4!FR6J53$zPeZFaP3C6k^Fpy
```

Hono
- Hono zapewnia szybki router i kompatybilność z środowiskiem Workers. Dokumentacja: [Hono](https://hono.dev/llms-full.txt).

Dalsza lektura
- Przegląd platformy Workers i dodatków: [Cloudflare Developer Docs](https://developers.cloudflare.com/llms.txt)
