# ListenMode — Quick Start (README)

Build, test, and deploy (Bun)
- Build once:
  - bun run build
- Watch/dev:
  - bun run dev
- Typecheck:
  - bun run typecheck
- Run tests:
  - bun test
- Deploy to your Obsidian vault (requires VAULT_PATH):
  - VAULT_PATH="/path/to/YourVault" bun run deploy

Using the plugin in Obsidian
- Enable the plugin (obsidian-azure-speech-tts) in Settings → Community plugins.
- Configure Settings → ListenMode:
  - Azure API Key and Region (e.g., westeurope).
  - Voice (optionally fetch from Azure list), Output format (e.g., audio-24khz-48kbitrate-mono-mp3), Rate (SSML), Streaming (on), Show controls, Audio folder, Language (auto/pl-PL/en-US), Debug logs (optional).
- Open any note and run the command: “ListenMode: Read current note”.
  - If an audio file already exists in Audio/ for the note, it will play immediately (unless you restart/refresh).
  - Otherwise, the note will be split into chunks (
0=10k chars), streamed to Azure, played immediately (MSE), saved to Audio/, and a link is appended at the end of the note.

Streaming and fallback
- When supported (desktop browsers), audio starts instantly via MediaSource (mp3 → audio/mpeg, wav → audio/wav).
- If streaming is not supported or fails, the plugin falls back to a buffered path — it downloads the audio for each chunk and then plays it.

Debugging
- Toggle “Debug logs” in settings to print detailed diagnostics to the console (Developer Tools → Console). Logs are prefixed with [ListenMode].

Notes
- Files are saved into Audio/ in your vault and linked at the end of the note. Duplicate links are prevented.
- The floating panel provides Play/Pause, Stop, Restart, and a speed slider; it can be collapsed via the header chevron.
