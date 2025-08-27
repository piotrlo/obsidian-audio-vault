# AudioVault 🎧

**Transform your Obsidian notes into high-quality audio. Listen to your knowledge vault on the go.**

[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-7C3AED)](https://obsidian.md)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## ✨ First audio in 3 clicks

1. **Select** any note in your vault
2. **Click** the play button in the ribbon
3. **Listen** to your content instantly

AudioVault converts your text to natural-sounding speech using Azure AI Speech technology, making your notes accessible anywhere - while driving, exercising, or multitasking.

## 🚀 Features

- **Instant TTS**: High-quality neural voices (OpenAI/Azure level)
- **Smart streaming**: Audio starts playing in seconds, not minutes
- **Offline playback**: Generated audio files saved to your vault
- **Multi-language**: Polish, English, and more with automatic detection
- **Mobile optimized**: Works seamlessly on iOS and Android
- **No cloud storage**: Your content stays in your vault

## 💰 Pricing

AudioVault offers flexible plans to fit your needs:

- **Free**: 10,000 characters/month (~2 articles)
- **Basic**: 100,000 characters/month (~20 articles) - $8.99/month
- **Pro**: 300,000 characters/month (~60 articles) - $24.99/month

[**View full pricing →**](https://audio-vault.app/pricing)

## 🔧 Installation

1. Open Obsidian Settings → Community plugins
2. Turn off Safe mode
3. Click "Browse" and search for "AudioVault"
4. Click "Install" then "Enable"

## 📱 Usage

### Quick Start
- **Play current note**: Click the play button in the ribbon
- **Download only**: Use "Download audio (no playback)" command
- **Voice settings**: Configure in Settings → AudioVault

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
- **Streaming**: MediaSource Extensions (MSE) with fallback
- **Chunking**: Intelligent text splitting for long documents
- **Caching**: Voice lists cached for 24 hours
- **Mobile**: iOS/Android optimized with gesture support

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🤝 Support

- **Documentation**: [audio-vault.app/docs](https://audio-vault.app/docs)
- **Issues**: [GitHub Issues](https://github.com/piotrlo/audiovault-plugin/issues)
- **Community**: [Obsidian Forum](https://forum.obsidian.md)

---

**Made with ❤️ for the Obsidian community**
