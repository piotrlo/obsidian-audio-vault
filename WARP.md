# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

Repository purpose
- Obsidian plugin "AudioVault" that converts the current note to speech using Azure AI Speech and saves audio files into the vault for playback and offline use.

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
- Linting:
  - bun run lint
  - bun run lint:fix

High-level architecture
- Entry/plugin lifecycle (src/index.ts)
  - Exports the default Plugin subclass. On load: reads settings, registers commands, and adds the headphones ribbon icon.
  - Core command readCurrentNote():
    - Validates required settings (Azure API key, region, voice, format).
    - Reads active note, splits into chunks (<= 5000 chars) using utils/chunk.ts.
    - Determines language (pl-PL/en-US) via utils/lang.ts and derives voice language via utils/ssml.ts.
    - Builds SSML (utils/ssml.ts) and calls Azure TTS REST (src/tts/azure-provider.ts) or backend proxy.
    - Plays the resulting audio, writes files to vault (utils/fs.ts), and appends links at the end of the note.
    - Respects an optional force regeneration path (deletes prior parts before regenerating).
  - Playback session state is tracked in-memory (types in src/types.ts). Commands include start/read, stop, restart.

- Settings UI (src/obsidian/settings.ts)
  - Builds Obsidian settings tab for: Azure API Key/Region or Backend mode, Voice picker (with on-demand fetch from Azure voices/list), Output format, SSML rate, Streaming toggle, Audio folder, Language (auto/pl-PL/en-US).

- TTS Providers (src/tts/)
  - AzureTtsProvider: Direct Azure AI Speech integration using REST API.
  - BackendTtsProvider: Proxied requests through backend for licensing/limits.
  - Abstract TtsProvider interface for extensibility.

- Playback Engine (src/playback/)
  - streaming.ts: MediaSource Extensions (MSE) for real-time playback.
  - buffered.ts: Fallback for environments without MSE support.
  - existing.ts: Reuse of previously generated audio files.
  - Platform-specific optimizations (iOS uses aggressive prefetch with concurrency=5).

- Utilities
  - utils/chunk.ts: splitTextSmart() sentence-aware chunking with max length.
  - utils/ssml.ts: escapeXml(), deriveLangFromVoiceName(), buildSsml().
  - utils/lang.ts: simple heuristic to choose pl-PL vs en-US by detecting Polish diacritics.
  - utils/safe-name.ts: toSafeBase() for vault-safe filenames.
  - utils/fs.ts: ensureFolder(), writeBinary(), appendAudioReference(), deleteExistingParts().
  - utils/sanitize.ts: sanitizeNoteForTts() removes non-readable content (HTML, code blocks, frontmatter).
  - utils/mp3.ts: MP3 assembly for merged output files without re-encoding.
  - network/retry.ts: robust retry logic with exponential backoff for network operations.

- Types and Validation
  - src/types.ts: TtsSettings (persisted plugin configuration), PlaybackSession (ephemeral playback bookkeeping), Voice (minimal voice info type).
  - src/schema.ts: Zod schemas for runtime validation of API responses and user input.

- Core Architecture
  - src/core/settings.ts: settings management and validation.
  - src/core/audio.ts: audio processing and playback orchestration.
  - src/core/helpers.ts: shared utility functions.
  - src/core/notify.ts: user notification and error handling.

Notes
- Build output is main.js (bundled from src/index.ts) and consumed by Obsidian via manifest.json ("main": "main.js").
- The deploy script syncs manifest.json, main.js, styles.css (if present) into "$VAULT_PATH/.obsidian/plugins/audio-vault".

Conventions and tests
- Language/stack: TypeScript (strict), Bun runtime and tooling.
- Test runner: bun:test, tests live under tests/**/*.test.ts and may also appear close to code.
- Run tests with bun test; keep tests short and focused on single behaviors.
- Coverage: bun test --coverage
- Git hooks: pre-push hook runs tests automatically (see .husky/pre-push).

## Architecture Decisions

### Text-to-Speech Strategy
- **Format**: MP3-only for MVP (streaming + file size optimization)
- **Chunking**: Smart sentence-boundary splitting (≤5000 chars default, configurable)
- **Language Detection**: Heuristic-based Polish/English detection via utils/lang.ts
- **Voice Selection**: Neural HD voices prioritized (Azure Ava3 default)

### Mobile-First Considerations  
- **iOS Limitations**: No MSE support → aggressive background prefetch (concurrency=5)
- **Desktop**: Streaming-first with MSE, buffered fallback (window=3)
- **File Assembly**: Real-time MP3 merging without re-encoding
- **Offline Support**: All generated audio saved locally in vault under Audio/ folder

### Provider Architecture
- **TtsProvider Interface**: Abstract interface for extensibility
- **AzureTtsProvider**: Direct Azure AI Speech integration
- **BackendTtsProvider**: Proxied requests through backend for licensing/limits

Important repository files
- package.json: Bun-based scripts (build/dev/typecheck/test/deploy), esbuild bundling with external:obsidian.
- tsconfig.json: ESNext modules, strict, types: ["obsidian", "bun-types"], includes src and tests, excludes legacy code.
- eslint.config.cjs: ESLint v9+ flat config with TypeScript support, unused imports detection.
- manifest.json: Obsidian plugin manifest (id: audio-vault, main: main.js).
- spec-then-code.md and spec-then-code-plan.md: governing product/tech spec and staged implementation plan; keep them authoritative and updated upon significant changes.

## Development Philosophy

### Spec-Driven Development
- **Authority**: `spec-then-code.md` contains all product/technical decisions
- **Implementation Plan**: `spec-then-code-plan.md` tracks staged development  
- **Traceability**: All features map back to acceptance criteria in spec
- **Change Management**: Spec updates required for any architectural changes

### Code Standards
- **TypeScript**: Strict typing with explicit return types, small focused functions
- **Testing**: bun:test for unit tests, short and focused on single behaviors  
- **Documentation**: JSDoc comments for public APIs only (/** ... */)
- **Dependencies**: Minimal external dependencies, prefer Bun over npm/node
- **State Management**: No global state, pure functions with dependency injection
