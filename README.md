# AudioVault 🎧

**Transform your Obsidian notes into high-quality audio. Listen to your knowledge vault on the go.**

[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-7C3AED)](https://obsidian.md)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## ✨ First audio in 1 click

1. **Open** any note in your vault
2. **Click** the play button in the ribbon
3. **Listen** to your content instantly

AudioVault converts your text to natural-sounding speech using Azure AI Speech technology, making your notes accessible anywhere - while driving, exercising, or multitasking.

## 🚀 Features

- **Instant TTS**: High-quality neural voices (OpenAI/Azure level)
- **Fast start**: Playback starts after the first part; background prefetch downloads the rest
- **Offline playback**: Parts are saved during playback and merged to a single MP3 as soon as all are fetched
- **Multi-language**: English, Polish and more with automatic detection
- **Mobile optimized**: Works seamlessly on iOS and Android
- **No cloud storage**: Your content stays in your vault

## 💰 Pricing

AudioVault offers flexible plans to fit your needs:

- **Free**: 10,000 characters/month (~2 articles, ~13 min) 
- **Basic**: 100,000 characters/month (~20 articles, ~2h 13 min) - $8.99/month
- **Pro**: 300,000 characters/month (~60 articles, ~6h 40 min) - $24.99/month

[**View full pricing →**](https://audio-vault.app/pricing)

## 🔧 Installation

1. Open Obsidian Settings → Community plugins -> [AudioVault](obsidian://show-plugin?id=audiovault)
2. Turn off Safe mode
3. Click "Browse" and search for "AudioVault"
4. Click "Install" then "Enable"

## 📱 Usage

### Quick Start
- **Play current note**: Click the play button in the ribbon
- **Download only**: Use "Download audio (no playback)" command
- **Voice settings**: Configure in Settings → AudioVault
 - **Auto-clean**: Content is sanitized before TTS (images/HTML/code removed), keeping only readable text.

### Controls
- **Ribbon**: Always visible play/pause button
- **Commands**: Play, Stop, Restart, Download
- **Settings**: Voice, speed, language, streaming options

## 🔒 Privacy & Network

**Network usage**: AudioVault connects to Azure AI Speech for text-to-speech conversion. Your note content is processed in real-time and never stored on external servers.

**Data handling**: Only the text you select is sent for TTS processing. No personal data, notes, or vault structure is transmitted or stored externally.

**Offline mode**: Generated audio files are stored locally in your vault's `Audio/` folder and can be played without internet connection.

## 🎯 Perfect for

- **Students**: Listen to study materials and research notes
- **Professionals**: Review documents and reports hands-free
- **Researchers**: Absorb large amounts of text while multitasking
- **Accessibility**: Support for users with reading difficulties
- **Productivity**: Maximize time during commutes and workouts

## 🛠️ Technical Details

- **Format**: MP3 only (high quality, small file size)
- **Playback pipeline**: Fast start + background prefetch + early merge-save; prefers buffered pipeline when Merge MP3 is enabled
- **Chunking**: Intelligent text splitting for long documents
- **Mobile**: iOS/Android optimized

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🤝 Support

- **FAQ**: [audio-vault.app/pricing](https://audio-vault.app/pricing)
- **Issues**: [GitHub Issues](https://github.com/piotrlo/audiovault-plugin/issues)
- **Community**: [Obsidian Forum](https://forum.obsidian.md)

---

## Mobile optimized (iOS)

- iOS mirrors desktop behavior for consistency: streaming path disabled, chunk size capped at 500.
- Fast start after the first part; background prefetch continues downloading remaining parts.
- As soon as all parts are fetched, the merged MP3 `<base>.mp3` is saved and note links are replaced.
- Per-part files are deleted after playback finishes (deferred cleanup).
