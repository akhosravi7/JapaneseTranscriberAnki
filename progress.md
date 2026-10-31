# Kotoba Cards — Progress

_Last updated: 2026-10-31_

## Session summary

This session built the first working version of **Kotoba Cards**, a macOS desktop app that turns Japanese audio into Anki flashcards. The app is implemented with Electron, React, and TypeScript, with a modular service layer for transcription, Japanese text processing, translation, audio clipping, and AnkiConnect. The main workflow is complete and has been exercised end-to-end: import audio → transcribe → review and edit sentences → proofread Japanese → generate hiragana and English → preview → add to Anki with audio.

## What has been done

### App foundation

- Electron + React + TypeScript project with Vite and `electron-vite`.
- Secure renderer architecture: context isolation, no Node.js access in the UI, typed preload bridge, validated IPC handlers.
- Modular main-process services:
  - Transcription API client
  - Sentence splitting
  - Local hiragana generation
  - Translation client
  - Japanese proofreading client
  - Audio clipping
  - AnkiConnect integration and duplicate checking
- Local settings storage and encrypted API-key storage using Electron `safeStorage`.
- Session storage that preserves the original imported audio file.
- Custom `media://` protocol for playback inside the app.
- Production build and unpacked macOS packaging via `electron-builder`.

### Audio workflow

- Import M4A, MP3, WAV, AAC, FLAC, OGG, Opus, and WebM files.
- Drag-and-drop and file-picker import.
- Original audio copied into app storage and left untouched.
- Per-sentence audio playback during review.
- Automatic sentence splitting from Whisper segments using punctuation and pause timing.

### Transcription

- Integrated with the existing Tailscale OpenAI-compatible endpoint:
  - `https://alibazz.tailf4ff3b.ts.net/v1/audio/transcriptions`
  - Model: `kotoba-tech/kotoba-whisper-v2.0-faster`
- Required parameters are sent: `model`, `language=ja`, `response_format=verbose_json`.
- Verbose JSON parsing, empty-transcription handling, timeouts, retries with backoff, clear error messages, and retry buttons.
- Original transcript is preserved separately from user edits and can be restored explicitly.
- Added an LLM **Proofread** step to suggest Japanese transcription corrections such as `分殴って` → `ぶん殴って`. Suggestions are reviewed and only applied when the user approves; the original is never silently changed.

### Japanese text processing

- Hiragana generation runs locally with Kuroshiro + Kuromoji.
- Readings are editable.
- Stale-reading detection after Japanese edits.
- Proofread changes mark reading/translation as out of date until regenerated.

### Translation

- OpenAI-compatible chat-completions integration.
- Default endpoint and model:
  - `https://alibazz.tailf4ff3b.ts.net/v1`
  - `qwen2.5-7b-instruct`
- Improved translation prompt for natural, idiomatic English rather than literal output.
- Previous/next sentence context is sent to resolve ambiguous subjects and tone.
- Configurable temperature (`0.2` by default).
- Configurable custom translation instructions.
- Editable English output, stale-translation warnings, and per-sentence or bulk generation.
- Live-verified against the Qwen endpoint.

### Anki integration

- AnkiConnect client with connection testing and catalog loading.
- Default target:
  - Deck: `Netflix Japanese`
  - Note type: `Netflix Japanese`
  - Fields: `Sentence`, `Audio`, `Reading`, `Translation`
- Field mapping is configurable for other note types; optional notes field supported.
- Per-sentence MP3 clip extraction with bundled `ffmpeg-static` and configurable padding.
- Audio embedded through AnkiConnect `storeMediaFile` and `[sound:...]`.
- Duplicate detection by normalized Japanese sentence and audio SHA-256 tag.
- Duplicate warning modal with an explicit **Add anyway** action.
- Cards receive `japanese-audio` and `ja-audio-<hash>` tags.
- Adding is blocked after a Japanese correction until reading/translation are regenerated.
- Full add flow validated against a mock AnkiConnect server, including generated note fields and media.

