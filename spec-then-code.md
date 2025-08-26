# Specyfikacja STC dla wtyczki AudioVault (`spec-then-code.md`)
## Uwaga
> **Wszystkie decyzje projektowe, implementacyjne oraz marketingowe mają być uzasadnione ponizszym dokumentem. Każda zmiana powinna posiadać aktualizację specyfikacji oraz checklistę testów.**


## Nazwa wtyczki: `AudioVault`

### 1. Cel produktu
`AudioVault` jest płatną wtyczką dla `Obsidian`, której celem jest natychmiastowa konwersja tekstowych notatek użytkownika na wysokiej jakości mowę (audio), z opcją odsłuchiwania lokalnie, offline i z prostą obsługą. Produkt odpowiada na realną potrzebę: słuchanie własnych notatek jak podcastów, aby efektywnie wykorzystać czas (jazda samochodem, sprzątanie, trening), wspiera osoby z dysleksją czy trudnościami w czytaniu i jest użyteczny zarówno dla profesjonalistów, studentów, jak i każdego, kto gromadzi wiedzę w `Obsidian`.

### 2. Wartość biznesowa i segmenty odbiorców
- Użytkownicy, którzy zapisują w `Obsidian` artykuły/do przeczytania później.
- Osoby chcące słuchać notatek bez angażowania wzroku/rąk (komunikacja, jazda autem, ADHD, dysleksja).
- Profesjonaliści, studenci oraz osoby pracujące z dużą ilością tekstu.
- Osoby ceniące wysoką jakość głosów TTS – na poziomie `OpenAI`/`Azure`/`ElevenLabs`.

### 3. Wymagania funkcjonalne (Acceptance Criteria)

#### 3.1. Konwersja tekstu do mowy (TTS)
- Użytkownik wybiera dowolną notatkę lub artykuł i generuje z niej plik audio w formacie `mp3` (MVP: wyłącznie MP3).
- Głos TTS jest naturalny (minimum poziom głosów `OpenAI`/`Azure`/`ElevenLabs`), brzmi jak ludzki lektor.
- Proces generacji dla typowej notatki (do 10,000 znaków) trwa maksymalnie 5 sekund.
- Obsługiwane języki na start: polski, angielski.
- Mechanizm obsługi długich notatek (do 50,000 znaków), podział na fragmenty 10,000 znaków, automatyczne odtwarzanie po kolei.
- Możliwość wyboru głosu/prędkości czytania (jeśli udostępnia to `API`).

#### 3.2. Odtwarzanie audio (desktop + mobile)
- Sterowanie wyłącznie przez Ribbon oraz Command Palette: `Play/Pause current note`, `Stop`, `Restart`.
- Dodatkowa komenda: `Download audio (no playback)` — generuje i zapisuje wszystkie części bez odtwarzania; korzysta z `chunkSize` z ustawień.
- Odtwarzanie audio bezpośrednio w aplikacji `Obsidian` (zarówno desktopowej jak i mobilnej).
- Obsługa odtwarzania offline (dla wygenerowanych wcześniej plików audio).
- Dostępne w MVP: scalanie wszystkich części w jeden plik `MP3` (bezstratne łączenie ramek) i linkowanie pojedynczego pliku w notatce.
- Mobile-specific:
  - Ribbon menu jako główny punkt dostępu (zawsze widoczne, 1‑click) z akcją: `Play/Pause current note` (np. `addRibbonIcon('play-circle', ...)`).
  - W przypadku urządzeń bez `MSE` lub z ograniczeniami autoplay, odtwarzanie wymaga gestu użytkownika i automatycznie przełącza się w tryb buforowany po wykryciu braku wsparcia.

