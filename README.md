# Kotoba Cards

A local-first macOS desktop app that turns Japanese audio recordings into Anki flashcards. Import an audio file, review the transcription sentence by sentence, generate hiragana and a natural English translation, then send each card to Anki with its original audio attached.

## Milestone 1 features

- Import M4A, MP3, WAV, AAC, FLAC, OGG, Opus, or WebM. The original file is copied into the app's session storage and never modified.
- Transcribe through the existing OpenAI-compatible Whisper endpoint (`kotoba-tech/kotoba-whisper-v2.0-faster`).
- Split the transcript into reviewable sentences using punctuation and pause timing.
- Edit every sentence. The original transcription is kept separately and can be restored explicitly.
- Generate hiragana locally with Kuroshiro + Kuromoji.
- Generate an editable natural English translation with any OpenAI-compatible chat endpoint.
- Use neighboring sentences as context for translation, with configurable temperature and custom translation instructions.
- Proofread the Japanese transcription with an LLM. Corrections are shown as suggestions and only applied when you approve them; the original transcription is never overwritten.
- Preview the Anki front and back while editing.
- Add cards through AnkiConnect with a per-sentence MP3 clip and duplicate detection.
- Settings are stored locally. API keys are encrypted with Electron `safeStorage`.

## Requirements

- macOS (developed and tested on macOS 26.6)
- Node.js 22+ and npm 11+
- Anki Desktop with the [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on
- A translation API: any OpenAI-compatible `/v1/chat/completions` endpoint

The Whisper server exposes only Whisper and VAD models, so translation cannot use that server. Configure a separate translation endpoint in Settings.

## Setup

```bash
npm install
npm run dev
```

### AnkiConnect

1. Open Anki.
2. Go to **Tools → Add-ons → Get Add-ons…**
3. Enter code `2055492159`, confirm, and restart Anki.
4. Leave Anki running while using Kotoba Cards.

The default AnkiConnect endpoint is `http://127.0.0.1:8765`. The app defaults to the existing **Netflix Japanese** deck and note type with this mapping:

| App content | Netflix Japanese field |
| --- | --- |
| Japanese sentence | `Sentence` |
| Embedded audio | `Audio` |
| Hiragana | `Reading` |
| English translation | `Translation` |

Any deck and note type can be selected in Settings. Use **Load fields from Anki** to auto-map fields. If the target note type has a notes/explanation field, map it to enable vocabulary and grammar notes.

### Translation

The default translation endpoint is the same Tailscale host:

```
https://alibazz.tailf4ff3b.ts.net/v1
```

The default model is `qwen2.5-7b-instruct`. Both can be changed in **Settings → Translation**. The endpoint is OpenAI-compatible, so OpenAI, Ollama, vLLM, LM Studio, or another compatible server also works. Add an API key when required and use **Test saved translation** to verify.

Translation sends the previous and next sentence as context, uses a low default temperature (`0.2`), and supports **Custom translation instructions** in Settings. For example: “Use natural conversational American English” or “Keep Japanese honorifics in romaji.” A larger instruct model will generally produce better translations than a 7B model.

Speaches proxies `/v1/chat/completions` to the upstream model configured through its `CHAT_COMPLETION_BASE_URL`. If that endpoint returns a generic HTTP 500, check that the upstream LLM service is reachable from the Speaches process/container and that the model ID matches exactly.

### Transcription

The default endpoint is already set to:

```
https://alibazz.tailf4ff3b.ts.net/v1/audio/transcriptions
```

It can be changed in **Settings → Transcription**. Bearer-token authentication is optional.

## Workflow

1. Drop an audio file onto the import screen.
2. The app transcribes it and splits it into sentences.
3. Select a sentence and click **Proofread** to ask the LLM for kanji/ASR corrections. Review the diff and click **Apply correction**, or ignore it. The original transcript is unchanged either way.
4. Edit the Japanese manually if needed, then click **Generate**.
5. Hiragana and English are generated independently; either can be edited by hand. Translation uses the surrounding sentences as context.
6. Check the card preview, then click **Add to Anki**. Corrected sentences must have their reading and translation regenerated before adding.
7. If a matching sentence or identical audio clip already exists in the deck, the app shows the duplicates and requires confirmation before adding.

The original transcription is immutable: edits live in a separate field and the original can always be restored.

## Project structure

```
src/
├── main/                  Electron main process
│   ├── services/
│   │   ├── transcription.ts   Whisper multipart client
│   │   ├── translation.ts     OpenAI-compatible chat client
│   │   ├── reading.ts         Kuroshiro hiragana conversion
│   │   ├── audio.ts           ffmpeg clip extraction + SHA-256
│   │   └── anki.ts            AnkiConnect client + duplicates
│   ├── ipc.ts             Validated IPC handlers
│   ├── settings-store.ts  Local JSON settings
│   ├── secrets.ts         Encrypted API keys
│   └── session-store.ts   Imported audio session storage
├── preload/               Context-isolated typed bridge
├── renderer/              React UI
└── shared/                Types, errors, sentence splitting, text utils
tests/                     Vitest unit and integration tests
```

Transcription, text processing, translation, audio clipping, and Anki integration are separate services. The renderer has no Node.js access; all privileged operations go through validated IPC calls.

## Local data

App data is stored in:

```
~/Library/Application Support/Kotoba Cards/
├── settings.json          Non-secret settings
├── secrets.json           Encrypted API keys
└── sessions/<id>/         Original audio + generated clips
```

The app keeps one active recording in the UI at a time. Imported audio sessions remain on disk until manually removed.

## Scripts

```bash
npm run dev          # Run with hot reload
npm run build        # Build main, preload, and renderer
npm start            # Preview the production build
npm run typecheck    # TypeScript checks for node and web
npm test             # Run Vitest
npm run package      # Build an unpacked app with electron-builder
npm run dist         # Build a distributable
```

## Duplicate detection

Before adding, the app searches the target deck for:

- A note whose sentence field matches after NFKC/punctuation/whitespace normalization
- A note tagged with the first 24 characters of the audio clip SHA-256 (`ja-audio-<hash>`)

New cards receive the `japanese-audio` tag plus the audio-hash tag. Duplicate warnings are non-blocking; the user can explicitly choose **Add anyway**.

## Known limitations

- The UI currently manages one recording at a time.
- AnkiConnect must be installed and Anki must be running.
- Translation requires a separately configured LLM endpoint.
- Sentence timing comes from Whisper segments and proportional punctuation splitting; there is no manual boundary editor in milestone 1.
- Whisper kanji conversion errors are possible. **Proofread** is an LLM suggestion feature, not a guaranteed correction; always review the diff before applying it.
- A 7B instruct model can still produce awkward translations. Try a larger model, lower the temperature, or add custom translation instructions for better results.

## Troubleshooting

- **`npm install` fails with `Cannot read properties of null (reading 'edgesOut')`**: the system npm 10 arborist has a peer-resolution bug. Use `npx npm@11 install`.
- **Electron shows `Electron failed to install correctly`**: install scripts were blocked by npm. Run `node node_modules/electron/install.js` once.
- **Anki cards are not added**: confirm Anki is open, AnkiConnect is installed, and **Settings → AnkiConnect → Test connection** succeeds.
- **Translation returns HTTP 401**: the translation endpoint needs an API key, or the endpoint/model is incorrect. Use **Test saved translation** after saving.
- **No audio in a card**: check that the card's note type has an `Audio` field mapped in Settings. The app stores audio as `[sound:<hash>.mp3]`.
