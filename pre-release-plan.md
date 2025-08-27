# AudioVault — Pre‑release Implementation Plan (pre-release-plan.md)

Źródła: spec-then-code.md, spec-then-code-plan.md, docs/developer-policies.md, docs/release.md, docs/submission-requirements.md, docs/submit.md.

Założenia decyzji produktowych (2025-08-27)
- Free aktywujemy automatycznie, ale „1 użytkownik = 1 licencja Free”.
- Link „Kup/zarządzaj” kieruje do `https://audio-vault.app/upgrade` (backend przekieruje do Stripe Checkout/Portal).
- E‑maile z licencją: Resend na domenie `audio-vault.app` (Cloudflare DNS, DKIM/SPF setup).
- Faktury: ręcznie na start (integracja z Infakt później).
- Cennik: w README link do strony z cennikiem (pricing na `audio-vault.app`), zwięzły opis w README.
- Ustawienia pozostają w jednej zakładce (bez rozdziału Basic/Advanced), zgodnie z preferencją.

Stage overview
- PR‑0: Fix licencji Free (singleton + trwały clientId)
- PR‑1: Płatności (routing przez audio-vault.app → Stripe), webhooki, e‑maile
- PR‑2: Polerka UI/UX wtyczki + usunięcie starych domen
- PR‑3: Repo backendu + CI/CD
- PR‑4: Zgodność i dokumenty (README, polityki, release workflow)
- PR‑5: QA i wydanie

---

Stage PR‑0 — Free license singleton i trwały clientId
Scope
- Zapobiec nadawaniu nowej darmowej licencji po reinstalacji wtyczki.
- Utrwalić `clientId` per Vault (poza folderem pluginu), tak aby reinstal nie generował nowego ID.
- Backend: deduplikacja/limity dla Free („1 użytkownik = 1 Free”).

Tasks
- Plugin
  - Zapis `clientId` do ukrytego pliku w root Vault (np. `.audiovault-id`), odczyt/zapis atomowy, generacja UUID przy braku pliku.
  - Wykorzystanie `clientId` z pliku we wszystkich wywołaniach backendu (validate/usage/tts/activate-free).
- Backend
  - `POST /v1/auth/activate-free`:
    - Dedup: nie twórz nowej licencji, jeśli istnieje aktywna powiązana z `client_id_hash`.
    - Wpis do `license_clients` tylko, jeśli brak istniejącego powiązania (limit urządzeń Free = 2 zgodnie ze spec, ale łącz na jedną licencję Free per user; nowe `client_id` powiąż z istniejącą Free, a nie generuj nowej).
    - Cooldown: gdy nie można jednoznacznie powiązać (brak), pozwól na 1 Free co 30 dni per `client_id_hash`/`ip_hash` (pragmatycznie, bez telemetry danych osobowych).
    - Twarde limity miesięczne (10k) egzekwowane przy `/v1/tts`.

Acceptance criteria
- Reinstalacja wtyczki w tym samym Vault nie tworzy nowej licencji Free.
- Nowe urządzenie dołącza do istniejącej licencji Free (limit 2 urządzeń), a nie tworzy kolejnej.
- `activate-free` nie wydaje nadmiarowych licencji przy spamie; pojawia się przyjazny komunikat i link do „Kup/zarządzaj”.

Risks
- Brak twardej identyfikacji „użytkownika” poza `client_id` — rozwiązujemy przez powiązanie wielu `client_id` do jednej Free.

Tests
- E2E: reinstalacja (usunąć folder pluginu, zachować `.audiovault-id`) → brak nowej licencji.
- Dwa różne urządzenia (dwa różne `client_id`) → ta sama licencja Free, limit = 2; trzeci → blokada.

---

Stage PR‑1 — Płatności: routing, webhooki, maile
Scope
- Link „Kup/zarządzaj” w wtyczce kieruje do `https://audio-vault.app/upgrade`, backend wybiera Checkout (brak customer) lub Portal (istniejący customer) i przekierowuje do Stripe.
- Webhooki Stripe aktualizują stan licencji; po zakupie wysyłamy e‑mail z kluczem licencyjnym.

Tasks
- Backend
  - `POST /v1/billing/checkout` (opcjonalnie GET): tworzy Checkout Session; parametry: plan (price_id), success/cancel.
  - `POST /v1/billing/portal`: tworzy link do Customer Portal dla istniejącego `stripe_customer_id`.
  - Webhooki:
    - `checkout.session.completed`: generuj `License-Key` (`AV-<slug>-<random>`), zapisz `license_key_hash`, `plan`, `stripe_customer_id`, `status=active`.
    - `customer.subscription.updated`, `invoice.paid/failed`: aktualizuj plan/status/limity, dopisz `events`.
  - Resend: szablon maila „Twoja licencja AudioVault”, DKIM/SPF na domenie `audio-vault.app` (Cloudflare), retry błędów.
- Plugin
  - `settings.ts`: przycisk „Kup/zarządzaj” otwiera `https://audio-vault.app/upgrade` (bez twardego linku do Stripe), usunięcie starych linków.
  - Obsługa 402 w `index.ts`: otwieraj `https://audio-vault.app/upgrade` zamiast starego URL.

