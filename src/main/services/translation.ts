import { z } from 'zod'
import { AppError } from '@shared/errors'
import type { TextContext, TranslationResult } from '@shared/types'
import { chatCompletionsUrl } from '@shared/urls'

export interface TranslateOptions {
  endpoint: string
  model: string
  apiKey?: string
  text: string
  includeNotes: boolean
  context?: TextContext
  temperature: number
  customInstructions: string
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 3

const chatResponseSchema = z
  .object({
    choices: z
      .array(
        z.object({
          message: z.object({
            content: z.union([z.string(), z.null()]).optional()
          })
        })
      )
      .min(1)
  })
  .loose()

const translationSchema = z.object({
  translation: z.string().min(1),
  notes: z.string().optional()
})

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function systemPrompt(includeNotes: boolean, customInstructions: string): string {
  const notesInstruction = includeNotes
    ? 'Also include "notes": a short, useful vocabulary and grammar explanation (2-4 sentences max). Use an empty string if nothing useful can be added.'
    : 'Set "notes" to an empty string.'

  const userInstructions = customInstructions.trim()
    ? [
        '',
        'Additional translator instructions from the user. Follow these unless they would change the original meaning:',
        customInstructions.trim()
      ].join('\n')
    : ''

  return [
    'You are a professional Japanese-to-English subtitle translator creating Anki study cards.',
    'Translate the TARGET Japanese sentence into natural, contemporary English that reads like a well-edited subtitle.',
    '',
    'Rules:',
    '- Translate meaning and intent, not word order. Avoid stiff literal calques.',
    "- Preserve the speaker's tone, politeness level, and implied subject.",
    '- Use PREVIOUS/NEXT context only to resolve omitted subjects and ambiguity. Translate only the TARGET sentence.',
    '- Keep names and honorifics unless there is a natural English equivalent.',
    '- Do not add events, explanations, or details that are not present.',
    '- Prefer concise, idiomatic spoken English. Contractions are fine when the tone is casual.',
    '- Do not add filler such as "you know" unless the Japanese has a corresponding nuance.',
    '',
    'Return ONLY a JSON object with exactly these keys: "translation" (string) and "notes" (string).',
    notesInstruction,
    'Do not use markdown fences.',
    '',
    'Examples:',
    'TARGET: しょうがないな。 -> {"translation":"I guess there\'s no helping it.","notes":""}',
    'TARGET: 何してんの？ -> {"translation":"What are you doing?","notes":""}',
    "TARGET: 行くしかないだろ。 -> {\"translation\":\"We've got no choice but to go.\",\"notes\":\"\"}",
    'TARGET: さすがにそれはないわ。 -> {"translation":"That\'s a bit much, don\'t you think?","notes":""}',
    "TARGET: そんなこと言われても困るんだけど。 -> {\"translation\":\"That's easier said than done.\",\"notes\":\"\"}",
    userInstructions
  ].join('\n')
}

function userContent(text: string, context?: TextContext): string {
  const lines: string[] = []
  if (context?.previous?.trim()) lines.push(`PREVIOUS: ${context.previous.trim()}`)
  lines.push(`TARGET: ${text.trim()}`)
  if (context?.next?.trim()) lines.push(`NEXT: ${context.next.trim()}`)
  return lines.join('\n')
}

function extractContent(payload: unknown): string | undefined {
  const parsed = chatResponseSchema.safeParse(payload)
  if (!parsed.success) return undefined
  const content = parsed.data.choices[0]?.message.content
  if (typeof content !== 'string') return undefined
  return content.trim()
}

function parseTranslationContent(content: string): TranslationResult {
  const withoutFences = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = withoutFences.indexOf('{')
  const end = withoutFences.lastIndexOf('}')

  if (start >= 0 && end > start) {
    try {
      const candidate = JSON.parse(withoutFences.slice(start, end + 1)) as unknown
      const parsed = translationSchema.safeParse(candidate)
      if (parsed.success) {
        return {
          translation: parsed.data.translation.trim(),
          notes: (parsed.data.notes ?? '').trim()
        }
      }
    } catch {
      // Fall through to the visible warning below.
    }
  }

  if (!withoutFences) {
    throw new AppError('TRANSLATION_FAILED', 'The translation service returned an empty response.', {
      retryable: true
    })
  }

  return {
    translation: withoutFences,
    notes: '',
    warning: 'The translation service did not return valid JSON. The raw response was used as the translation.'
  }
}

async function requestOnce(options: TranslateOptions, url: string): Promise<TranslationResult> {
  if (!options.text.trim()) {
    throw new AppError('INVALID_INPUT', 'Add a Japanese sentence before translating.')
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  }
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: 'system', content: systemPrompt(options.includeNotes, options.customInstructions) },
          { role: 'user', content: userContent(options.text, options.context) }
        ],
        temperature: Math.min(2, Math.max(0, options.temperature))
      }),
      signal: AbortSignal.timeout(90_000)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new AppError('TRANSLATION_FAILED', 'Could not reach the translation service.', {
      detail: message,
      retryable: true
    })
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new AppError('TRANSLATION_FAILED', `Translation failed with HTTP ${response.status}.`, {
      detail: body.slice(0, 800) || response.statusText,
      retryable: RETRYABLE_STATUS.has(response.status)
    })
  }

  let json: unknown
  try {
    json = await response.json()
  } catch (error) {
    throw new AppError('TRANSLATION_FAILED', 'The translation service returned invalid JSON.', {
      detail: error instanceof Error ? error.message : undefined,
      retryable: true
    })
  }

  const content = extractContent(json)
  if (content === undefined) {
    throw new AppError('TRANSLATION_FAILED', 'The translation response did not include message content.', {
      detail: JSON.stringify(json).slice(0, 800),
      retryable: false
    })
  }

  return parseTranslationContent(content)
}

export async function translateText(options: TranslateOptions): Promise<TranslationResult> {
  const url = chatCompletionsUrl(options.endpoint)
  if (!url) {
    throw new AppError('SETTINGS_MISSING', 'Set a translation endpoint in Settings before translating.')
  }
  if (!options.model.trim()) {
    throw new AppError('SETTINGS_MISSING', 'Set a translation model in Settings before translating.')
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
    : new AppError('TRANSLATION_FAILED', 'Translation failed for an unknown reason.')
}
