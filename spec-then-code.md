# Specyfikacja STC dla wtyczki ListenMode (`spec-then-code.md`)
## Uwaga
> **Wszystkie decyzje projektowe, implementacyjne oraz marketingowe mają być uzasadnione ponizszym dokumentem. Każda zmiana powinna posiadać aktualizację specyfikacji oraz checklistę testów.**


## Nazwa wtyczki: `ListenMode`

### 1. Cel produktu
`ListenMode` jest płatną wtyczką dla `Obsidian`, której celem jest natychmiastowa konwersja tekstowych notatek użytkownika na wysokiej jakości mowę (audio), z opcją odsłuchiwania lokalnie, offline i z prostą obsługą. Produkt odpowiada na realną potrzebę: słuchanie własnych notatek jak podcastów, aby efektywnie wykorzystać czas (jazda samochodem, sprzątanie, trening), wspiera osoby z dysleksją czy trudnościami w czytaniu i jest użyteczny zarówno dla profesjonalistów, studentów, jak i każdego, kto gromadzi wiedzę w `Obsidian`.

### 2. Wartość biznesowa i segmenty odbiorców
- Użytkownicy, którzy zapisują w `Obsidian` artykuły/do przeczytania później.
- Osoby chcące słuchać notatek bez angażowania wzroku/rąk (komunikacja, jazda autem, ADHD, dysleksja).
- Profesjonaliści, studenci oraz osoby pracujące z dużą ilością tekstu.
- Osoby ceniące wysoką jakość głosów TTS – na poziomie `OpenAI`/`Azure`/`ElevenLabs`.

### 3. Wymagania funkcjonalne (Acceptance Criteria)

#### 3.1. Konwersja tekstu do mowy (TTS)
- Użytkownik wybiera dowolną notatkę lub artykuł i generuje z niej plik audio w formacie `mp3` (lub innym obsługiwanym przez `Obsidian`).
- Głos TTS jest naturalny (minimum poziom głosów `OpenAI`/`Azure`/`ElevenLabs`), brzmi jak ludzki lektor.
- Proces generacji dla typowej notatki (do 10,000 znaków) trwa maksymalnie 5 sekund.
- Obsługiwane języki na start: polski, angielski.
- Mechanizm obsługi długich notatek (do 50,000 znaków), podział na fragmenty 10,000 znaków, automatyczne odtwarzanie po kolei.
- Możliwość wyboru głosu/prędkości czytania (jeśli udostępnia to `API`).

#### 3.2. Odtwarzanie audio (desktop + mobile)
- Wtyczka udostępnia minimalistyczny panel audio: `play`, `pause`, regeneracja dźwięku (np. po edycji notatki).
- Odtwarzanie audio bezpośrednio w aplikacji `Obsidian` (zarówno desktopowej jak i mobilnej).
- Obsługa odtwarzania offline (dla wygenerowanych wcześniej plików audio).
- Panel audio widoczny dla aktualnie otwartej notatki, bez playlist itp.
- Obsługa akcji także przez komendy `Obsidian` (Command Palette / Run command): m.in. `Read current note`, `Stop`, `Restart`, `Toggle panel`, `Download last audio`.
- Możliwość włączenia/wyłączenia panelu w ustawieniach wtyczki.
- Możliwość zwinięcia/rozwinięcia panelu ikoną w nagłówku panelu.

#### 3.3. Integracja z Obsidian: przechowywanie, synchronizacja
- Pliki audio są domyślnie przechowywane w folderze `/Audio` w Vault.
- Na dole notatki automatycznie dodawany jest link do pliku audio (`*.mp3`).
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
- Panel audio na bazie komponentu HTML5 `<audio controls>` z własnym minimalistycznym stylingiem oraz kontrolami `JS` (`play`/`pause`/`rewind`/`skip`/`regenerate`/`download`).
- Przechowywanie plików audio offline w Vault `/Audio`; automatyczne linkowanie audio na dole notatki.
- Synchronizacja: obsługa przez `Obsidian Sync`, wsparcie synchronizacji offline/lokalnie.
- `Stripe` dla obsługi płatności/subskrypcji.

#### 4.1. Warstwa TTS (Azure AI Speech – zgodnie z PoC)
- **Dostawca TTS (MVP)**: `Azure AI Speech` (REST over HTTPS; bez SDK). Endpointy:
  - Synthesis: `POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1`
  - Lista głosów: `GET https://{region}.tts.speech.microsoft.com/cognitiveservices/voices/list`
