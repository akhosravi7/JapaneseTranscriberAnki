import { readFile } from 'node:fs/promises'
import { AppError } from '@shared/errors'
import type { AnkiCatalog, AnkiSettings, CardPayload, DuplicateNote, AddCardResult } from '@shared/types'
import { normalizeJapanese, sanitizeAnkiSearchValue, stripHtml, toAnkiField } from '@shared/text'
import type { ClipResult } from './audio'

interface AnkiResponse {
  result: unknown
  error: unknown
}

interface AnkiNoteInfo {
  noteId: number
  modelName?: string
  tags?: string[]
  fields?: Record<string, { value: string; order: number }>
}

const ANKI_TIMEOUT_MS = 20_000
const MAX_DUPLICATES = 25

async function invoke<T>(settings: AnkiSettings, action: string, params: Record<string, unknown> = {}): Promise<T> {
  const endpoint = settings.endpoint.trim()
  if (!endpoint) {
    throw new AppError('SETTINGS_MISSING', 'Set the AnkiConnect endpoint in Settings.')
  }

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, version: 6, params }),
      signal: AbortSignal.timeout(ANKI_TIMEOUT_MS)
    })
  } catch (error) {
    throw new AppError('ANKI_UNREACHABLE', 'Could not connect to AnkiConnect.', {
      detail: [
        'Make sure Anki is open and the AnkiConnect add-on is installed.',
        'AnkiConnect add-on code: 2055492159',
        error instanceof Error ? error.message : String(error)
      ].join(' '),
      retryable: true
    })
  }

  if (!response.ok) {
    throw new AppError('ANKI_ERROR', `AnkiConnect returned HTTP ${response.status}.`, {
      detail: response.statusText,
      retryable: true
    })
  }

  let payload: AnkiResponse
  try {
    payload = (await response.json()) as AnkiResponse
  } catch (error) {
    throw new AppError('ANKI_ERROR', 'AnkiConnect returned an invalid response.', {
      detail: error instanceof Error ? error.message : undefined,
      retryable: true
    })
  }

  if (payload.error) {
    const message = typeof payload.error === 'string' ? payload.error : JSON.stringify(payload.error)
    throw new AppError('ANKI_ERROR', `AnkiConnect error: ${message}`, { retryable: false })
  }

  return payload.result as T
}

export async function testAnkiConnection(settings: AnkiSettings): Promise<number> {
  const version = await invoke<number>(settings, 'version')
  if (typeof version !== 'number') {
    throw new AppError('ANKI_ERROR', 'AnkiConnect responded, but the version was not a number.')
  }
  return version
}

export async function getAnkiCatalog(settings: AnkiSettings): Promise<AnkiCatalog> {
  const [decks, models] = await Promise.all([
    invoke<string[]>(settings, 'deckNames'),
    invoke<string[]>(settings, 'modelNames')
  ])
  return { decks: Array.isArray(decks) ? decks : [], models: Array.isArray(models) ? models : [] }
}

export async function getModelFields(settings: AnkiSettings, noteType: string): Promise<string[]> {
  const fields = await invoke<string[]>(settings, 'modelFieldNames', { modelName: noteType })
  return Array.isArray(fields) ? fields : []
}

function noteSentence(note: AnkiNoteInfo, fieldName: string): string {
  const fields = note.fields ?? {}
  const value = fields[fieldName]?.value ?? Object.values(fields)[0]?.value ?? ''
  return stripHtml(value).trim()
}

function audioTag(hash: string): string {
  return `ja-audio-${hash.slice(0, 24)}`
}

