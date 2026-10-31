export const AUDIO_EXTENSIONS = ['m4a', 'mp3', 'wav', 'aac', 'flac', 'ogg', 'opus', 'webm'] as const

export type AudioExtension = (typeof AUDIO_EXTENSIONS)[number]

export interface ImportedAudio {
  sessionId: string
  fileName: string
  mediaUrl: string
  sizeBytes: number
  extension: AudioExtension
  importedAt: string
}

export type RecordingSource = 'microphone' | 'system'

export interface SaveRecordingRequest {
  data: Uint8Array
  mimeType: string
  source: RecordingSource
}

export interface ScreenAudioStatus {
  permission: 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'
  available: boolean
  error?: string
}

export interface TranscriptionSegment {
  startSec: number
  endSec: number
  text: string
}

export interface TranscriptionResult {
  text: string
  segments: TranscriptionSegment[]
  language?: string
  durationSec?: number
}

export interface SentenceUnit {
  startSec: number
  endSec: number
  text: string
}

export type SegmentStatus = 'transcribed' | 'generating' | 'ready' | 'added' | 'error'

export interface CardSegment {
  id: string
  startSec: number
  endSec: number
  japaneseOriginal: string
  japanese: string
  reading: string
  readingSource?: string
  translation: string
  translationSource?: string
  notes: string
  status: SegmentStatus
  error?: string
  noteId?: number
}

export interface CardPayload {
  id: string
  startSec: number
  endSec: number
  japanese: string
  reading: string
  translation: string
  notes: string
}

export interface AnkiFieldMapping {
  sentence: string
  audio: string
  reading: string
  translation: string
  notes: string
}

export interface TranscriptionSettings {
  endpoint: string
  model: string
  language: string
  apiKeySet: boolean
}

export interface TranslationSettings {
  endpoint: string
  model: string
  apiKeySet: boolean
  temperature: number
  customInstructions: string
}

export interface AnkiSettings {
  endpoint: string
  deck: string
  noteType: string
  fields: AnkiFieldMapping
}

export interface AudioSettings {
  paddingMs: number
}

export interface AppSettings {
  transcription: TranscriptionSettings
  translation: TranslationSettings
  anki: AnkiSettings
  audio: AudioSettings
}

export interface SettingsPatch {
  transcription?: {
    endpoint?: string
    model?: string
    language?: string
    apiKey?: string | null
  }
  translation?: {
    endpoint?: string
    model?: string
    apiKey?: string | null
    temperature?: number
    customInstructions?: string
  }
  anki?: Partial<AnkiSettings>
  audio?: Partial<AudioSettings>
}

export interface ReadingResult {
  reading: string
}

export interface TextContext {
  previous?: string
  next?: string
}

export interface TranslationRequest {
  text: string
  includeNotes: boolean
  context?: TextContext
}

export interface TranslationResult {
  translation: string
  notes: string
  warning?: string
}

export interface ProofreadRequest {
  text: string
  context?: TextContext
}

export interface ProofreadChange {
  before: string
  after: string
  reason?: string
}

export interface ProofreadResult {
  corrected: string
  changes: ProofreadChange[]
}

export interface DuplicateNote {
  noteId: number
  sentence: string
  audioMatch: boolean
}

export interface DuplicateCheckRequest {
  japanese: string
  audioHash?: string
}

export interface DuplicateCheckResult {
  duplicates: DuplicateNote[]
}

export interface AddCardRequest {
  sessionId: string
  segment: CardPayload
  force?: boolean
}

export interface AddCardResult {
  status: 'added' | 'duplicate'
  noteId?: number
  duplicates: DuplicateNote[]
  clipHash: string
  clipFileName: string
}

export interface AnkiStatus {
  connected: boolean
  version?: number
  error?: string
}

export interface AnkiCatalog {
  decks: string[]
  models: string[]
}

export interface TestTranslationResult {
  ok: true
  sample: string
}
