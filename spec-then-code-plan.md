# ListenMode — Spec-Then-Code Implementation Plan (spec-then-code-plan.md)

This plan breaks down delivery into clear stages, starting from a minimal, locally working MVP plugin (no backend, no auth, no payments) that you can test in Obsidian. Each stage lists scope, tasks, acceptance criteria mapped to spec-then-code.md, risks, and test checklist. The plan aligns with your rules: use Bun, TypeScript with strict typing, JSDoc for documentation, no global state, short functions, minimal dependencies (remove ramda), and simple jest-like tests via bun:test.

References
- Source spec: spec-then-code.md
- Experimental code for inspiration only: src/main.ts

Principles and constraints
- Bun-first: use bun, bunx, bun test; do not use npm/node directly.
- TypeScript strict: explicit function return types, small, single-purpose functions.
- Documentation: JSDoc-only in code (/** ... */) for public APIs; no // inline comments.
- Tests: *.test.ts via bun:test; short and focused.
- Minimal dependencies: remove ramda; prefer zero-deps utilities.
- No backend in MVP: direct Azure TTS calls from the plugin allowed only in MVP/dev; production will route via backend in later stages.
- File storage: store audio files in vault Audio/; auto-append a link at the bottom of the note.

Stage overview
- Stage 0: Repo hygiene and groundwork
- Stage 1: MVP (local-only, no backend, no auth, no payments)
- Stage 2: Provider abstraction and settings hardening
- Stage 3: Backend proxy (Cloudflare Workers) — licensing, limits, voices cache
- Stage 4: Client licensing flow and limits UI
- Stage 5: Streaming robustness, mobile polish, offline playback
- Stage 6: Observability and error reporting
- Stage 7: Performance tuning and large-note handling
- Stage 8: Docs, onboarding, and pre-release hardening

Stage 0 — Repo hygiene and groundwork
Scope
- Prepare clean module structure for the plugin and tests.
- Remove ramda and refactor utility usage.
- Ensure Bun-based build/dev/test scripts.

Tasks
- Create folders: src/, src/ui/, src/tts/, src/utils/, src/obsidian/, tests/.
- Add modules: src/index.ts (entry), src/obsidian/settings.ts, src/ui/panel.ts, src/tts/azure.ts, src/utils/chunk.ts, src/utils/ssml.ts, src/utils/fs.ts, src/utils/safe-name.ts, src/types.ts.
- Update package.json: remove ramda and @types/ramda; keep esbuild, typescript.
- tsconfig: strict already enabled; validate lib and types.

Acceptance criteria mapping
- spec §4 (arch, TS), §4.6 (remove ramda).

Risks
- None significant.

Tests
- Add smoke test scaffolding with bun:test that imports small utils (chunking, safe-name) and validates behavior.

Stage 1 — MVP (Local, no backend, no auth, no payments)
Scope
- A usable Obsidian plugin generating audio from current note via Azure AI Speech REST, saving to Audio/, linking at bottom, and offering minimal playback controls. Desktop and mobile should work; streaming best-effort.

Key capabilities
- Command palette actions: read-current-note, stop-playback, restart, toggle-controls.
- New command: Download audio (no playback) — generate and save all parts without playing; uses settings.chunkSize.
- Settings UI: azureRegion, azureApiKey, voiceName (manual text, optional fetch), outputFormat, rate (SSML), enableStreaming, chunkSize (500–9000; default 5000), audioFolder.
- Mobile UI: Ribbon menu integration as primary access (always visible, 1-click) via Obsidian toolbar; optional draggable floating panel (touch + mouse) constrained to viewport; default offset above mobile bottom navigation; collapsible header; position persisted across sessions; safe positioning away from system buttons.
- Text processing: split into <= chunkSize (default 5,000; max 9,000) preferring sentence boundaries; if a sentence exceeds limit, split by words; language selection default to pl-PL (configurable later).
- Synthesis: build SSML, call POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1 with X-Microsoft-OutputFormat.
- Streaming: attempt MSE for mp3/wav; fallback to capture entire response then play.
- Storage: write to Audio/ as {safe-basename}_part_{n}.{mp3|wav}; append [[relPath]] at note end.

