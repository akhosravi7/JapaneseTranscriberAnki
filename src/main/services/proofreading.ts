import { z } from 'zod'
import { AppError } from '@shared/errors'
import type { ProofreadResult, TextContext } from '@shared/types'
import { chatCompletionsUrl } from '@shared/urls'

export interface ProofreadOptions {
  endpoint: string
  model: string
  apiKey?: string
  text: string
  context?: TextContext
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

const changeSchema = z.object({
  before: z.string().optional(),
  after: z.string().optional(),
  reason: z.string().optional()
})

const proofreadSchema = z.object({
  corrected: z.string().min(1),
  changes: z.array(changeSchema).optional()
})

const SYSTEM_PROMPT = `You are a conservative Japanese transcription proofreader. The input comes from automatic speech recognition and may contain kanji conversion errors, homophone mistakes, wrong word segmentation, missing particles, or punctuation errors.

The user message may contain PREVIOUS/NEXT lines for context. Correct ONLY the line labeled TARGET. The "corrected" value must contain only the target sentence, never the context lines.

Rules:
- Correct only errors you are highly confident about. If uncertain, leave the text unchanged.
- Preserve the speaker's exact wording, dialect, slang, and tone.
- Do not rewrite for style, simplify grammar, add information, or change meaning.
- Pay special attention to kanji chosen by sound rather than meaning. Example: "分殴って" is usually "ぶん殴って".
- Return the text unchanged when it is already correct or when there is no clear error.
- Write change reasons in concise English if you provide them.

Return ONLY a JSON object with these keys:
- "corrected": corrected Japanese text for the TARGET only
- "changes": array of {"before": string, "after": string, "reason": string}; use [] if unchanged
Do not use markdown fences.`

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function userContent(text: string, context?: TextContext): string {
  const lines: string[] = []
  if (context?.previous?.trim()) lines.push(`PREVIOUS: ${context.previous.trim()}`)
  lines.push(`TARGET: ${text.trim()}`)
  if (context?.next?.trim()) lines.push(`NEXT: ${context.next.trim()}`)
  return lines.join('\n')
}

function parseContent(content: string): ProofreadResult {
  const withoutFences = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = withoutFences.indexOf('{')
  const end = withoutFences.lastIndexOf('}')

  if (start < 0 || end <= start) {
    throw new AppError('PROOFREADING_FAILED', 'The proofreading service did not return valid JSON.', {
      detail: content.slice(0, 800),
      retryable: true
    })
  }

  let candidate: unknown
  try {
    candidate = JSON.parse(withoutFences.slice(start, end + 1))
  } catch (error) {
    throw new AppError('PROOFREADING_FAILED', 'The proofreading service returned malformed JSON.', {
      detail: error instanceof Error ? error.message : undefined,
      retryable: true
    })
  }

  const parsed = proofreadSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new AppError('PROOFREADING_FAILED', 'The proofreading response did not match the expected format.', {
      detail: parsed.error.message,
      retryable: false
    })
  }

  const changes = (parsed.data.changes ?? [])
    .map((change) => ({
      before: (change.before ?? '').trim(),
      after: (change.after ?? '').trim(),
      reason: (change.reason ?? '').trim() || undefined
    }))
    .filter((change) => change.before && change.after)

  return { corrected: parsed.data.corrected.trim(), changes }
}

async function requestOnce(options: ProofreadOptions, url: string): Promise<ProofreadResult> {
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
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent(options.text, options.context) }
        ],
        temperature: 0.1
      }),
      signal: AbortSignal.timeout(90_000)
    })
  } catch (error) {
    throw new AppError('PROOFREADING_FAILED', 'Could not reach the proofreading service.', {
      detail: error instanceof Error ? error.message : String(error),
      retryable: true
    })
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new AppError('PROOFREADING_FAILED', `Proofreading failed with HTTP ${response.status}.`, {
      detail: body.slice(0, 800) || response.statusText,
      retryable: RETRYABLE_STATUS.has(response.status)
    })
  }

  let json: unknown
  try {
    json = await response.json()
  } catch (error) {
    throw new AppError('PROOFREADING_FAILED', 'The proofreading service returned invalid JSON.', {
      detail: error instanceof Error ? error.message : undefined,
      retryable: true
    })
  }

  const chat = chatResponseSchema.safeParse(json)
  const content = chat.success ? chat.data.choices[0]?.message.content : undefined
  if (typeof content !== 'string' || !content.trim()) {
    throw new AppError('PROOFREADING_FAILED', 'The proofreading response did not include message content.', {
      detail: JSON.stringify(json).slice(0, 800),
      retryable: false
    })
  }

  return parseContent(content)
}

export async function proofreadJapanese(options: ProofreadOptions): Promise<ProofreadResult> {
  if (!options.text.trim()) {
    throw new AppError('INVALID_INPUT', 'Add a Japanese sentence before proofreading.')
  }

  const url = chatCompletionsUrl(options.endpoint)
  if (!url) {
    throw new AppError('SETTINGS_MISSING', 'Set a translation endpoint in Settings before proofreading.')
  }
  if (!options.model.trim()) {
    throw new AppError('SETTINGS_MISSING', 'Set a translation model in Settings before proofreading.')
  }

  let lastError: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await requestOnce(options, url)
    } catch (error) {
      lastError = error
      const retryable = error instanceof AppError && error.retryable
      if (!retryable || attempt === MAX_ATTEMPTS - 1) throw error
      await sleep(600 * 2 ** attempt)
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new AppError('PROOFREADING_FAILED', 'Proofreading failed for an unknown reason.')
}
