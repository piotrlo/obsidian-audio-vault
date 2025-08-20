# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

Repository purpose
- Obsidian plugin "ListenMode" that converts the current note to speech using Azure AI Speech and saves audio files into the vault for playback and offline use.

Commands (Bun-first)
- Install deps (Bun handles install automatically on first run):
  - bun install
- Build once:
  - bun run build
- Build and watch (dev loop):
  - bun run dev
- Type-check (strict TS):
  - bun run typecheck
- Run all tests:
  - bun test
- Run a single test file:
  - bun test tests/utils/safe-name.test.ts
  - bun test tests/utils/chunk.test.ts
- Deploy built plugin to an Obsidian vault (requires VAULT_PATH env pointing to your vault directory):
  - VAULT_PATH="/path/to/YourVault" bun run deploy

Notes
- Linting: there is no linter configured in this repo.
- Build output is main.js (bundled from src/index.ts) and consumed by Obsidian via manifest.json ("main": "main.js").
- The deploy script syncs manifest.json, main.js, styles.css (if present) into "$VAULT_PATH/.obsidian/plugins/obsidian-azure-speech-tts".

High-level architecture
- Entry/plugin lifecycle (src/index.ts)
  - Exports default Plugin subclass. On load: reads settings, registers commands, and optionally renders a floating control panel.
  - Core command readCurrentNote():
    - Validates required settings (Azure API key, region, voice, format).
    - Reads active note, splits into chunks (<= 10k chars) using utils/chunk.ts.
    - Determines language (pl-PL/en-US) via utils/lang.ts and derives voice language via utils/ssml.ts.
    - Builds SSML (utils/ssml.ts) and calls Azure TTS REST (src/tts/azure.ts) using a non-streaming fetch for reliability.
    - Plays the resulting Blob, writes audio to vault (utils/fs.ts), and appends a link at the end of the note (deduplicated).
    - Respects an optional force regeneration path (deletes prior parts before regenerating).
  - Playback session state is tracked in-memory (types in src/types.ts). Commands include start/read, stop, restart, toggle controls, and rate adjustments.

- Settings UI (src/obsidian/settings.ts)
  - Builds Obsidian settings tab for: Azure API Key/Region, Voice picker (with on-demand fetch from Azure voices/list, optional HD neural filter), Output format, SSML rate, Streaming toggle, Show controls, Audio folder, Language (auto/pl-PL/en-US).

- UI panel (src/ui/panel.ts)
  - Minimal floating panel injected into the DOM with buttons (⏯, ⏹, 🔁) and a playback speed slider mapped from SSML rate.

- TTS adapter (src/tts/azure.ts)
  - fetchTtsAudio(): single-shot synthesis via HTTPS, returns ArrayBuffer and MIME resolution via mimeFromFormat().
  - startHttpStream() and captureToBlob(): streaming helpers are present for future streaming mode; current default path uses non-streaming fetch for reliability.

- Utilities
  - utils/chunk.ts: splitTextSmart() sentence-aware chunking with max length.
  - utils/ssml.ts: escapeXml(), deriveLangFromVoiceName(), buildSsml().
  - utils/lang.ts: simple heuristic to choose pl-PL vs en-US by detecting Polish diacritics.
  - utils/safe-name.ts: toSafeBase() for vault-safe filenames.
  - utils/fs.ts: ensureFolder(), writeBinary(), appendAudioReference(), deleteExistingParts().

- Types (src/types.ts)
  - TtsSettings: persisted plugin configuration.
  - PlaybackSession: ephemeral playback bookkeeping.
  - Voice: minimal voice info type.

Conventions and tests
- Language/stack: TypeScript (strict), Bun runtime and tooling.
- Test runner: bun:test, tests live under tests/**/*.test.ts and may also appear close to code.
- Run tests with bun test; keep tests short and focused on single behaviors.

Important repository files
- package.json: Bun-based scripts (build/dev/typecheck/test/deploy), esbuild bundling with external:obsidian.
- tsconfig.json: ESNext modules, strict, types: ["obsidian", "bun-types"], includes src and tests, excludes legacy code.
- manifest.json: Obsidian plugin manifest (id: obsidian-azure-speech-tts, main: main.js).
- docs/legacy/experimental-main.ts: previous experimental implementation; excluded from type-checks; do not modify for MVP.
- spec-then-code.md and spec-then-code-plan.md: governing product/tech spec and staged implementation plan; keep them authoritative and updated upon significant changes.