Tasks
- src/types.ts: define TtsSettings, PlaybackSession types.
- src/utils/safe-name.ts: safe base name for file paths.
- src/utils/chunk.ts: chunking by sentence boundaries with max length; no deps.
- src/utils/ssml.ts: generate SSML with voice/rate/lang and properly escaped content.
- src/utils/fs.ts: vault helpers for ensureFolder, writeBinary, appendLink.
- src/ui/panel.ts: minimal floating panel with play/pause, stop, restart, download, speed slider; hide/show capability and collapsed state.
- src/tts/azure.ts: startHttpStream, captureToBlob, detect MIME based on outputFormat.
- src/obsidian/settings.ts: settings tab with fields above; optional “Fetch voices” button using Azure GET voices/list (MVP convenience, skipping backend).
- src/index.ts: main plugin class wiring commands, playback session state, calling azure synth.
- Add command `listenmode-download` implementing non‑playback generation of all chunks and saving to Audio/ with link updates.
- Remove all ramda usage from logic; replace with native arrays/strings.
- Mobile UI (Ribbon only):
  - index.ts: add ribbon entry using addRibbonIcon ('headphones' → 'Play/Pause current note').
  - No floating panel, no draggable, no position persistence.

Acceptance criteria mapping
- spec §3.1 TTS (format mp3/wav, voices, rate), §3.2 playback and controls (including mobile ribbon/draggable/persistence), §3.3 storage/linking, §3.7 docs/onboarding (brief README section), §4.1 Azure endpoints, §4.3 frontend controls, §4a defaults.

Risks
- iOS autoplay and MSE support may limit streaming; MVP must fallback gracefully to after-download playback.

Tests (bun test)
- utils/chunk.test.ts: chunk size and sentence-boundary behavior.
- utils/safe-name.test.ts: path-safe outputs.
- utils/ssml.test.ts: escaping &, <, > and rate insertion.
- tts/azure.test.ts: MIME detection for formats; stream-to-blob assembly with fake reader.

Stage 2 — Provider abstraction and settings hardening
Scope
- Introduce TtsProvider interface and AzureTtsProvider implementation; prepare optional OpenAI provider later without changing UI.
- Harden settings validation and surfacing of missing fields.

Tasks
- types: export TtsProvider { synthesize(ssml, format, language): ReadableStream<Uint8Array>; listVoices(): Promise<Voice[]> }.
- Refactor Stage 1 azure module to implement interface; add provider switch in settings (default azure).
- Improve user notices for missing settings.

Acceptance criteria mapping
- spec §4.1a provider abstraction; §3.6 stability (clear errors).

Risks
- None significant.

Tests
- Provider switch unit test with a mock provider.

Stage 3 — Backend proxy (Cloudflare Workers)
Scope
- Implement minimal Workers backend to proxy TTS and voices; secure provider keys; basic license entities scaffold (no UI yet).

Tasks
- Worker routes: POST /v1/tts (stream), GET /v1/voices; env secrets for Azure; basic logging.
- KV cache for voices 24h; D1 schema scaffolding (licenses, usage_monthly) without enforcing yet.
- Client: switch to backend URLs with a “Use backend” toggle; default off in MVP channel.

Acceptance criteria mapping
- spec §4.2 backend goals, §4.4 security (no provider keys in client), §4.6 dependencies minimal.

Risks
- Streaming compatibility and edge buffering — validate with MSE.

Tests
- Worker integration tests with wrangler dev; client fetch mocked.

Stage 4 — Client licensing flow and limits UI
Scope
- License-key input and validation, token handling, monthly char limits UI, and error surfaces.

Tasks
- Settings: licenseKey input; Validate -> backend /v1/license/validate to short-lived JWT stored in memory and persisted only as license key.
- Add remaining quota indicator in panel or settings.
- Handle 402 from /v1/tts with a Notice linking to Stripe portal.