#### 3.3. Integracja z Obsidian: przechowywanie, synchronizacja
- Pliki audio są domyślnie przechowywane w folderze `/Audio` w Vault.
- Na dole notatki automatycznie dodawany jest link do pliku audio (`*.mp3`).
- Jeśli włączone jest scalanie części, w notatce utrzymywany jest pojedynczy link do pliku scalonego (`/Audio/<base>.mp3`), a linki do części `_part_N` nie są dodawane.
- Odtwarzacz w pierwszej kolejności próbuje odtworzyć istniejący, lokalny plik audio – generuje go tylko jeśli nie istnieje lub jeśli użytkownik kliknie „refresh”.
- Synchronizacja notatek i plików audio przez `Obsidian Sync` (lub ustawienia użytkownika).

#### 3.4. Subskrypcja i limit znaków
- Limit przetwarzanych znaków/miesiąc (np. 100,000 dla wersji podstawowej).
- Mechanizm jasnego powiadamiania użytkownika o przekroczeniu limitu – wyświetlenie komunikatu oraz opcji dokupienia wyższego planu.
- Obsługa płatności przez `Stripe` dla subskrypcji i dokupień.

#### 3.5. Dostępność (Accessibility)
- Wtyczka oferuje czytelny, kontrastowy interfejs.
- Proste sterowanie – maksymalnie 3 kliknięcia do wygenerowania pierwszego audio.
- Możliwość zmiany głosu/prędkości czytania (jeśli pozwala `API`).
- Obsługa czytników ekranu.

#### 3.6. Stabilność i niezawodność
- Wtyczka działa bezawaryjnie na typowym Vault (do 50k notatek/pliki tekstowe).
- Krytyczne błędy (np. błąd generowania audio, błąd synchronizacji pliku) są raportowane z jasnym komunikatem i możliwością zgłoszenia do supportu.
- Przechowywanie logów błędów (np. lokalnie/share to support).

#### 3.7. Dokumentacja i onboarding
- MVP musi posiadać krótką, czytelną instrukcję instalacji oraz „pierwsze kroki” (`How-to`, `FAQ`).
- Użytkownik nie musi czytać dokumentacji technicznej żeby rozpocząć pracę.
- Proces onboardingu: 3 kliknięcia do pierwszego audio.

### 4. Wymagania techniczne, architektura, integracje
- Plugin oparty o `TypeScript` i API `Obsidian`.
- Współpraca z `API` `OpenAI`/`Azure`/`ElevenLabs` do generacji TTS (opcja na własny endpoint przez `API`).
- Panel audio na bazie komponentu HTML5 `<audio controls>` z własnym minimalistycznym stylingiem oraz kontrolami `JS` (`play`/`pause`/`rewind`/`skip`/`regenerate`).
- Przechowywanie plików audio offline w Vault `/Audio`; automatyczne linkowanie audio na dole notatki.
- Synchronizacja: obsługa przez `Obsidian Sync`, wsparcie synchronizacji offline/lokalnie.
- `Stripe` dla obsługi płatności/subskrypcji.

#### 4.1. Warstwa TTS (Azure AI Speech – zgodnie z PoC)
- **Dostawca TTS (MVP)**: `Azure AI Speech` (REST over HTTPS; bez SDK). Endpointy:
  - Synthesis: `POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1`
  - Lista głosów: `GET https://{region}.tts.speech.microsoft.com/cognitiveservices/voices/list`
