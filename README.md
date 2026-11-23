# AudioVault 🎧

**Transform your Obsidian notes into high-quality audio. Listen to your knowledge vault on the go.**

[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-7C3AED)](https://obsidian.md)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## ✨ First audio in 1 click

1. **Open** any note in your vault
2. **Click** the play button in the ribbon
3. **Listen** when the first part is ready

AudioVault generates speech with Cartesia Sonic 3.6 and saves audio in your vault for later playback.

## 🚀 Features

- **Text to speech**: Cartesia Sonic 3.6 with an English default voice and optional Polish voices
- **Fast start**: Playback starts after the first part; the next part is prepared in the background
- **Offline playback**: A single MP3 is saved when the generation completes; older recordings stay available as files
- **Multi-language**: English, Polish and more with automatic detection
- **Mobile playback**: Sync the generated MP3 alongside its note before going offline
- **Local audio files**: Generated audio is saved in your vault

## Cartesia setup and costs

1. Create your own API key in [Cartesia](https://play.cartesia.ai/). Keep **overages disabled** in your Cartesia subscription if you want generation to stop when credits run out.
2. Open **Settings → AudioVault** and paste the key. Jacqueline is the default voice; Marcin and Agnieszka are available for Polish.
3. Open a note and click the headphones icon. Use **Download audio (no playback)** to prepare audio in advance.

Cartesia charges your account according to its [pricing](https://www.cartesia.ai/pricing). AudioVault does not include shared credits or retry failed synthesis automatically. The key is stored per vault on this device outside synced plugin settings; it is not stored in a system keychain. Azure and the old AudioVault proxy are not used by this build. To force Polish, enter `pl-PL` in **Language (optional override)**.

Use **Browse voices** to search the voices available to your Cartesia account by name, description, or ID. Filter by language (`pl`, `fr`) or accent (`en-GB`) and use **Load more** to browse additional results. **Recommended** prioritizes native accent matches and AudioVault's built-in picks among loaded results, not Cartesia popularity. You can also sort by name or keep Cartesia's order. Selecting a catalog voice uses its language or accent for new synthesis unless you set a language override.

Voice browsing sends the search and language filter directly to Cartesia, not the note. Browsing does not synthesize audio, and saved MP3 playback does not need the catalog.

## 🔧 Installation

1. Download `main.js` and `manifest.json` from the [releases page](https://github.com/piotrlo/obsidian-audio-vault/releases).
2. Copy both files into `.obsidian/plugins/audio-vault` in your vault.
3. Restart Obsidian. In **Settings → Community plugins**, enable AudioVault.

**Upgrading from a manual install of 1.0.2 or earlier:** Disable the old AudioVault plugin before enabling the new one. Its folder was `.obsidian/plugins/obsidian-audiovault`. Your notes and MP3s stay in the vault and existing audio links still work. Review your settings, reassign any custom hotkeys, and re-enter your Cartesia key locally if prompted.

## 📱 Usage

### Quick Start
- **Play current note**: Click the play button in the ribbon
- **Download only**: Use "Download audio (no playback)" command
- **Voice settings**: Configure in Settings → AudioVault
 - **Auto-clean**: Content is sanitized before TTS (images/HTML/code removed), keeping only readable text.

### Controls
- **Ribbon**: Always visible play/pause button
- **Commands**: Play, Stop, Restart, Download
- **Settings**: Voice, playback speed, language and audio folder

## 🔒 Privacy & Network

**Network usage**: When you generate audio, AudioVault sends the readable text of the active note to Cartesia. See Cartesia's [privacy policy](https://www.cartesia.ai/privacy) before generating audio from sensitive notes.

**Offline mode**: Generated audio files are stored locally in your vault's `Audio/` folder and can be played without internet connection.

## 🎯 Perfect for

- **Students**: Listen to study materials and research notes
- **Professionals**: Review documents and reports hands-free
- **Researchers**: Absorb large amounts of text while multitasking
- **Accessibility**: Support for users with reading difficulties
- **Productivity**: Maximize time during commutes and workouts

## 🛠️ Technical Details

- **Format**: MP3 only (high quality, small file size)
- **Playback pipeline**: Buffered parts with one part prepared ahead. Only a completed MP3 is linked to the note.
- **Interrupted generation**: Run the same command again without changing the note text, voice, language, or chunk size. AudioVault reuses fully downloaded parts saved under the plugin's `pending-audio` folder. AudioVault never retries automatically. A failed transfer can still consume credits; check Cartesia usage before resuming. If regenerating a note that already has a recording, use **Regenerate and play current note** again; ordinary Play still plays the existing recording.
- **Chunking**: Splits long notes at sentence boundaries where possible. The default is 500 characters per part. Existing saved values are kept; change yours under **Advanced options → Chunk size (characters)**.
- **Compatibility**: Previously generated MP3s remain playable from the note's `Generated audio` links.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🤝 Support

- **Issues**: [GitHub Issues](https://github.com/piotrlo/obsidian-audio-vault/issues)
- **Community**: [Obsidian Forum](https://forum.obsidian.md)

---

## Offline use on mobile

Sync the note and its MP3 before going offline. No Cartesia key is required to play an existing recording. For generation on iOS, the text is split into smaller parts. Keep Obsidian open while generating; background generation is not guaranteed.
