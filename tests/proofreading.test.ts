import { afterEach, describe, expect, it, vi } from 'vitest'
import { proofreadJapanese } from '../src/main/services/proofreading'

function chatResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content } }]
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

describe('proofreadJapanese', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the corrected target and changes', async () => {
    let body: { messages: { content: string }[]; temperature?: number } | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        body = JSON.parse(String(init?.body)) as typeof body
        return chatResponse(
          JSON.stringify({
            corrected: 'ぶん殴ってやる。',
            changes: [{ before: '分殴って', after: 'ぶん殴って', reason: 'kanji conversion' }]
          })
        )
      })
    )

    const result = await proofreadJapanese({
      endpoint: 'https://example.test/v1',
      model: 'qwen-test',
      text: '分殴ってやる。',
      context: { previous: 'お前、調子乗ってんじゃねえぞ。' }
    })

    expect(result.corrected).toBe('ぶん殴ってやる。')
    expect(result.changes).toEqual([
      { before: '分殴って', after: 'ぶん殴って', reason: 'kanji conversion' }
    ])
    expect(body?.temperature).toBe(0.1)
    expect(body?.messages[0].content).toContain('conservative Japanese transcription proofreader')
    expect(body?.messages[1].content).toContain('TARGET: 分殴ってやる。')
  })

  it('leaves correct text unchanged with an empty changes list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => chatResponse(JSON.stringify({ corrected: '今日はいい天気ですね。', changes: [] })))
    )

    const result = await proofreadJapanese({
      endpoint: 'https://example.test/v1',
      model: 'qwen-test',
      text: '今日はいい天気ですね。'
    })

    expect(result.corrected).toBe('今日はいい天気ですね。')
    expect(result.changes).toEqual([])
  })

  it('rejects malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chatResponse('ぶん殴ってやる。')))

    await expect(
      proofreadJapanese({
        endpoint: 'https://example.test/v1',
        model: 'qwen-test',
        text: '分殴ってやる。'
      })
    ).rejects.toMatchObject({ code: 'PROOFREADING_FAILED' })
  })
})
