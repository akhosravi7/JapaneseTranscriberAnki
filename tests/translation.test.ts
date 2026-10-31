import { afterEach, describe, expect, it, vi } from 'vitest'
import { translateText } from '../src/main/services/translation'

interface CapturedBody {
  model: string
  temperature?: number
  messages: { role: string; content: string }[]
}

function chatResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content } }]
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

describe('translateText', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends context, custom instructions, and temperature', async () => {
    let captured: CapturedBody | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body)) as CapturedBody
        return chatResponse(JSON.stringify({ translation: 'That is easier said than done.', notes: '' }))
      })
    )

    const result = await translateText({
      endpoint: 'https://example.test/v1',
      model: 'qwen-test',
      text: 'そんなこと言われても困るんだけど。',
      includeNotes: false,
      context: { previous: '本当にごめん。', next: 'まあ、しょうがないか。' },
      temperature: 0.35,
      customInstructions: 'Use natural British English.'
    })

    expect(result.translation).toBe('That is easier said than done.')
    expect(captured?.model).toBe('qwen-test')
    expect(captured?.temperature).toBe(0.35)
    const system = captured?.messages.find((message) => message.role === 'system')?.content ?? ''
    const user = captured?.messages.find((message) => message.role === 'user')?.content ?? ''
    expect(system).toContain('Use natural British English.')
    expect(system).toContain('Japanese-to-English')
    expect(user).toContain('PREVIOUS: 本当にごめん。')
    expect(user).toContain('TARGET: そんなこと言われても困るんだけど。')
    expect(user).toContain('NEXT: まあ、しょうがないか。')
  })

  it('uses the raw response with a warning when JSON is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chatResponse('The train had stopped.')))

    const result = await translateText({
      endpoint: 'https://example.test/v1',
      model: 'qwen-test',
      text: '電車が止まってたんだよ。',
      includeNotes: false,
      temperature: 0.2,
      customInstructions: ''
    })

    expect(result.translation).toBe('The train had stopped.')
    expect(result.warning).toContain('did not return valid JSON')
  })
})
