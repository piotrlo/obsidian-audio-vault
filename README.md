# AudioVault 🎧

**Turn an Obsidian note into an MP3 — one button, no studio panel.**

[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-7C3AED)](https://obsidian.md)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

AudioVault is deliberately small. It is for notes you want to hear on a walk, in a car, while cooking — not for audiobooks, chapters, or playlists. You open a note, press the headphones icon, and listen. The MP3 lands in your vault so it plays later with no key, no API call, and no internet.

## ✨ How it works

1. **Open** a note.
2. **Click** the headphones icon in the ribbon — or run **Play/Pause current note** from the command palette.
3. **Listen** as soon as the first part is ready. The finished MP3 is saved to your vault.

That is the whole interface: one ribbon button, four commands, one settings tab.

| Command (palette) | What it does |
| --- | --- |
| **Play/Pause current note** | Generates and plays; press again to pause or resume |
| **Download audio (no playback)** | Prepares audio at home, listen later in the car |
| **Regenerate and play current note** | Re-records when the note text changed |
| **Stop** | Cancels generation and playback |

The ribbon label doubles as status: it shows generation progress (`3/8 parts`) and whether the saved MP3 is ready, outdated, or missing. No side panels, no queues, no library view.

## 🎙️ Voice quality

Speech comes from **Cartesia Sonic 3.6** — the model that has held the top of blind-listening leaderboards since its September 2026 release (#1 on VoiceArena, top-tier on Artificial Analysis), with 44 languages and a word error rate around 1.5% in independent benchmarks. It is one of the very few TTS APIs where a note sounds like a person reading it rather than a screen reader.

## 💵 What it costs (honest numbers)

AudioVault does not sell anything. You bring your own free [Cartesia](https://play.cartesia.ai/sign-up) key, and their plans apply:

- **Free — $0/month:** 20,000 credits ≈ **27 minutes of audio per month**. Enough for a few dozen short notes.
- **Pro — $5/month:** 100,000 credits ≈ **133 minutes per month**, plus a commercial-use license and instant voice cloning.
- 1 credit = 1 character, roughly 750–800 characters per minute of speech.

Replaying a saved MP3 costs nothing and needs no key. Keep **overages disabled** in Cartesia if you want generation to stop when credits run out. Cartesia's own [pricing page](https://www.cartesia.ai/pricing) is the source of truth.

## 🚀 Installation

**From the community store** (once approved): Settings → Community plugins → Browse → AudioVault → Install → Enable.

**Manually, today:**

1. Download `main.js` and `manifest.json` from the [latest release](https://github.com/piotrlo/obsidian-audio-vault/releases/latest).
2. Put both files in `.obsidian/plugins/audio-vault` inside your vault.
3. Restart Obsidian, then enable AudioVault in **Settings → Community plugins**.

**Via BRAT:** add `piotrlo/obsidian-audio-vault` as a beta plugin.

Then open **Settings → AudioVault**, create an API key at [play.cartesia.ai/keys](https://play.cartesia.ai/keys), and paste it. Jacqueline is the default English voice; Marcin and Agnieszka are available for Polish. **Browse voices** searches the voices your own Cartesia account can use and filters by language (`pl`, `fr`) or accent (`en-GB`). To force a language, enter e.g. `pl-PL` in **Language (optional override)**.

**Upgrading from a manual install of 1.0.2 or earlier:** disable the old plugin first — its folder was `.obsidian/plugins/obsidian-audiovault`. Notes, MP3s and `Generated audio` links keep working. Re-enter your Cartesia key if prompted.

## 📱 The actual use case

Generate at home on Wi-Fi, drive, listen offline:

- Press **Download audio (no playback)** before leaving. The status label tells you the MP3 exists and matches the current note text.
- The MP3 sits next to the note (`Audio/` folder by default), so Obsidian Sync or any file sync carries it to the phone.
- Playback needs nothing but the file. No key required, no network required.
- On Android and iOS, Media Session exposes the note title and play/pause to the lock screen and car controls.

For generation on iOS the text is split into smaller parts; keep Obsidian open while it works, because background generation is not guaranteed.

## ⚡ Fast start and resume

- **Fast start:** playback begins after the first part; the next part is prepared in the background.
- **One MP3 only:** the note is linked to a file once generation completes. Until then, parts live in the plugin's `pending-audio` folder.
- **Resume:** run the same command again without changing the note text, voice, language, or chunk size. Fully downloaded parts are reused instead of paid for twice. AudioVault never retries on its own; a failed transfer can still consume credits, so check Cartesia usage before resuming.
- **Chunking:** sentences are split where possible, 500 characters per part by default (**Advanced options → Chunk size**).
- **Sanitizing:** images, HTML, code blocks and front matter are stripped before synthesis; only readable text is sent.

## 🔒 Privacy & network

- The readable text of the **active note** is sent to Cartesia when you generate audio. See Cartesia's [privacy policy](https://www.cartesia.ai/privacy) before converting sensitive notes.
- The API key is stored per vault, per device, in local storage — outside synced plugin settings, and not in a system keychain.
- Voice browsing sends only your search query and language filter to Cartesia, never note content.
- No telemetry, no proxy, no analytics. Saved MP3s are plain files in your vault.

## 🛠️ Technical details

- **Format:** MP3 only — small files that every player handles.
- **Pipeline:** buffered parts with one part prepared ahead; the vault file is written once the job finishes.
- **Interrupted jobs:** partial parts stay under `pending-audio` for a later resume.
- **Compatibility:** older generated MP3s stay playable from their `Generated audio` links, without a note version to compare against.

## 📄 License & support

MIT — see [LICENSE](LICENSE).

- **Issues:** [GitHub Issues](https://github.com/piotrlo/obsidian-audio-vault/issues)
- **Site:** [audio-vault.app](https://audio-vault.app)
