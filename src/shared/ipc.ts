import type {
  AddCardRequest,
  AddCardResult,
  AnkiCatalog,
  AnkiSettings,
  AppSettings,
  DuplicateCheckRequest,
  DuplicateCheckResult,
  ImportedAudio,
  ProofreadRequest,
  ProofreadResult,
  ReadingResult,
  SaveRecordingRequest,
  ScreenAudioStatus,
  SettingsPatch,
  TestTranslationResult,
  TranscriptionResult,
  TranslationRequest,
  TranslationResult
} from './types'
import type { AppErrorShape } from './errors'

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorShape }

export const IPC = {
  importAudio: 'app:importAudio',
  importAudioPath: 'app:importAudioPath',
  saveRecording: 'app:saveRecording',
  requestMicrophoneAccess: 'app:requestMicrophoneAccess',
  getScreenAudioStatus: 'app:getScreenAudioStatus',
  openScreenAudioSettings: 'app:openScreenAudioSettings',
  copyAppBundlePath: 'app:copyAppBundlePath',
  transcribe: 'app:transcribe',
  generateReading: 'app:generateReading',
  translate: 'app:translate',
  proofreadJapanese: 'app:proofreadJapanese',
  checkDuplicates: 'app:checkDuplicates',
  addToAnki: 'app:addToAnki',
  getSettings: 'app:getSettings',
  saveSettings: 'app:saveSettings',
  testAnki: 'app:testAnki',
  getAnkiCatalog: 'app:getAnkiCatalog',
  getModelFields: 'app:getModelFields',
  testTranslation: 'app:testTranslation'
} as const

export interface DesktopApi {
  importAudio(): Promise<ImportedAudio | null>
  importAudioPath(filePath: string): Promise<ImportedAudio>
  saveRecording(request: SaveRecordingRequest): Promise<ImportedAudio>
  requestMicrophoneAccess(): Promise<boolean>
  getScreenAudioStatus(): Promise<ScreenAudioStatus>
  openScreenAudioSettings(): Promise<void>
  copyAppBundlePath(): Promise<string>
  pathForFile(file: File): string
  transcribe(sessionId: string): Promise<TranscriptionResult>
  generateReading(text: string): Promise<ReadingResult>
  translate(request: TranslationRequest): Promise<TranslationResult>
  proofreadJapanese(request: ProofreadRequest): Promise<ProofreadResult>
  checkDuplicates(request: DuplicateCheckRequest): Promise<DuplicateCheckResult>
  addToAnki(request: AddCardRequest): Promise<AddCardResult>
  getSettings(): Promise<AppSettings>
  saveSettings(patch: SettingsPatch): Promise<AppSettings>
  testAnki(settings?: AnkiSettings): Promise<{ connected: boolean; version?: number; error?: string }>
  getAnkiCatalog(settings?: AnkiSettings): Promise<AnkiCatalog>
  getModelFields(noteType: string, settings?: AnkiSettings): Promise<string[]>
  testTranslation(): Promise<TestTranslationResult>
}
