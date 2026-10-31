import { dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { toAppErrorShape } from '@shared/errors'
import { IPC, type IpcResult } from '@shared/ipc'
import { AUDIO_EXTENSIONS, type SettingsPatch } from '@shared/types'
import type { SettingsStore } from './settings-store'
import type { SessionStore } from './session-store'
import { transcribeAudio } from './services/transcription'
import { translateText } from './services/translation'
import { proofreadJapanese } from './services/proofreading'
import { generateReading } from './services/reading'
import { createSentenceClip } from './services/audio'
import {
  addCard,
  findDuplicates,
  getAnkiCatalog,
  getModelFields,
  testAnkiConnection
} from './services/anki'

interface Dependencies {
  sessions: SessionStore
  settings: SettingsStore
}

const ankiSettingsSchema = z.object({
  endpoint: z.string().max(2000),
  deck: z.string().max(500),
  noteType: z.string().max(500),
  fields: z.object({
    sentence: z.string().max(200),
    audio: z.string().max(200),
    reading: z.string().max(200),
    translation: z.string().max(200),
    notes: z.string().max(200)
  })
})

const textContextSchema = z
  .object({
    previous: z.string().max(10000).optional(),
    next: z.string().max(10000).optional()
  })
  .optional()

const settingsPatchSchema = z.object({
  transcription: z
    .object({
      endpoint: z.string().max(2000).optional(),
      model: z.string().max(500).optional(),
      language: z.string().max(50).optional(),
      apiKey: z.string().max(8000).nullable().optional()
    })
    .optional(),
  translation: z
    .object({
      endpoint: z.string().max(2000).optional(),
      model: z.string().max(500).optional(),
      apiKey: z.string().max(8000).nullable().optional(),
      temperature: z.number().finite().min(0).max(2).optional(),
      customInstructions: z.string().max(4000).optional()
    })
    .optional(),
  anki: ankiSettingsSchema.partial().optional(),
  audio: z
    .object({
      paddingMs: z.number().finite().min(0).max(3000).optional()
    })
    .optional()
})

const addCardRequestSchema = z.object({
  sessionId: z.string().min(1).max(200),
  segment: z.object({
    id: z.string().min(1).max(200),
    startSec: z.number().finite().min(0),
    endSec: z.number().finite().min(0),
    japanese: z.string().max(10000),
    reading: z.string().max(10000),
    translation: z.string().max(20000),
    notes: z.string().max(20000)
  }),
  force: z.boolean().optional()
})

function registerHandler<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (...args: TArgs) => Promise<TResult>
): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<IpcResult<TResult>> => {
    try {
      return { ok: true, data: await handler(...(args as TArgs)) }
    } catch (error) {
      return { ok: false, error: toAppErrorShape(error) }
    }
  })
}

export function registerIpc({ sessions, settings }: Dependencies): void {
  registerHandler(IPC.importAudio, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Japanese audio',
      properties: ['openFile'],
      filters: [
        { name: 'Audio', extensions: [...AUDIO_EXTENSIONS] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return sessions.importFile(result.filePaths[0])
  })

  registerHandler(IPC.importAudioPath, async (filePath: string) => {
    const parsed = z.string().min(1).max(4096).parse(filePath)
    return sessions.importFile(parsed)
  })

  registerHandler(IPC.transcribe, async (sessionId: string) => {
    const id = z.string().min(1).max(200).parse(sessionId)
    const record = sessions.get(id)
    const current = settings.get()

    return transcribeAudio({
      endpoint: current.transcription.endpoint,
      model: current.transcription.model,
      language: current.transcription.language,
      apiKey: settings.getApiKey('transcription'),
      filePath: record.audioPath,
      fileName: record.fileName,
      mimeType: mimeTypeForExtension(record.extension)
    })
  })

  registerHandler(IPC.generateReading, async (text: string) => {
    return generateReading(z.string().min(1).max(10000).parse(text))
  })

  registerHandler(IPC.translate, async (request: unknown) => {
    const parsed = z
      .object({
        text: z.string().min(1).max(10000),
        includeNotes: z.boolean(),
        context: textContextSchema
      })
      .parse(request)
    const current = settings.get()
    return translateText({
      endpoint: current.translation.endpoint,
      model: current.translation.model,
      apiKey: settings.getApiKey('translation'),
      text: parsed.text,
      includeNotes: parsed.includeNotes,
      context: parsed.context,
      temperature: current.translation.temperature,
      customInstructions: current.translation.customInstructions
    })
  })

  registerHandler(IPC.proofreadJapanese, async (request: unknown) => {
    const parsed = z
      .object({
        text: z.string().min(1).max(10000),
        context: textContextSchema
      })
      .parse(request)
    const current = settings.get()
    return proofreadJapanese({
      endpoint: current.translation.endpoint,
      model: current.translation.model,
      apiKey: settings.getApiKey('translation'),
      text: parsed.text,
      context: parsed.context
    })
  })

  registerHandler(IPC.checkDuplicates, async (request: unknown) => {
    const parsed = z
      .object({ japanese: z.string().max(10000), audioHash: z.string().max(128).optional() })
      .parse(request)
    const current = settings.get()
    const duplicates = await findDuplicates(current.anki, parsed.japanese, parsed.audioHash)
    return { duplicates }
  })

  registerHandler(IPC.addToAnki, async (request: unknown) => {
    const parsed = addCardRequestSchema.parse(request)
    const record = sessions.get(parsed.sessionId)
    const current = settings.get()

    const clip = await createSentenceClip({
      sourcePath: record.audioPath,
      sessionDirectory: record.directory,
      segmentId: parsed.segment.id,
      startSec: parsed.segment.startSec,
      endSec: parsed.segment.endSec,
      paddingMs: current.audio.paddingMs
    })

    return addCard(current.anki, parsed.segment, clip, Boolean(parsed.force))
  })

  registerHandler(IPC.getSettings, async () => settings.get())

  registerHandler(IPC.saveSettings, async (patch: unknown) => {
    const parsed = settingsPatchSchema.parse(patch) as SettingsPatch
    return settings.save(parsed)
  })

  registerHandler(IPC.testAnki, async (override?: unknown) => {
    const current = override ? ankiSettingsSchema.parse(override) : settings.get().anki
    try {
      const version = await testAnkiConnection(current)
      return { connected: true, version }
    } catch (error) {
      const shape = toAppErrorShape(error)
      return { connected: false, error: shape.message }
    }
  })

  registerHandler(IPC.getAnkiCatalog, async (override?: unknown) => {
    const current = override ? ankiSettingsSchema.parse(override) : settings.get().anki
    return getAnkiCatalog(current)
  })

  registerHandler(IPC.getModelFields, async (noteType: string, override?: unknown) => {
    const name = z.string().min(1).max(500).parse(noteType)
    const current = override ? ankiSettingsSchema.parse(override) : settings.get().anki
    return getModelFields(current, name)
  })

  registerHandler(IPC.testTranslation, async () => {
    const current = settings.get()
    const result = await translateText({
      endpoint: current.translation.endpoint,
      model: current.translation.model,
      apiKey: settings.getApiKey('translation'),
      text: 'こんにちは。今日はいい天気ですね。',
      includeNotes: false,
      temperature: current.translation.temperature,
      customInstructions: current.translation.customInstructions
    })
    return { ok: true as const, sample: result.translation }
  })
}

function mimeTypeForExtension(extension: string): string {
  const map: Record<string, string> = {
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    aac: 'audio/aac',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    opus: 'audio/opus',
    webm: 'audio/webm'
  }
  return map[extension] ?? 'application/octet-stream'
}