- **Format żądania**: `SSML` z prosody `rate`. Domyślne `rate`: `+10%` (mapowane na `playbackRate ~ 1.1x`).
- **Domyślny głos**: `en-US-Ava3:DragonHDLatestNeural` (Ava3). Furtka na użycie tego samego głosu do treści PL (Ava3 jest wielojęzyczna) lub wybór dedykowanego polskiego głosu w ustawieniach.
- **Format audio (MVP)**: `audio-24khz-48kbitrate-mono-mp3` (tylko MP3 w MVP; wsparcie innych formatów w późniejszych etapach).
- **Język SSML**: ustawiany w atrybucie `xml:lang` (PoC używa `pl-PL`). W produkcie: język wybierany z ustawień lub automatycznie (np. z frontmatter notatki lub heurystyki).
- **Dzielenie długich notatek**: podział na porcje po maks. 5 000 znaków (wcześniej 10 000). Algorytm preferuje granice zdań; dla bardzo długich zdań dodatkowy podział po słowach; bez mutacji tekstu wejściowego. Parametr konfigurowalny w ustawieniach: `chunkSize` 500–9000 (domyślnie 5000).
- **Strumieniowanie**: odbiór `ReadableStream<Uint8Array>` i odtwarzanie w locie przez `MediaSource` (MSE) z fallbackiem do trybu „zbieraj, potem odtwórz”. Na iOS (i inne środowiska bez MSE) strumieniowanie pozostaje domyślnie włączone z implementacją kompatybilną (testy w późniejszym etapie), a w razie braku wsparcia stosujemy automatyczny fallback do „zbieraj, potem odtwórz”.

#### 4.1a. Abstrakcja dostawców (furtka dla OpenAI)
- **Interfejs `TtsProvider`**: `synthesize(ssml, format, language) -> ReadableStream<Uint8Array>` oraz `listVoices() -> Voice[]`.
- **Implementacje**: `AzureTtsProvider` (domyślna), `OpenAiTtsProvider` (opcjonalna w przyszłości).
- **Konfiguracja**: ustawienie `ttsProvider = "azure" | "openai"` (domyślnie `azure`). Przełącznik warunkuje adresy endpointów backendu, ale nie zmienia UI.

#### 4.2. Warstwa backendowa (Cloudflare Workers: proxy TTS + licencje + limity)
- **Cel**: ukrycie klucza `Azure`, egzekwowanie licencji i limitów, opcjonalna obsługa OpenAI TTS przez ten sam interfejs.
- **Hosting**: `Cloudflare Workers` (Edge, streaming), z dodatkami: `D1` (SQLite) do silnych liczników/relacji, `KV` do cache, `R2` (opcjonalnie) do logów/backupów.
- **API (wdrożone w Stage 3)**:
  - `POST /v1/tts` – strumieniowe proxy do dostawcy TTS (`provider=azure`). Wejście: `ssml`, `outputFormat`, `language`. Autoryzacja: `Authorization: Bearer <jwt>`.
  - `GET /v1/voices` – proxy listy głosów z cache per region (KV, 24h).
  - `POST /v1/auth/validate` – zamiana `License-Key` na krótko-żyjący `JWT` (15 min, HMAC). Zwraca plan i pozostały budżet (na podstawie D1). Obsługuje `client_id` powiązany z urządzeniem.
  - `GET /v1/auth/usage` – aktualne zużycie (miesięczne) i limit planu na podstawie D1.
  - `DELETE /v1/voices/cache` – czyszczenie cache głosów dla regionu (wymaga nagłówka `X-Admin-Token`).
  - `GET /v1/admin/licenses` – lista licencji z paginacją i filtrami (`plan`, `status`, `q` dla prefixu `license_key_hash`). Wymaga `X-Admin-Token`.
  - `GET /v1/admin/licenses/:id` – szczegóły licencji. Wymaga `X-Admin-Token`.
  - `PATCH /v1/admin/licenses/:id` – edycja pól: `status`, `plan`, `expires_at`. Wymaga `X-Admin-Token`.
  - `POST /v1/admin/licenses` – utworzenie licencji z hashowaniem klucza (opcjonalne). Wymaga `X-Admin-Token`.
  - `GET /admin` – prosty panel HTML (token wpisywany ręcznie w polu „Admin Token”) korzystający z `/v1/admin/*`.