Acceptance criteria mapping
- spec §4.2 API, §4b Stripe models, §5 DoD backend/licensing bullets.

Risks
- Token refresh cadence; ensure silent refresh or clear messaging.

Tests
- License happy-path and expired token handling (mock backend).

Stage 5 — Streaming robustness, mobile polish, offline playback
Scope
- Make streaming default and robust across desktop/mobile; prefetch next chunk; reliable offline playback of existing files.

Tasks
- Implement small buffer threshold before auto-play; detect MSE support and device quirks; allow disable streaming in settings.
- iOS default: Buffered (Prefetch) mode with chunkSize forced to 500 and prefetch of 2–3 parts to ensure gapless playback.
- Desktop fallback: when MSE is unavailable or streaming fails, switch to Buffered Prefetch (window=3) and surface a Notice informing about the fallback.
- If file exists in Audio/, play without generating unless user clicks Refresh.
- Add collapsed/expanded panel header toggle and showControls setting persistence.

Acceptance criteria mapping
- spec §3.2 playback, §4.3 streaming default, §4.5 performance, and §4.1 iOS default Buffered (Prefetch) with forced `chunkSize=500`; desktop fallback to Buffered Prefetch (window=3) with user Notice when streaming fails.

Risks
- Mobile WebView limitations, iOS auto-play; require user gesture.

Tests
- E2E manual checklist on macOS, Windows, Android, iOS; unit tests for file-exists branch.
- Verify desktop fallback: force a streaming error/unavailable MSE and confirm automatic switch to Buffered Prefetch (window=3) and that a Notice is shown to the user.

Stage 6 — Observability and error reporting
Scope
- Lightweight telemetry and error reporting; user-facing error clarity.

Tasks
- Workers Analytics Engine events for errors/latency; client notices for common failure modes; local error log export (optional).

Acceptance criteria mapping
- spec §4.4a monitoring, §3.6 stability, §5 monitoring DoD.

Risks
- Privacy boundaries; keep strictly to metadata, allow opt-out.

Tests
- Validate events fired and visible in Analytics; unit assertions on error mapping.

Stage 7 — Performance tuning and large-note handling
Scope
- Automatic language detection, improved chunking (<= 10,000 chars), playback continuity, prefetch pipeline.

Tasks
- Language heuristics for xml:lang from note content; ensure chunk cutoff at sentence boundaries; prefetch next chunk while playing current.

Acceptance criteria mapping
- spec §3.1 long notes and languages, §4.5 performance.

Risks
- Over-detection on mixed-language notes; keep simple and configurable.

Tests
- Three language samples PL/EN/MIX; chunk prefetch behavior unit tests.

Stage 8 — Docs, onboarding, and pre-release hardening
Scope
- Tight README/How-to/FAQ; first-run flow; polishing details.

Tasks
- README sections: installation, dev build via Bun, VAULT_PATH copy, first audio in 3 clicks, settings explained, troubleshooting.
- “First run” tips notice in plugin: set keys/region; link to docs.
- Final acceptance criterion sweep; remove “dev-only” feature flags for release channel.

Acceptance criteria mapping
- spec §3.7 documentation and onboarding; §5 DoD final checks.

Risks
- None.

Tests
- Docs lint; manual onboarding test from scratch.

MVP module responsibilities (Stage 1)
- src/index.ts
  - Register commands: play-pause-current-note, stop-playback, restart.
  - Orchestrate reading current file, chunking, SSML build, streaming or buffered play, saving and linking output files.
  - Manage PlaybackSession and UI updates.
- src/obsidian/settings.ts
  - Settings tab with Azure fields, streaming toggle, audioFolder; optional “Fetch voices” calling Azure voices/list.
// Panel UI removed in MVP.
- src/tts/azure.ts
  - startHttpStream(azureApiKey, region, voiceName, outputFormat, ssml, abort): Promise<ReadableStream<Uint8Array>>.
  - captureToBlob(stream, onChunk?, outputFormat): Promise<Blob>.
  - MIME detection for mp3/wav based on format string.
