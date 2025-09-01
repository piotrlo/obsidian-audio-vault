# AudioVault — iOS Background Resilience & Prefetch Plan

## Problem
- iOS po zgaszeniu ekranu ogranicza połączenia sieciowe w tle: streaming/przedbuforowanie może się zatrzymać.
- Brak komunikatu użytkownika o przerwaniu.
- Scalony plik MP3 powstaje dopiero po ostatnim chunku, więc w razie przerwania postęp przepada.

## Cele
- Szybki start: część 1 odtwarzana jak najszybciej.
- Agresywny prefetch: pobieranie wszystkich części do końca z limitem współbieżności (iOS domyślnie 5), niezależnie od postępu odtwarzania.
- Zapis per‑part zawsze włączony na iOS (nawet przy merge), aby móc kontynuować offline.
- Partial merge snapshot: okresowe zapisy „<base>.partial.mp3”, finalizacja do „<base>.mp3” po całości.
- Wznowienie po przerwaniu: po ponownym uruchomieniu wykryj pobrane części i dokończ brakujące; scalenie finalizuj automatycznie.
- Czytelne Notice przy przerwaniu i wznowieniu pobierania.

## Architektura i podejście

### 1) PrefetchOrchestrator (nowy moduł)
- Cel: pobrać wszystkie części w tle z limitem współbieżności, niezależnie od odtwarzania.
- API (propozycja):
  - prefetchAllParts(params) -> { tasks: Promise<PrefetchResult>[], controller: AbortController, onProgress(cb) }
  - Każdy task zwraca: { idx, buffer: ArrayBuffer, mime: string }.
  - Po pobraniu części: zapis do Audio/<base>_part_<n>.<ext> + upsert link w notatce; aktualizacja manifestu; opcjonalnie appendToMerged i flushPartial.

### 2) Playback współgrający z Prefetch
- iOS: w readCurrentNote() uruchom orchestrator (concurrency=5), odtwórz część 1 natychmiast po pobraniu, kolejne odtwarzaj z dysku lub po zakończeniu tasków.
- Desktop: bez zmian (streaming → fallback buffered jak dotąd).

### 3) Zapis per‑part zawsze ON (iOS)
- W iOS/buffered i fallback streaming→buffered wymuś savePerPart=true.
- Przy merge assembler zbiera dane równolegle; zapis per‑part zapewnia odporność na sieć.

### 4) Partial merge snapshot
- Po każdej części (lub co N części) nadpisz Audio/<base>.partial.mp3 skumulowanym payloadem z Mp3Assembler.
- Po zakończeniu pobierania wszystkich części zapisz finalny Audio/<base>.mp3, zaktualizuj link (single), usuń .partial.mp3 i manifest.

### 5) Manifest (wznowienia)
- Plik: Audio/<base>.manifest.json
- Przykład:
      {
        "version": 1,
        "ext": "mp3",
        "totalParts": 12,
        "fetchedParts": [1,2,3],
        "mergedUntil": 2,
        "updatedAt": 1735584000000
      }
- Przy starcie: sprawdź manifest i istniejące pliki *_part_N.<ext>, uzupełnij fetchedParts.
- Orchestrator pobiera tylko brakujące; po każdym sukcesie aktualizuje manifest (atomowo: write tmp + rename).

### 6) Notice i obsługa błędów
- Na przerwanie/abort: Notice("Network paused; playback will continue from downloaded parts. Open Obsidian to resume downloads.").
- Na wznowienie pobierania: Notice("Resumed background downloads (iOS)").
- Błędy części: delikatny backoff lokalnie; w backend mode retry zgodnie ze spec.

## Zmiany w kodzie (pliki i zakres)
- src/index.ts
  - iOS: uruchom PrefetchOrchestrator (concurrency=5), odtwarzaj część 1 natychmiast; kolejne z dysku.
  - W fallbackach do buffered: savePerPart=true; finalizacja merge po ostatniej części (replaceAudioReferencesWithSingle, remove .partial/manifest).
- src/playback/prefetch.ts (nowy)
  - Implementacja prefetchAllParts z limitem współbieżności, zapisem do plików, aktualizacją manifestu, appendToMerged oraz flushPartial.
