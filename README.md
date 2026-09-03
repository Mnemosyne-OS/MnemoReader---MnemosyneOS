<div align="center">

<img src="https://raw.githubusercontent.com/Mnemosyne-OS/Mnemosyne-Neural-OS/main/assets/banner-mnemosyne-os.png" width="100%" alt="Mnemosyne OS — Your memory. Your machine. Your rules." />

🌐 [**mnemosyne-os.io**](https://mnemosyne-os.io) — the product&ensp;·&ensp;[**mnemosyne-os.com**](https://mnemosyne-os.com) — for organizations&ensp;·&ensp;📖 [**docs.mnemosyne-os.io**](https://docs.mnemosyne-os.io) — the documentation

</div>

# MnemoReader

**A living book library with voice reading — EPUB, PDF, DOCX and more. A cartridge for [Mnemosyne OS](https://github.com/Mnemosyne-OS/Mnemosyne-Neural-OS).**

> [!IMPORTANT]
> **MnemoReader is a cartridge — it runs inside Mnemosyne OS.** Install the host app first, then load this cartridge from MnemoHub (or link it in dev mode).
>
> [![Download latest release](https://img.shields.io/badge/⬇%20Download-Mnemosyne%20OS%20latest-0ea5e9?style=for-the-badge)](https://github.com/Mnemosyne-OS/Mnemosyne-Neural-OS/releases/latest) &nbsp; [![Mnemosyne OS repository](https://img.shields.io/badge/GitHub-Mnemosyne%20OS-181717?style=for-the-badge&logo=github)](https://github.com/Mnemosyne-OS/Mnemosyne-Neural-OS)

Drop a book — **EPUB, PDF, DOCX, RTF, TXT, HTML, Markdown…** — or a whole folder, and MnemoReader:

- 📖 **Extracts the text** host-side (pdf-parse / mammoth — PDF, DOCX, TXT, MD…)
- 🧠 **Vectorizes + archives** it into a dedicated **Library vault** (SHA-256 dedup, auto-spines)
- 🔖 **Auto-detects chapters** from headings, numbering, and structure
- 🔊 **Reads it aloud** with **word-synced karaoke highlighting**, resume position, chapter jumping, variable speed, and a sleep timer
- 🌍 **Speaks seven languages** (de, en, es, fr, pt, ru, zh), following the host, and it tells you when no installed voice speaks the book's own language rather than reading it in the wrong one

<p align="center"><em>Dark reading-lamp UI · liquid-glass surfaces · fluid motion.</em></p>

![The reader — chapter rail, reading canvas, and the audio dock with karaoke-synced playback](./docs/images/reader.png)

---

## How it works

MnemoReader is a sandboxed **cartridge**: it runs in an iframe and talks to the
host only through a whitelisted postMessage bridge (`src/lib/bridge.ts`). It
declares exactly the permissions it needs (`vault:read`, `vault:write`,
`model:infer`, `dialog:open`, `shell:open`) and nothing more.

```
MnemoReader (iframe)                 Mnemosyne OS host
────────────────────                 ─────────────────
dialog.selectFile      ───▶  OS file picker
reader.extractDocument ───▶  pdf-parse / mammoth  → plain text
reader.ttsStatus/Voices───▶  the host's local voice engines (status/voices)
reader.ttsSpeak        ───▶  the chosen engine → raw PCM (played via Web Audio)
reader.ingest          ───▶  routePulse → vectorize + archive into LIBRARY vault
```

### One player, whichever engine the host offers

| Engine | Quality | Karaoke | Availability |
|--------|---------|---------|--------------|
| **System voice** (Web Speech) | good | **exact** (word-boundary events) | always, in-browser |
| **A local neural engine** | excellent | time-interpolated | when installed + licensed in the host |

MnemoReader names no engine of its own. It asks the host which local voices are
installed and plays the one you chose in Mnemosyne OS settings, so an engine
added to the OS works here without a line of code changing. The reader starts on
the system voice, follows your host setting every time it opens, and when a
neural engine stops answering mid-session it names the engine it fell back from
instead of just saying a voice is unavailable.

## Try it standalone

You don't need the full OS to explore the reader UI:

```bash
pnpm install
pnpm dev          # http://localhost:5210
```

Then click **“Try it with a sample story”** — the reader, karaoke highlighting,
chapters, and system-voice playback all work in a plain browser tab. (PDF import
and vault archiving require running inside Mnemosyne OS, which provides the file
picker, extractor, and vault engine.)

![The library — drop a book, import a folder, or paste a link](./docs/images/library.png)

## Build

```bash
pnpm build        # tsc + vite → dist/  (served via mnemo-plugin:// when installed)
```

## Project layout

```
src/
├── App.tsx                 # library ⇆ reader, ingest pipeline, toasts, resume
├── styles.css              # design system (glassmorphism, amber accent, motion)
├── sdk/mnemo-sdk.ts        # postMessage bridge to the host
├── i18n/
│   ├── useI18n.ts          # follows the host's language
│   └── locales/            # de, en, es, fr, pt, ru, zh
├── hooks/
│   ├── useReaderVoice.ts   # engine selection, playback state, fallbacks
│   ├── useSandboxCatalogue.ts
│   └── useSleepTimer.ts
├── lib/
│   ├── bridge.ts           # typed reader ⇄ host actions
│   ├── voice.ts            # the single import site for the three files below
│   ├── voice/player.ts     # ReaderPlayer: backends and the gapless scheduler
│   ├── voice/leadPolicy.ts # how much audio to hold when an engine is slower than speech
│   ├── voice/browserVoices.ts
│   ├── pdf.ts              # sentence split, chapter detection, ingest chunking
│   ├── lang.ts             # does any installed voice speak this book?
│   ├── textStore.ts        # extracted text cached in IndexedDB
│   ├── vaults.ts           # provisions the Library vault
│   └── types.ts
└── components/
    ├── Library.tsx  BookCard.tsx      # cover grid, progress rings, ingest states
    ├── Reader.tsx   ChapterRail.tsx   # reading canvas + chapter navigation
    ├── AudioDock.tsx                  # transport, scrubber, speed/voice/sleep
    ├── ImportOverlay.tsx  ConfirmDelete.tsx
    └── Icons.tsx    Toast.tsx
```

Tests run with `pnpm test` (68 of them, on the sentence splitter, the language
match, the lead policy and the seven locale files).

## License

MIT © Mnemosyne Labs. Contributions welcome — this cartridge is meant to be
forked and remixed.

## Where Mnemosyne OS lives

This cartridge runs inside **Mnemosyne OS**, the sovereign, local-first memory operating system published by XPACEGEMS LLC. Its official addresses:

- Product site: <https://mnemosyne-os.io>
- Organizations: <https://mnemosyne-os.com>
- Documentation: <https://docs.mnemosyne-os.io>
- Host source: <https://github.com/Mnemosyne-OS/Mnemosyne-Neural-OS>
- Packages: the npm scope `@mnemosyne_os`

---

<sub>**[Mnemosyne OS](https://mnemosyne-os.io)** — the sovereign, local-first memory OS this cartridge runs in.
Get it at [mnemosyne-os.io/download](https://mnemosyne-os.io/download), install cartridges from the built-in MnemoHub store, or [build your own](https://mnemosyne-os.io/dev).</sub>