- src/utils/chunk.ts
  - splitTextSmart(text, maxChars = 10000): string[] preferring sentence boundaries.
- src/utils/ssml.ts
  - escapeXml(str), buildSsml({ text, voiceName, rate, lang }): string.
- src/utils/safe-name.ts
  - toSafeBase(input): string.
- src/utils/fs.ts
  - ensureFolder(app, path), writeBinary(app, path, ArrayBuffer), appendAudioReference(app, file, relPath).
- src/types.ts
  - TtsSettings, PlaybackSession, Voice types.

File/folder structure (evolves by stage)
- src/
  - index.ts
  - obsidian/settings.ts
  - tts/azure.ts
  - (no ui/panel.ts)
  - utils/{chunk.ts, ssml.ts, safe-name.ts, fs.ts}
  - types.ts
- tests/
  - utils/{chunk.test.ts, safe-name.test.ts, ssml.test.ts}
  - tts/azure.test.ts
- Audio/ (vault folder at runtime)

Build, dev, and test with Bun
- Build once:
  - bun run build
- Watch/dev:
  - bun run dev
- Typecheck:
  - bun run typecheck
- Test:
  - bun test
- Copy to your vault (requires VAULT_PATH env):
  - bun run deploy

Note: package.json should not depend on ramda; ensure external:obsidian in esbuild; output main.js, manifest.json present.

Acceptance criteria traceability (MVP)
- §3.1 TTS: mp3/wav, voice selection (manual or fetched), SSML with rate +10% default, pl-PL by default, EN optional later.
- §3.2 Playback: controls via Ribbon/Commands (Play/Pause, Stop, Restart); refresh via Restart; sequential playback — next chunk starts after previous ends; no download (files in Audio/ and links).
- §3.3 Integration: store under Audio/, append [[relPath]] at note bottom; reuse existing audio unless refresh.
- §3.6 Stability: clear notices for missing settings and TTS errors; abort/stop behavior.
- §3.7 Docs/Onboarding: README quick start; 3 clicks to first audio.
- §4.1 Azure endpoints and formats; §4a defaults applied; §4.6 remove ramda.

Migration from experimental src/main.ts
- Keep as a reference only; re-implement in modules listed above.
- Replace Ramda-based chunking with native implementation.
- Retain practical UX learnings: MSE attempt + fallback, speed slider mapping from rate.
- Remove direct UI styles duplication; centralize in ui/panel.ts.

Open questions and decisions
- Language selection default: Start with pl-PL; add setting in Stage 2; add automatic detection in Stage 7.
- iOS streaming: If MSE not supported, default to buffered playback; require user gesture to start.
- Audio format default: audio-24khz-48kbitrate-mono-mp3; allow wav.

Testing strategy notes
- Keep tests tiny and isolated; verify algorithms and MIME decisions.
- E2E manual checklist for MVP across platforms; automate later stages around backend.

Operational checklist per stage
- Update spec-then-code.md if decisions or flows change.
- Keep JSDoc current on public functions.
- Run: bun test, bun run typecheck, bun run build before tagging stage complete.
- Verify vault copy to test plugin in Obsidian.

Definition of Done per stage
 - Stage 1 MVP is done when: you can install the plugin, set Azure key/region/voice, run Play/Pause current note from Ribbon/Commands, get audio in \u003c5s for small notes, Audio/ has files, link appended to note.
- Later stages: DoD mirrors acceptance criteria listed under each stage above.


Stage 0 status update (2025-08-19)
- Completed
  - Repo structure scaffolded:
    - src/index.ts (entry), src/utils/{safe-name.ts, chunk.ts}, src/ui/panel.ts, src/obsidian/settings.ts, src/tts/azure.ts, src/types.ts.
    - tests/utils/{safe-name.test.ts, chunk.test.ts} using bun:test.
  - Bun-first setup verified:
    - package.json scripts build/dev/watch now target src/index.ts with esbuild external:obsidian.
    - ramda and @types/ramda removed from dependencies.
    - Added bun-types and configured tsconfig types: ["obsidian", "bun-types"].
    - Typecheck passes (bunx tsc --noEmit), tests pass (bun test), build produces main.js.
  - tsconfig updated to include tests/ and exclude legacy src/main.ts from typecheck.