- src/playback/buffered.ts
  - Współpraca z orchestratora (param prefetchWindow już wspierany); opcjonalnie przemodelować konsumpcję „z dysku”.
- src/playback/streaming.ts
  - Bez zmian dla desktop; fallback jak dotąd.
- src/utils/mp3.ts
  - Dodać flushPartial(basePath, assembler, mergedUntil).
- src/utils/fs.ts
  - readManifest(path), writeManifest(path, data), scanExistingParts(folder, base, ext), safeRename(oldPath, newPath).
- src/core/notify.ts
  - Komunikaty „pause/resume”.
- src/types.ts
  - interface PrefetchResult { idx: number; buffer: ArrayBuffer; mime: string }
  - interface AudioManifest { version: number; ext: string; totalParts: number; fetchedParts: number[]; mergedUntil: number; updatedAt: number }

## Testy (bun:test)
- tests/playback/prefetch.test.ts
  - Prefetch wszystkich części z limitem K (mock provider): tworzy N plików; wznowienie z manifestem pobiera tylko brakujące.
- tests/playback/buffered.prefetch.integration.test.ts
  - iOS: część 1 odtwarza się natychmiast; kolejne nie blokują się na sieci, grają z dysku.
- tests/utils/mp3.partial.test.ts
  - flushPartial nadpisuje .partial.mp3; finalizacja zamienia na <base>.mp3.
- tests/core/notice.background.test.ts
  - Notice przy przerwaniu i przy wznowieniu.

## Dokumentacja do zaktualizowania
- spec-then-code.md — sekcja 3.2 (Mobile/iOS): agresywny prefetch, zapis per‑part, partial merge snapshot, wznowienia z manifestu.
- README.md — Mobile optimized: informacja o background prefetch i zapisie per‑part na iOS; brak nowych ustawień.

## Parametry i domyślne wartości
- iOS prefetch concurrency: 5 (stała; bez UI).
- Partial flush co: 1 część (później można zwiększyć do co N).

## Ryzyka i mitigacje
- I/O i ilość plików: sprzątanie parts po finalizacji merge.
- Throttling dostawcy: 5 równoległych pobrań + łagodny backoff.
- Niespójny manifest po crashu: atomiczne zapisy (tmp + rename).

## Plan wdrożenia (kroki)
1) Dodać src/playback/prefetch.ts + typy i manifest w types.ts.
2) Dodać helpers w utils/fs.ts (manifest, scan parts, safe rename).
3) W index.ts (iOS): uruchomić orchestrator, wymusić savePerPart=true, start od części 1.
4) utils/mp3.ts: flushPartial po każdej części; finalizacja pliku scalonego.
5) Notice na przerwanie i wznowienie.
6) Testy: prefetch, resume, partial, iOS playback; poprawić istniejące jeśli wpływa logika.
7) Aktualizacja dokumentacji (spec + README).

## Mapa plików kontekstu (dla nowego Agenta)
- src/index.ts — główny przepływ, decyzje iOS/desktop.
- src/playback/buffered.ts — odtwarzanie w trybie buforowanym.
- src/playback/streaming.ts — odtwarzanie via MSE + fallback.
- src/playback/session.ts — cleanup zasobów audio.
- src/playback/existing.ts — odtwarzanie istniejących plików lokalnych.
- src/utils/mp3.ts — assembler MP3 i operacje na payloadzie.
- src/utils/fs.ts — zapisy/odczyty plików, linki w notatce.
- src/core/audio.ts — captureToBlob, canStream, helpery audio.
- src/core/helpers.ts — fileExtFromFormat, playbackRateFromRateSetting.
- src/core/notify.ts — komunikaty w UI.
- src/types.ts — TtsSettings, PlaybackSession (+ PrefetchResult, AudioManifest do dodania).
- Testy referencyjne:
  - tests/playback/buffered.test.ts, tests/playback/streaming.*.test.ts
  - tests/utils/mp3.test.ts
  - tests/utils/fs.more.test.ts
  - tests/core/audio.*.test.ts