- **Format żądania**: `SSML` z prosody `rate`. Domyślne `rate`: `+10%` (mapowane na `playbackRate ~ 1.1x`).
- **Domyślny głos**: `en-US-Ava3:DragonHDLatestNeural` (Ava3). Furtka na użycie tego samego głosu do treści PL (Ava3 jest wielojęzyczna) lub wybór dedykowanego polskiego głosu w ustawieniach.
- **Domyślny format audio**: `audio-24khz-48kbitrate-mono-mp3` z możliwością zmiany na `riff-24khz-16bit-mono-pcm (wav)`.
- **Język SSML**: ustawiany w atrybucie `xml:lang` (PoC używa `pl-PL`). W produkcie: język wybierany z ustawień lub automatycznie (np. z frontmatter notatki lub heurystyki).
- **Dzielenie długich notatek**: podział na porcje po maks. 10 000 znaków (PoC: 35 000). Algorytm preferuje granice zdań; bez mutacji tekstu wejściowego.
- **Strumieniowanie**: odbiór `ReadableStream<Uint8Array>` i odtwarzanie w locie przez `MediaSource` (MSE) z fallbackiem do trybu „zbieraj, potem odtwórz”.

#### 4.1a. Abstrakcja dostawców (furtka dla OpenAI)
- **Interfejs `TtsProvider`**: `synthesize(ssml, format, language) -> ReadableStream` oraz `listVoices() -> Voice[]`.
- **Implementacje**: `AzureTtsProvider` (domyślna), `OpenAiTtsProvider` (opcjonalna w przyszłości).
- **Konfiguracja**: ustawienie `ttsProvider = "azure" | "openai"` (domyślnie `azure`). Przełącznik warunkuje adresy endpointów backendu, ale nie zmienia UI.

#### 4.2. Warstwa backendowa (Cloudflare Workers: proxy TTS + licencje + limity)
- **Cel**: ukrycie klucza `Azure`, egzekwowanie licencji i limitów, opcjonalna obsługa OpenAI TTS przez ten sam interfejs.
- **Hosting**: `Cloudflare Workers` (Edge, streaming), z dodatkami: `D1` (SQLite) do silnych liczników/relacji, `KV` do cache, `R2` (opcjonalnie) do logów/backupów.
- **API**:
  - `POST /v1/tts` – strumieniowe proxy do dostawcy TTS (`provider=azure|openai`). Wejście: `ssml`, `outputFormat`, `language`. Autoryzacja: `Authorization: Bearer <jwt>`.
  - `GET /v1/voices` – proxy listy głosów z cache per region/provider.
  - `POST /v1/license/validate` – zamiana `License-Key` na krótko-żyjący `JWT` (10–15 min, HMAC). Zwraca zakres limitów, plan i pozostały budżet znaków.
  - `GET /v1/usage` – aktualne zużycie (miesięczne) i limit planu.
- **Limity/rozliczenia**: twarde limity znaków per plan; przy przekroczeniu `402 Payment Required` + link do podniesienia planu.
- **Bezpieczeństwo**: klucze dostawców tylko w sekretach Workers; Rate limiting (license + IP), minimalny CORS; brak trwałego przechowywania treści notatek.
- **Dane (D1 – minimalny schemat)**:
  - `licenses(id, stripe_customer_id, plan, status, license_key_hash, created_at)`
  - `usage_monthly(license_id, period, chars_used)` z inkrementacją transakcyjną
  - `events(id, license_id, ts, type, meta)` do audytu i błędów (opcjonalnie)
- **Cache (KV)**: `voices:{region}:{provider}` na 24h; ewentualnie cache krótki (60s) dla tokenów JWT w celu odwołania.

#### 4.3. Frontend (plugin Obsidian)
- **Kontrolki odtwarzania**: lekki panel (`play/pause`, `stop`, `restart`, `download`, `speed`).
- **Streaming**: zawsze włączony (domyślnie); MSE jeżeli wspierane; iOS będziemy oceniać w testach.
- **Zapis offline**: pliki do folderu `Audio/`, nazwy bezpieczne (`toSafeBase`), rozszerzenia zależne od formatu (`mp3`/`wav`). Na końcu notatki automatyczny link `[[relPath]]`.
- **Ustawienia wtyczki**: `azureRegion`, wybór głosu (dropdown z pobieraniem przez backend), `outputFormat`, `rate (SSML)`, `enableStreaming`, `showControls`, `audioFolder`, oraz pole na licencję użytkownika (z walidacją przez backend).
- **Zachowanie**: jeżeli istnieje lokalny plik audio i użytkownik nie wymusza regeneracji – odtwarzamy lokalny plik; w innym wypadku generujemy.
- **Komendy Obsidian (Run command)**: rejestracja poleceń: `read-current-note`, `stop-playback`, `restart`, `toggle-controls`, `download-last-audio`.
- **Panel – widoczność i zwijanie**: przełącznik `showControls` w ustawieniach; możliwość zwijania/rozwijania panelu ikoną (np. „▾/▸”) w nagłówku panelu.