Acceptance criteria
- Klik „Kup/zarządzaj” otwiera stronę, która finalnie kieruje do Stripe (Checkout/Portal) i po sukcesie użytkownik otrzymuje e‑mail z kluczem.
- Webhooki nadają/aktualizują licencje i limity; plan widoczny w `/v1/auth/usage`.

Risks
- Błędy po stronie maili (SPF/DKIM) — monitoruj odrzucone.

Tests
- Manual: zakup Basic → e‑mail z licencją, aktywacja w wtyczce, poprawny plan/limity.
- Webhook symulowany: update planu → natychmiastowa zmiana w `/v1/auth/usage`.

---

Stage PR‑2 — Polerka wtyczki i czyszczenie linków
Scope
- Usunięcie „Token valid until” z ustawień.
- Nowe linki „Kup/zarządzaj” do `audio-vault.app` w `settings.ts` i `index.ts`.
- Przy `useBackend=true` — zablokowanie edycji `Output format` (MP3 enforced) i krótkie objaśnienie.
- Czyszczenie pozostałości po `listenmode.*` w kodzie i dokumentach.

Tasks
- `src/obsidian/settings.ts`: usuń label `Token valid until`; zmień CTA Upgrade na `https://audio-vault.app/upgrade`; disable `Output format` przy backend.
- `src/index.ts`: zamień link w obsłudze 402 na `https://audio-vault.app/upgrade`.
- Przeskanuj repo pod `listenmode`/`workers.dev` i zaktualizuj (w tym README/spec plan, jeśli trzeba).

Acceptance criteria
- Ustawienia nie pokazują daty wygaśnięcia tokenu.
- Wszystkie ścieżki „kup/upgrade” wskazują `audio-vault.app/upgrade`.
- W trybie backend pole formatu jest nieedytowalne i podpisane.

Risks
- Brak.

Tests
- Manual: UI ustawień, klik CTA, zachowanie pola formatu.

---

Stage PR‑3 — Repo backendu i CI/CD
Scope
- Wydzielić backend do osobnego repo `audiovault-backend`. Automatyczne deploye do Cloudflare Workers.

Tasks
- Przenieś `listenmode-backend/` → nowe repo `audiovault-backend` (zmień name w package.json/wrangler.toml).
- Skonfiguruj Cloudflare Git integration: deploy na push/tag, bindowanie D1/KV/sekretów.
- W repo wtyczki wyczyść skrypty uruchamiające testy backendu.

Acceptance criteria
- Commit do repo backendu → automatyczny deploy na `audio-vault.app`.

Risks
- Przeniesienie migracji/sekretów — spisać checklistę.

Tests
- Smoke: `/v1/voices`, `/v1/auth/validate`, `/v1/tts` po deployu.

---

Stage PR‑4 — Zgodność i dokumenty
Scope
- Przygotować README (sprzedażowe) i release automation.

Tasks
- README (skrócone):
  - Hero + 1 zdanie wartości; demo GIF/film; „Pierwsze audio w 3 krokach”.
  - Sekcja „Plus (subskrypcja)”: link do pricing na stronie.
  - Disclosure: sieć, prywatność, MP3-only, kontakt.
- Release workflow: `.github/workflows/release.yml` wg docs/release.md (build → draft release z `main.js`, `manifest.json`).
- Sprawdź wymagania Obsidiana (developer policies, submission requirements) i upewnij się, że README i manifest spełniają limity (opis ≤ 250 znaków).

Acceptance criteria
- Workflow działa po tagu; draft release z artefaktami.
- README spełnia wymogi i linkuje do pricing.

Risks
- Brak.

Tests
- Tag testowy → draft release powstaje automatycznie.

---

Stage PR‑5 — QA i wydanie
Scope
- Ostatnie testy funkcjonalne na desktop/mobile, podbicie wersji i publikacja.

Tasks
- Testy: streaming/fallback, merge MP3, istniejące pliki, 401 refresh/retry, 402 flow do „Kup/zarządzaj”, voices fetch.
- `manifest.json`: podbić `version`; CHANGELOG/README uaktualnić.
- `bun test` / typecheck / build → zielone.
- Utworzyć release, a następnie PR do community‑plugins (wg docs/submit.md) po pierwszym wydaniu.

Acceptance criteria
- Funkcje MVP działają zgodnie ze spec; release opublikowany; PR do katalogu wtyczek gotowy po pierwszym wydaniu.

Risks
- Różnice środowiskowe iOS (wymóg gestu) — do komunikatu w README/FAQ.

Tests
- Manual cross‑platform; krótka lista regresji.

---

Operacyjna checklista
- Sekrety/ENV (Workers): `AZURE_TTS_API_KEY`, `AZURE_TTS_REGION`, `JWT_SECRET`, `ADMIN_API_TOKEN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `D1` (database_id), `KV` (VOICES_CACHE).
- Rotacja `ADMIN_API_TOKEN`: procedura w docs.
- CORS: `https://obsidian.md`, `app://obsidian.md`, `obsidian://`, `capacitor://localhost`, `http://localhost:<port>`.
- Monitoring po wydaniu: Workers Analytics Engine (błędy, latencja).


