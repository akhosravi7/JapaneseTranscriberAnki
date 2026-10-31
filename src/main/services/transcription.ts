import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { z } from 'zod'
import { AppError } from '@shared/errors'
import type { TranscriptionResult } from '@shared/types'
import { audioTranscriptionUrl } from '@shared/urls'

export interface TranscribeOptions {
  endpoint: string
  model: string
  language: string
  apiKey?: string
  filePath: string
  fileName: string
  mimeType: string
}

const segmentSchema = z.object({
  start: z.coerce.number(),
  end: z.coerce.number(),
  text: z.string()
})

const verboseResponseSchema = z
  .object({
    text: z.string().optional(),
    language: z.string().optional(),
    duration: z.coerce.number().optional(),
    segments: z.array(segmentSchema).optional()
  })
  .loose()

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 3

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function requestOnce(options: TranscribeOptions, url: string): Promise<TranscriptionResult> {
  const audio = await readFile(options.filePath)
  const form = new FormData()
  const blob = new Blob([new Uint8Array(audio)], { type: options.mimeType })
  form.append('file', blob, basename(options.fileName))
  form.append('model', options.model)
  form.append('language', options.language || 'ja')
  form.append('response_format', 'verbose_json')

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: form,
      signal: AbortSignal.timeout(180_000)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new AppError('TRANSCRIPTION_FAILED', 'Could not reach the transcription service.', {
      detail: message,
      retryable: true
    })
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new AppError(
      'TRANSCRIPTION_FAILED',
      `Transcription failed with HTTP ${response.status}.`,
      {
        detail: body.slice(0, 800) || response.statusText,
        retryable: RETRYABLE_STATUS.has(response.status)
      }
    )
  }

  let json: unknown
  try {
    json = await response.json()
  } catch (error) {
    throw new AppError('TRANSCRIPTION_FAILED', 'The transcription service returned invalid JSON.', {
      detail: error instanceof Error ? error.message : undefined,
      retryable: true
    })
  }

  const parsed = verboseResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new AppError('TRANSCRIPTION_FAILED', 'The transcription response did not match the expected format.', {
      detail: parsed.error.message,
      retryable: false
    })
  }

  const data = parsed.data
  const segments = (data.segments ?? [])
    .map((segment) => ({
      startSec: Math.max(0, segment.start),
      endSec: Math.max(segment.start, segment.end),
      text: segment.text.trim()
    }))
    .filter((segment) => segment.text.length > 0)

  const text = (data.text ?? segments.map((segment) => segment.text).join('')).trim()

  if (!text) {
    throw new AppError('TRANSCRIPTION_EMPTY', 'No speech was detected in this recording.', {
      retryable: false
    })
  }

  if (segments.length === 0) {
    segments.push({
      startSec: 0,
      endSec: Math.max(0, data.duration ?? 0),
      text
    })
  }

  return {
    text,
    segments,
    language: data.language,
    durationSec: data.duration ?? segments[segments.length - 1]?.endSec
  }
}

export async function transcribeAudio(options: TranscribeOptions): Promise<TranscriptionResult> {
  const url = audioTranscriptionUrl(options.endpoint)
  if (!url) {
    throw new AppError('SETTINGS_MISSING', 'Set a transcription endpoint in Settings before transcribing.')
  }

  let lastError: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await requestOnce(options, url)
    } catch (error) {
      lastError = error
      const retryable = error instanceof AppError && error.retryable
      if (!retryable || attempt === MAX_ATTEMPTS - 1) throw error
      await sleep(800 * 2 ** attempt)
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new AppError('TRANSCRIPTION_FAILED', 'Transcription failed for an unknown reason.')
}
