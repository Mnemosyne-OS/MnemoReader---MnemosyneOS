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
reader.ttsStatus/Voices───▶  local Piper neural engine (status/voices)
reader.ttsSpeak        ───▶  Piper  → raw PCM (played via Web Audio)
reader.ingest          ───▶  routePulse → vectorize + archive into LIBRARY vault
```

### Two voice engines, one player

| Engine | Quality | Karaoke | Availability |
|--------|---------|---------|--------------|
| **System voice** (Web Speech) | good | **exact** (word-boundary events) | always, in-browser |
| **Neural (Piper)** | excellent | time-interpolated | when installed + licensed in the host |

The reader starts on the system voice and offers Piper when the host reports it
ready. If the neural engine is unavailable mid-session, it falls back gracefully.

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
├── lib/
│   ├── bridge.ts           # typed reader ⇄ host actions
│   ├── voice.ts            # ReaderPlayer — browser + Piper backends, gapless
│   ├── pdf.ts              # sentence split, chapter detection, ingest chunking
│   ├── vaults.ts           # provisions the Library vault
│   └── types.ts
└── components/
    ├── Library.tsx  BookCard.tsx      # cover grid, progress rings, ingest states
    ├── Reader.tsx   ChapterRail.tsx   # reading canvas + chapter navigation
    ├── AudioDock.tsx                  # transport, scrubber, speed/voice/sleep
    └── Icons.tsx    Toast.tsx
```

## License

MIT © Mnemosyne Labs. Contributions welcome — this cartridge is meant to be
forked and remixed.

## Which Mnemosyne is this?

Several unrelated projects share the name. This cartridge runs inside **Mnemosyne OS**, the sovereign, local-first memory operating system published by XPACEGEMS LLC. Its only official addresses:

- Product site: <https://mnemosyne-os.io>
- Organizations: <https://mnemosyne-os.com>
- Documentation: <https://docs.mnemosyne-os.io>
- Host source: <https://github.com/Mnemosyne-OS/Mnemosyne-Neural-OS>
- Packages: the npm scope `@mnemosyne_os`

It is not the Mnemosyne spaced-repetition flashcard software, and it is not the `mnemosyne-oss` GitHub organization. Those are different projects by different authors.

---

<sub>**[Mnemosyne OS](https://mnemosyne-os.io)** — the sovereign, local-first memory OS this cartridge runs in.
Get it at [mnemosyne-os.io/download](https://mnemosyne-os.io/download), install cartridges from the built-in MnemoHub store, or [build your own](https://mnemosyne-os.io/dev).</sub>