export async function findDuplicates(
  settings: AnkiSettings,
  japanese: string,
  audioHash?: string
): Promise<DuplicateNote[]> {
  const deck = settings.deck.trim()
  if (!deck) {
    throw new AppError('SETTINGS_MISSING', 'Set an Anki deck in Settings.')
  }

  const normalizedTarget = normalizeJapanese(japanese)
  if (!normalizedTarget) return []

  const deckQuery = `deck:${JSON.stringify(deck)}`
  const queries: string[] = []
  const searchTerm = sanitizeAnkiSearchValue(japanese)
  if (searchTerm) queries.push(`${deckQuery} ${JSON.stringify(searchTerm)}`)
  if (audioHash) queries.push(`${deckQuery} tag:${audioTag(audioHash)}`)

  const idSet = new Set<number>()
  for (const query of queries) {
    try {
      const ids = await invoke<number[]>(settings, 'findNotes', { query })
      if (Array.isArray(ids)) ids.slice(0, 100).forEach((id) => idSet.add(id))
    } catch (error) {
      if (error instanceof AppError && error.code === 'ANKI_UNREACHABLE') throw error
      // A malformed search should not block adding; the other query may still find duplicates.
    }
  }

  if (idSet.size === 0) return []

  const ids = [...idSet].slice(0, 100)
  const notes = await invoke<AnkiNoteInfo[]>(settings, 'notesInfo', { notes: ids })
  if (!Array.isArray(notes)) return []

  const duplicates: DuplicateNote[] = []
  for (const note of notes) {
    const sentence = noteSentence(note, settings.fields.sentence)
    const tags = note.tags ?? []
    const audioMatch = Boolean(audioHash && tags.includes(audioTag(audioHash)))
    const sentenceMatch = normalizedTarget === normalizeJapanese(sentence)
    if (!audioMatch && !sentenceMatch) continue
    duplicates.push({ noteId: note.noteId, sentence, audioMatch })
    if (duplicates.length >= MAX_DUPLICATES) break
  }

  return duplicates
}

function buildFields(settings: AnkiSettings, card: CardPayload, audioFilename: string): Record<string, string> {
  const mapping = settings.fields
  return {
    [mapping.sentence]: toAnkiField(card.japanese),
    [mapping.audio]: `[sound:${audioFilename}]`,
    [mapping.reading]: toAnkiField(card.reading),
    [mapping.translation]: toAnkiField(card.translation),
    ...(mapping.notes ? { [mapping.notes]: toAnkiField(card.notes) } : {})
  }
}

async function validateMapping(settings: AnkiSettings): Promise<void> {
  const fields = await getModelFields(settings, settings.noteType)
  if (fields.length === 0) {
    throw new AppError(
      'ANKI_ERROR',
      `The note type "${settings.noteType}" was not found in Anki. Check the note type name in Settings.`
    )
  }

  const required = [
    settings.fields.sentence,
    settings.fields.audio,
    settings.fields.reading,
    settings.fields.translation
  ].filter(Boolean)
  const missing = required.filter((field) => !fields.includes(field))
  if (missing.length > 0) {
    throw new AppError(
      'ANKI_ERROR',
      `The note type "${settings.noteType}" is missing mapped fields: ${missing.join(', ')}.`,
      { detail: `Available fields: ${fields.join(', ')}` }
    )
  }

  if (settings.fields.notes && !fields.includes(settings.fields.notes)) {
    throw new AppError(
      'ANKI_ERROR',
      `The notes field "${settings.fields.notes}" does not exist on "${settings.noteType}".`,
      { detail: `Available fields: ${fields.join(', ')}` }
    )
  }
}

export async function addCard(
  settings: AnkiSettings,
  card: CardPayload,
  clip: ClipResult,
  force: boolean
): Promise<AddCardResult> {
  if (!card.japanese.trim()) {
    throw new AppError('INVALID_INPUT', 'The card has no Japanese sentence.')
  }

  const duplicates = await findDuplicates(settings, card.japanese, clip.hash)
  if (duplicates.length > 0 && !force) {
    return {
      status: 'duplicate',
      duplicates,
      clipHash: clip.hash,
      clipFileName: clip.fileName
    }
  }

  await validateMapping(settings)

  const mediaData = await readFile(clip.filePath)
  const storedFilename = await invoke<string>(settings, 'storeMediaFile', {
    filename: clip.fileName,
    data: mediaData.toString('base64')
  })

  const noteId = await invoke<number>(settings, 'addNote', {
    note: {
      deckName: settings.deck,
      modelName: settings.noteType,
      fields: buildFields(settings, card, storedFilename || clip.fileName),
      tags: ['japanese-audio', audioTag(clip.hash)],
      options: {
        allowDuplicate: true,
        duplicateScope: 'deck'
      }
    }
  })

  if (typeof noteId !== 'number' || noteId <= 0) {
    throw new AppError('ANKI_ERROR', 'AnkiConnect did not return a valid note ID.')
  }

  return {
    status: 'added',
    noteId,
    duplicates,
    clipHash: clip.hash,
    clipFileName: storedFilename || clip.fileName
  }
}