- **Limity/rozliczenia**: twarde limity znaków per plan; przy przekroczeniu `402 Payment Required` + prosty komunikat (link do Stripe w Stage 5).
- **Bezpieczeństwo**: klucze dostawców tylko w sekretach Workers; minimalny CORS (Obsidian + localhost); brak trwałego przechowywania treści SSML.
  - CORS: dopuszczone pochodzenia to `https://obsidian.md`, `app://obsidian.md`, `obsidian://`, `capacitor://localhost`, `http://localhost:<port>`.
  - Admin API: chronione sekretem `ADMIN_API_TOKEN` przekazywanym jako `X-Admin-Token`.
- **Dane (D1 – minimalny schemat)**:
  - `licenses(id, stripe_customer_id, plan, status, license_key_hash, created_at, expires_at)`
  - `usage_monthly(license_id, period, chars_used)` z UPSERT
  - `events(id, license_id, event_type, metadata, created_at)`
- **Cache (KV)**: `voices:{region}` na 24h.

##### 4.2.a. Hardening (trace, błędy, limity, retry)
- **X-Request-Id**: każdy request otrzymuje nagłówek `X-Request-Id` (generowany lub echo z żądania); logujemy wejście/wyjście z czasem.
- **Jednolity błąd JSON**: `{ error_code, message, details? }` dla wszystkich błędów (`400/401/402/404/502/504`).
- **Limity ciała i walidacja**:
  - `/v1/tts`: limit domyślny 1 MiB (ENV `MAX_TTS_BODY_BYTES`), `413` przy przekroczeniu; walidacja `Zod`.
  - `/v1/auth/validate`: limit domyślny 64 KiB (ENV `AUTH_VALIDATE_BODY_LIMIT_BYTES`), `413` przy przekroczeniu; walidacja `Zod`.
- **Retry/backoff i timeout dla TTS**: timeout 15 s (ENV `AZURE_TTS_TIMEOUT_MS`), do 2 retry na odpowiedzi 5xx z liniowym backoffem; `504` na timeout, `502` na trwały błąd upstream.
- **Wymuszenie MP3**: `/v1/tts` akceptuje wyłącznie `outputFormat` typu MP3; inne formaty → `400 UNSUPPORTED_FORMAT`.
- **Admin session cookies**: zarządzane przez `hono/cookie` (HttpOnly, Secure, SameSite=Strict) z „sliding renewal” (odświeżenie gdy < 15 min do wygaśnięcia).

#### 4.3. Frontend (plugin Obsidian)
- **Sterowanie**: wyłącznie przez Ribbon i Command Palette (`Play/Pause current note`, `Stop`, `Restart`). Brak pływającego panelu.
- **Dodatkowa komenda**: `listenmode-download` („Download audio (no playback)”) — generuje wszystkie części na podstawie `chunkSize` i zapisuje je do `Audio/` bez natychmiastowego odtwarzania; aktualizuje linki w notatce.
- **Streaming**: zawsze włączony (domyślnie); MSE jeżeli wspierane; iOS domyślnie Buffered (Prefetch) z `chunkSize=500`. Na desktopie fallback do Buffered Prefetch (okno=3) z widocznym `Notice` przy braku MSE/błędzie strumienia.
- **Zapis offline**: pliki do folderu `Audio/`, nazwy bezpieczne (`toSafeBase`), rozszerzenie `mp3`. Na końcu notatki automatyczny link `[[relPath]]`.
- **Ustawienia (karty)**: `Basic` i `Advanced`.
  - `Basic`: status licencji + CTA (Upgrade), aktywacja `License Key`; przełącznik trybu: Lokalny (Azure API Key) lub Plus (backend); `Speed` (suwak −100%..+500% → `rate`), `Language`, `Streaming`, `Merge MP3`, `Audio folder`.
  - `Advanced`: `TTS Provider`, `Output format`, `Chunk size`, `Debug logs`, przycisk „Przywróć domyślne”.