- Notes
  - The legacy experimental src/main.ts remains in the repo for reference but is excluded from typecheck; it will be superseded by new modules in Stage 1.
- Next actions (Stage 1)
  - Implement MVP modules: utils/ssml.ts, tts/azure.ts streaming + blob, obsidian/settings.ts full settings, ui/panel.ts controls, command wiring in index.ts, file save/link.
  - Add minimal README quick start for building and deploying to a vault.
- Decisions requested
  - SSML language default: keep pl-PL for MVP, or expose a language setting immediately?
  - Output folder name: "Audio" (capital A as in spec) vs "audio" (lowercase)?
  - Legacy file handling: keep src/main.ts in place for now, or move it to docs/legacy/ to avoid confusion?

Stage 1 status update (2025-08-19)
- Implemented (MVP basics)
  - Settings now include Language dropdown: auto | pl-PL | en-US. Auto uses a lightweight heuristic (Polish diacritics) to choose pl-PL vs en-US at runtime.
  - Audio output folder default is "Audio" (capital A) per spec.
  - Voice picker: added "Fetch voices for region" button (Azure voices/list) and a toggle "Only HD neural voices" to filter results to Neural + HD (e.g., DragonHD). Dropdown is populated from the filtered list and persists selection.
  - Legacy experimental code moved to docs/legacy/experimental-main.ts and excluded from typecheck.
  - MVP orchestration implemented: chunking (\u003c=10k), SSML building, Azure REST fetch (temporary non-streaming for reliability) saving under Audio/{safe}_part_{n}.mp3|wav, and auto-append link at note bottom (no duplicates).
  - Minimal floating control panel with play/pause, stop, restart, speed slider. Download control removed.
- Next steps
  - Manual validation in Obsidian (desktop + mobile): playback, saving, links, controls.
  - Re-enable default streaming (MSE) with robust fallback on environments without MSE (including iOS). Streaming remains default ON on all platforms; iOS path will be tested and adjusted if needed.
  - Optionally iterate on voice filtering heuristics (provider-specific tags) and language heuristic as we gather feedback.

Stage 1 status update (2025-08-20)
- Implemented (streaming path + debug)
  - Streaming re-enabled with immediate playback using MediaSource for MIME derived from settings (mp3 → audio/mpeg, wav → audio/wav). On environments without MSE or on failures, automatic fallback to buffered path.
  - Streaming pipeline: startHttpStream() → SourceBuffer append queue (avoids update conflicts) → concurrent captureToBlob() → save to Audio/ and append link after stream completes.
  - “Debug logs” setting added; centralized logger (src/utils/logger.ts) gates log/warn without scattering conditionals. Logs include streaming candidate, stream opened, sourceopen, appending chunks, and total bytes.
  - Saved file format remains exactly as selected in settings (e.g., mp3); streaming uses the same format when possible.
- Notes
  - Removed any mention of "download-last-audio" from Stage 1 scope.
  - Buffered fallback is seamless and surfaced via Notice.

Stage 1 status update (2025-08-22)
- Simplified controls (no floating panel)
  - Removed floating control panel and mini button across desktop/mobile.
  - Control surface unified to Ribbon + Commands: Play/Pause current note, Stop, Restart.
  - Ribbon icon switched to 'headphones' with Play/Pause behavior.
  - Speed is configured via settings (SSML rate → playbackRate mapping).
- Settings cleaned up
  - Removed showControls and panelPosition from TtsSettings and settings UI.
- Docs updated
  - spec-then-code.md and spec-then-code-plan.md updated to reflect Ribbon/Commands-only control model.

