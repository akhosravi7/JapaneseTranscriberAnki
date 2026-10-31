import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  AnkiSettings,
  AppSettings,
  AudioSettings,
  SettingsPatch,
  TranscriptionSettings,
  TranslationSettings
} from '@shared/types'
import { SecretsStore } from './secrets'

interface StoredSettings {
  transcription: Omit<TranscriptionSettings, 'apiKeySet'>
  translation: Omit<TranslationSettings, 'apiKeySet'>
  anki: AnkiSettings
  audio: AudioSettings
}

export const DEFAULT_ANKI_SETTINGS: AnkiSettings = {
  endpoint: 'http://127.0.0.1:8765',
  deck: 'Netflix Japanese',
  noteType: 'Netflix Japanese',
  fields: {
    sentence: 'Sentence',
    audio: 'Audio',
    reading: 'Reading',
    translation: 'Translation',
    notes: ''
  }
}

export const DEFAULT_STORED_SETTINGS: StoredSettings = {
  transcription: {
    endpoint: 'https://alibazz.tailf4ff3b.ts.net/v1/audio/transcriptions',
    model: 'kotoba-tech/kotoba-whisper-v2.0-faster',
    language: 'ja'
  },
  translation: {
    endpoint: 'https://alibazz.tailf4ff3b.ts.net/v1',
    model: 'qwen2.5-7b-instruct',
    temperature: 0.2,
    customInstructions: ''
  },
  anki: DEFAULT_ANKI_SETTINGS,
  audio: {
    paddingMs: 150
  }
}

function cloneDefaults(): StoredSettings {
  return JSON.parse(JSON.stringify(DEFAULT_STORED_SETTINGS)) as StoredSettings
}

function mergeStored(partial: unknown): StoredSettings {
  const defaults = cloneDefaults()
  if (!partial || typeof partial !== 'object') return defaults
  const input = partial as Partial<StoredSettings>
  return {
    transcription: { ...defaults.transcription, ...(input.transcription ?? {}) },
    translation: { ...defaults.translation, ...(input.translation ?? {}) },
    anki: {
      ...defaults.anki,
      ...(input.anki ?? {}),
      fields: { ...defaults.anki.fields, ...(input.anki?.fields ?? {}) }
    },
    audio: { ...defaults.audio, ...(input.audio ?? {}) }
  }
}

export class SettingsStore {
  private readonly filePath: string
  private readonly secrets: SecretsStore
  private stored: StoredSettings

  constructor(directory: string, secrets: SecretsStore) {
    this.filePath = join(directory, 'settings.json')
    this.secrets = secrets
    this.stored = this.read()
  }

  private read(): StoredSettings {
    if (!existsSync(this.filePath)) return cloneDefaults()
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown
      return mergeStored(raw)
    } catch {
      return cloneDefaults()
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temp = `${this.filePath}.tmp`
    writeFileSync(temp, JSON.stringify(this.stored, null, 2), 'utf8')
    renameSync(temp, this.filePath)
  }

  get(): AppSettings {
    return {
      transcription: {
        ...this.stored.transcription,
        apiKeySet: this.secrets.has('transcription')
      },
      translation: {
        ...this.stored.translation,
        apiKeySet: this.secrets.has('translation')
      },
      anki: JSON.parse(JSON.stringify(this.stored.anki)) as AnkiSettings,
      audio: { ...this.stored.audio }
    }
  }

  getApiKey(name: 'transcription' | 'translation'): string | undefined {
    return this.secrets.get(name)
  }

  save(patch: SettingsPatch): AppSettings {
    if (patch.transcription) {
      const { endpoint, model, language, apiKey } = patch.transcription
      if (endpoint !== undefined) this.stored.transcription.endpoint = endpoint.trim()
      if (model !== undefined) this.stored.transcription.model = model.trim()
      if (language !== undefined) this.stored.transcription.language = language.trim() || 'ja'
      this.secrets.set('transcription', apiKey)
    }

    if (patch.translation) {
      const { endpoint, model, apiKey, temperature, customInstructions } = patch.translation
      if (endpoint !== undefined) this.stored.translation.endpoint = endpoint.trim()
      if (model !== undefined) this.stored.translation.model = model.trim()
      if (temperature !== undefined) {
        this.stored.translation.temperature = Number.isFinite(temperature)
          ? Math.min(2, Math.max(0, temperature))
          : 0.2
      }
      if (customInstructions !== undefined) {
        this.stored.translation.customInstructions = customInstructions.slice(0, 4000)
      }
      this.secrets.set('translation', apiKey)
    }

    if (patch.anki) {
      this.stored.anki = {
        ...this.stored.anki,
        ...patch.anki,
        fields: { ...this.stored.anki.fields, ...(patch.anki.fields ?? {}) }
      }
      this.stored.anki.endpoint = this.stored.anki.endpoint.trim()
      this.stored.anki.deck = this.stored.anki.deck.trim()
      this.stored.anki.noteType = this.stored.anki.noteType.trim()
    }

    if (patch.audio) {
      this.stored.audio = { ...this.stored.audio, ...patch.audio }
      const padding = Math.round(this.stored.audio.paddingMs)
      this.stored.audio.paddingMs = Number.isFinite(padding) ? Math.min(3000, Math.max(0, padding)) : 150
    }

    this.persist()
    return this.get()
  }
}