### UI and reliability

- Polished light interface with import screen, sentence sidebar, editor, card preview, settings modal, duplicate modal, and toasts.
- Per-sentence status indicators: transcribed, generating, ready, added, error.
- Clear error cards, retry controls, and Anki online/offline status.
- Settings for transcription, translation, Anki, field mapping, audio padding, temperature, and custom instructions.
- Bulk generation and review of multiple sentences.
- Original transcript viewer and restore action.

### Verification completed

- TypeScript typecheck passes for main/preload and renderer.
- 22 Vitest tests pass, covering sentence splitting, text normalization, endpoint URL handling, audio clipping, hiragana generation, translation context/temperature/custom instructions, proofreading, and duplicate matching.
- Production build succeeds.
- macOS unpacked app packaging succeeds.
- Live Whisper transcription works.
- Live hiragana generation works.
- Live Qwen translation and proofreading work.
- Packaged app was verified for hiragana generation and ffmpeg audio clipping.
- UI workflow was automated through Chromium DevTools: import, transcription, proofreading, applying a correction, generation, and Anki add using mocks.

## Current defaults

- Transcription endpoint: `https://alibazz.tailf4ff3b.ts.net/v1/audio/transcriptions`
- Transcription model: `kotoba-tech/kotoba-whisper-v2.0-faster`
- Translation endpoint: `https://alibazz.tailf4ff3b.ts.net/v1`
- Translation model: `qwen2.5-7b-instruct`
- AnkiConnect endpoint: `http://127.0.0.1:8765`
- Deck: `Netflix Japanese`
- Note type: `Netflix Japanese`
- Audio padding: `150 ms`
- Translation temperature: `0.2`

## How to run

```bash
npm install
npm run dev       # development
npm start         # production preview
npm test
npm run typecheck
npm run build
npm run package   # unpacked macOS app
```

AnkiConnect add-on code: `2055492159`.

## What is left to do

### Immediate follow-ups

- **Restart the running app** after this session so the new translation defaults and proofreading feature are loaded.
- **Test a real card against the actual Anki collection.** Mock flow and field payloads were verified; the final real Anki add should be checked with the actual `Netflix Japanese` deck and note type.
- **Test with real recordings**, especially longer files with multiple speakers, pauses, overlapping speech, and background noise.
- **Evaluate translation quality on real subtitles.** The 7B model is usable but still limited; compare with a larger model if translations remain rough.
- **Commit the work.** No git commit has been made yet.

### Planned improvements

- Add manual sentence boundary editing: split, merge, and adjust start/end times.
- Persist and restore the current review session after restarting the app.
- Add a recent-session/history library instead of only one active recording.
- Add translation alternatives or a second refinement pass for harder lines.
- Allow editing/regenerating notes and vocabulary explanations when the target note type supports them.
- Add an explicit transcription prompt/context setting if Whisper prompting helps with specific content.
- Improve proofreading with stronger confidence checks and a clearer change history.
- Add proper end-to-end UI tests with Playwright/Electron.
- Add undo/redo for transcript and translation edits.
- Add app icon, code signing, notarization, and a proper DMG release.
- Add accessibility review, keyboard shortcuts, and UI scaling checks.
- Add support for batch review/import of multiple audio files.
- Add export/import of sessions and generated cards before Anki submission.

### Known limitations

- Only one recording is active in the UI at a time.
- AnkiConnect must be installed and Anki must be running.
- Translation and proofreading require the configured LLM endpoint.
- Proofreading is an LLM suggestion and can occasionally propose a wrong correction; review before applying.
- Duplicate detection is limited to the selected deck and normalized sentence/audio hash matching.
- The Qwen 2.5 7B model has no reasoning/thinking mode; quality depends heavily on the prompt and model size.
- The app is unsigned and not yet notarized.