- Z UI usuwamy: `Backend URL`, `Only HD neural voices`, `Help`.
- **Zachowanie**: jeżeli istnieje lokalny plik audio i użytkownik nie wymusza regeneracji – odtwarzamy lokalny plik; w innym wypadku generujemy. `Play/Pause` wiąże sesję z aktualną notatką.
- **Scalenie MP3**: jeżeli istnieje scalony plik `Audio/<base>.mp3`, preferujemy jego odtwarzanie; utrzymujemy pojedynczy link w notatce.

#### 4.4. Bezpieczeństwo i prywatność
- **Brak przechowywania treści notatek** po stronie serwera (przetwarzane strumieniowo i odrzucane po zakończeniu). Logowanie tylko metadanych technicznych (czas, rozmiar, status), z opcją opt‑out.
- **Klucze i tokeny**: klucz `Azure` tylko na backendzie; wtyczka przechowuje jedynie licencję i/lub krótkotrwały token.
- **Ochrona przed wyciekiem**: brak bezpośrednich wywołań do Azure w trybie produkcyjnym; tryb „developerski” może pozwolić na bezpośrednie połączenie (feature flag), ale wyłączony w release.

#### 4.4a. Monitoring i obserwowalność
- **Błędy**: lekka telemetria do `Workers Analytics Engine`. Logujemy kody błędów, czas odpowiedzi, identyfikator licencji (hash).
- **Zużycie**: liczniki znaków i liczba wygenerowanych plików per licencja, plan i okres. Eksport metryk do `Analytics Engine` w celu raportowania.
 - **Trace**: `X-Request-Id` w odpowiedziach i logach (wejście/wyjście) dla korelacji.

#### 4.5. Wydajność i niezawodność
- **Szybki start audio**: strumieniowanie z niskim buforem początkowym, aby spełnić cel „< 5 s dla 5k znaków na chunk” (perceptualne TTFP krótsze dzięki streamowi).
- **Kolejkowanie fragmentów**: sekwencyjne odtwarzanie — kolejny fragment rozpoczyna się dopiero po zakończeniu/abort poprzedniego; buforowany tryb wykorzystuje Prefetch z oknem 3 równoległych pobrań dla płynności oraz minimalizacji przerw między częściami.
- **Resilience**: powtarzanie przy błędach sieci, przejrzyste komunikaty `Notice` w UI.

#### 4.6. Zależności i rozmiar
- **Zależności**: Usuwamy `ramda` bo zajmuje az 1.17MB.
- **Brak frameworków UI**: natywne elementy `HTML`/`CSS` w obrębie wtyczki.

### 4a. Konfiguracja TTS (wartości startowe)
- **Region**: `westeurope` (konfigurowalny).
- **Głos domyślny**: `en-US-Ava3:DragonHDLatestNeural` (Ava3 tez dla PL + mozliwosc zmiany w ustawieniach, tylko najlepsze glosy).
- **Format audio**: `audio-24khz-48kbitrate-mono-mp3` (domyślny).
- **Rate (SSML)**: `+10%`.
- **Folder audio**: `Audio/`.
- **Strumieniowanie**: zawsze włączone.

### 4b. Modele subskrypcji i limity (Stripe)
- **Plany**:
  - Free – $0 – 10 000 znaków/miesiąc (~2 artykuły)
  - Basic – $7 – 100 000 znaków/miesiąc (~20 artykułów)
  - Pro – $18 – 300 000 znaków/miesiąc (~60 artykułów)