#### 4.4. Bezpieczeństwo i prywatność
- **Brak przechowywania treści notatek** po stronie serwera (przetwarzane strumieniowo i odrzucane po zakończeniu). Logowanie tylko metadanych technicznych (czas, rozmiar, status), z opcją opt‑out.
- **Klucze i tokeny**: klucz `Azure` tylko na backendzie; wtyczka przechowuje jedynie licencję i/lub krótkotrwały token.
- **Ochrona przed wyciekiem**: brak bezpośrednich wywołań do Azure w trybie produkcyjnym; tryb „developerski” może pozwolić na bezpośrednie połączenie (feature flag), ale wyłączony w release.

#### 4.4a. Monitoring i obserwowalność
- **Błędy**: lekka telemetria do `Workers Analytics Engine`. Logujemy kody błędów, czas odpowiedzi, identyfikator licencji (hash).
- **Zużycie**: liczniki znaków i liczba wygenerowanych plików per licencja, plan i okres. Eksport metryk do `Analytics Engine` w celu raportowania.

#### 4.5. Wydajność i niezawodność
- **Szybki start audio**: strumieniowanie z niskim buforem początkowym, aby spełnić cel „< 5 s dla 10k znaków” (perceptualne TTFP krótsze dzięki streamowi).
- **Kolejkowanie fragmentów**: automatyczne odtwarzanie kolejnych części; możliwość wątku „prefetch następnego fragmentu”.
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
- **Walidacja w aplikacji**: użytkownik wkleja `License-Key` → `/v1/license/validate` zwraca krótko‑żyjący `JWT` (10–15 min) z `license_id`, `plan`, `quota_remaining`.
- **Liczenie znaków**: inkrementacja w `usage_monthly` w trakcie `/v1/tts` na podstawie długości tekstu źródłowego (po czyszczeniu SSML). Blokada przy przekroczeniu limitu.

### 4c. Prosty przepływ integracji Stripe (proponowany)
1. Wtyczka: link „Kup/zarządzaj” → otwarcie Stripe Checkout/Portal w przeglądarce.
2. Webhook w Workers: po aktywacji/zmianie planu tworzy/aktualizuje rekord licencji i wysyła klucz.
3. Użytkownik wkleja klucz w ustawieniach wtyczki → `/v1/license/validate` → otrzymuje `JWT`.
4. Każde żądanie `/v1/tts` z `JWT` – backend nalicza znaki, proxy‑uje stream do Azure/OpenAI.
5. Przy przekroczeniu limitu: `402` + link do podniesienia planu (Portal Stripe).


### 5. Kryteria weryfikacji i testy (Definition of Done)
Weryfikacja polega na potwierdzeniu poniższych punktów:
- TTS i wydajność:
  - Dla notatki do 10 000 znaków: czas do pierwszego dźwięku (rozpoczęcia odtwarzania) < 2 s (przy stabilnym łączu), zakończenie generacji < 5 s.
  - Dla notatek do 50 000 znaków: poprawny podział na fragmenty po 10 000 znaków, automatyczne odtwarzanie kolejnych części bez ręcznej interwencji.
- Dobór języka:
  - Automatyczna detekcja dominującego języka na podstawie treści ustawia `xml:lang` odpowiednio (PL/EN). Test na trzech próbkach: w pełni PL, w pełni EN, mieszana (wybierany język dominujący).
- Głos i format:
  - Domyślnie używany głos `en-US-Ava3:DragonHDLatestNeural` oraz domyślny format `mp3`.
- Odtwarzanie i offline:
  - Dostępne i działające kontrolki: `play/pause`, `stop`, `restart`, `download`, `speed`.
  - Jeżeli istnieje lokalny plik audio w `Audio/`, jest odtwarzany bez wywołań do backendu; przy „refresh” następuje regeneracja.
  - Link do wygenerowanego pliku jest automatycznie dopisywany na końcu notatki; nazwy plików są bezpieczne.
- Streaming:
  - Streaming zawsze włączony; odtwarzanie działa na desktop (Windows/macOS), Android i iOS. W przypadku braku wsparcia MSE odtwarzanie następuje po zbuforowaniu.
- Backend/licencje/Stripe (Cloudflare Workers):
  - `License-Key` jest wymieniany na `JWT` ważny 15 min; po wygaśnięciu żądania z przeterminowanym tokenem kończą się `401`, a odświeżenie tokenu działa poprawnie.
  - Zużycie znaków jest naliczane po stronie backendu i widoczne w `/v1/usage`.
  - Limity planów egzekwowane: Free (10k), Basic (100k), Pro (300k); po przekroczeniu limitu zwracane jest `402 Payment Required` z odnośnikiem do podniesienia planu (Stripe Portal).
  - Webhooki Stripe aktualizują status planu/licencji; po zmianie planu nowe limity obowiązują natychmiast.
  - Endpoint `/v1/voices` zwraca listę głosów; cache w KV działa (ten sam wynik w oknie 24 h).
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

### 8. Załączniki
(Linki do repozytoriów, API, przykładowe skrypty/fragmenty kodu, referencje do wzorcowych pluginów.)