- **Zakup/zarządzanie**: Stripe Checkout + Customer Portal (zmiana/upgrade/downgrade/karty).
- **Webhooki**: `checkout.session.completed`, `customer.subscription.updated`, `invoice.paid/failed` – aktualizacja tabeli `licenses` oraz aktywnego planu.
- **Generowanie licencji**: po potwierdzeniu subskrypcji generujemy `License-Key` (np. `LM-<slug>-<random>`), przechowujemy `hash` w D1, pokazujemy w portalu i wysyłamy e‑mailem.
- **Walidacja w aplikacji**: użytkownik wkleja klucz w ustawieniach wtyczki → `/v1/auth/validate` (wysyła także `client_id`) zwraca krótko‑żyjący `JWT` (10–15 min) z `license_id`, `plan`, `quota_remaining`, `client_id`.
- **Liczenie znaków**: inkrementacja w `usage_monthly` w trakcie `/v1/tts` na podstawie długości tekstu źródłowego (po czyszczeniu SSML). Blokada przy przekroczeniu limitu.
- **Limit urządzeń (Free)**: `PLAN_MAX_CLIENTS.free = 2`; licencja wiązana z `client_id` (tabela `license_clients`). Free działa na 2 urządzeniach; reszta planów bez limitu urządzeń.

### 4c. Prosty przepływ integracji Stripe (proponowany)
1. Wtyczka: link „Kup/zarządzaj” → otwarcie Stripe Checkout/Portal w przeglądarce.
2. Webhook w Workers: po aktywacji/zmianie planu tworzy/aktualizuje rekord licencji i wysyła klucz.
3. Użytkownik wkleja klucz w ustawieniach wtyczki → `/v1/auth/validate` → otrzymuje `JWT`.
4. Każde żądanie `/v1/tts` z `JWT` – backend nalicza znaki, proxy‑uje stream do Azure/OpenAI.
5. Przy przekroczeniu limitu: `402` + link do podniesienia planu (Portal Stripe).


### 5. Kryteria weryfikacji i testy (Definition of Done)
Weryfikacja polega na potwierdzeniu poniższych punktów:
- TTS i wydajność:
  - Dla notatki do 10 000 znaków: czas do pierwszego dźwięku (rozpoczęcia odtwarzania) < 2 s (przy stabilnym łączu), zakończenie generacji < 5 s.
  - Dla notatek do 50 000 znaków: poprawny podział na fragmenty zgodnie z ustawieniem `chunkSize` (domyślnie 5 000), automatyczne odtwarzanie kolejnych części bez ręcznej interwencji.
- Dobór języka:
  - Automatyczna detekcja dominującego języka na podstawie treści ustawia `xml:lang` odpowiednio (PL/EN). Test na trzech próbkach: w pełni PL, w pełni EN, mieszana (wybierany język dominujący).
- Głos i format:
  - Domyślnie używany głos `en-US-Ava3:DragonHDLatestNeural` oraz domyślny format `mp3`.
- Odtwarzanie i offline:
  - Dostępne i działające kontrolki (Ribbon/Commands): `Play/Pause`, `Stop`, `Restart`; prędkość z ustawień.
  - Jeżeli istnieje lokalny plik audio w `Audio/`, jest odtwarzany bez wywołań do backendu; przy „refresh” następuje regeneracja.
- Link do wygenerowanego pliku jest automatycznie dopisywany na końcu notatki; nazwy plików są bezpieczne; nie dopuszczamy duplikowania wpisów linków (utrzymujemy pojedynczy aktualny link).
- Streaming:
  - Streaming zawsze włączony; odtwarzanie działa na desktop (Windows/macOS), Android i iOS.
  - iOS: domyślnie Buffered (Prefetch) z `chunkSize=500` i oknem 3.
  - Desktop fallback: przy błędzie strumieniowania lub braku MSE następuje automatyczne przełączenie do Buffered Prefetch (okno=3) z widocznym `Notice`.
- Mobile UI:
- Scalanie części (opcjonalne):
  - Dla formatu `audio-24khz-48kbitrate-mono-mp3` dostępny jest tryb „Łącz części w jeden plik audio”.
  - Po włączeniu: po zakończeniu generowania powstaje pojedynczy plik `Audio/<base>.mp3`, a na końcu notatki pojawia się dokładnie jeden link do tego pliku.
  - Odtwarzanie istniejącego pliku scalonego ma pierwszeństwo przed częściami `_part_N`.
  - Dla nienatywnych formatów (np. `WAV`) opcja jest ignorowana bez błędów i użytkownik otrzymuje czytelny komunikat.
  - Ribbon menu obecne z akcją: `Play/Pause current note`; 1‑click z paska narzędzi.
  - Na iOS/Android przy braku `MSE` lub w przypadku ograniczeń autoplay, wtyczka wymaga gestu i przełącza się w tryb buforowany bez błędów.
- Backend/licencje/Stripe (Cloudflare Workers):
  - `License-Key` jest wymieniany na `JWT` ważny 15 min; po wygaśnięciu żądania z przeterminowanym tokenem kończą się `401`, a odświeżenie tokenu działa poprawnie.
  - Zużycie znaków jest naliczane po stronie backendu i widoczne w `/v1/usage`.
  - Limity planów egzekwowane: Free (10k), Basic (100k), Pro (300k); po przekroczeniu limitu zwracane jest `402 Payment Required` z odnośnikiem do podniesienia planu (Stripe Portal).
  - Free: limit urządzeń — maks. 2 `client_id` na licencję; `/v1/auth/validate` odrzuca kolejne (`402 DEVICE_LIMIT_EXCEEDED`). JWT zawiera `client_id`. Wyższe plany bez limitu urządzeń.
  - Webhooki Stripe aktualizują status planu/licencji; po zmianie planu nowe limity obowiązują natychmiast.
  - Endpoint `/v1/voices` zwraca listę głosów; cache w KV działa (ten sam wynik w oknie 24 h).
  - Endpoint admin `/v1/voices/cache` czyści cache po poprawnym `X-Admin-Token` i zwraca komunikat potwierdzający.
  - Hardening: `X-Request-Id` obecny; jednolity format błędów; limity ciała i walidacja Zod (413/400); TTS timeout+retry (504/502 zgodnie z opisem); wymuszony MP3 w `/v1/tts`; admin cookie via `hono/cookie` z odnowieniem.
- Bezpieczeństwo i prywatność:
  - Brak klucza Azure w kliencie; wszystkie połączenia do dostawcy idą przez backend proxy.
  - Treść notatek nie jest trwale logowana; logujemy wyłącznie metadane techniczne.
  - Rate limiting aktywny, CORS ograniczony do minimum.
- Monitoring i błędy:
  - Błędy i metryki (czas odpowiedzi, kody) są rejestrowane i dostępne w Workers Analytics Engine.
  - Wtyczka prezentuje czytelne komunikaty w przypadku błędów (np. brak licencji, przekroczony limit, błąd TTS).
- Dostępność i onboarding:
  - UI jest czytelny (kontrast), sterowalny z klawiatury.
  - Użytkownik jest w stanie od zera wygenerować audio w maksymalnie 3 kliknięciach (onboarding).
- Stabilność:
  - Test na Vault z 50 000 notatek: brak awarii i wycieków pamięci; błędy raportowane.

### 6. Rozwój i aktualizacja specyfikacji
Specyfikacja jest „living document” i będzie rozwijana razem z pojawieniem się nowych wymagań/zmian rynkowych oraz feedbackiem użytkowników.

### 7. Kontekst wdrożenia w repozytorium
- Plik `spec-then-code.md` trzymać w katalogu głównym pluginu.
- Implementacja podzielona na rozdziały (moduły): panel audio, generacja TTS, obsługa plików offline, integracja z `Obsidian`, subskrypcja/płatności.
- Każda funkcjonalność/fix planować i dokumentować zgodnie ze standardem `STC`: `spec → kod → test → review → deploy`.
- Backend: pracujemy bez środowiska lokalnego; wszystkie testy backendu wykonujemy na produkcji przez `workers.dev` (z rozwagą i limitami testowymi).

### 8. Załączniki
(Linki do repozytoriów, API, przykładowe skrypty/fragmenty kodu, referencje do wzorcowych pluginów.)