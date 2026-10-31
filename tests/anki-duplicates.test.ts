import { afterEach, describe, expect, it, vi } from 'vitest'
import { findDuplicates } from '../src/main/services/anki'
import type { AnkiSettings } from '@shared/types'

const settings: AnkiSettings = {
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

function response(result: unknown): Response {
  return new Response(JSON.stringify({ result, error: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('findDuplicates', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requires an exact normalized sentence match or an audio tag match', async () => {
    const requests: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body)) as {
          action: string
          params: Record<string, unknown>
        }
        requests.push(payload.action)
        if (payload.action === 'findNotes') {
          const query = String(payload.params.query)
          if (query.includes('tag:ja-audio-')) return response([2])
          return response([1, 3])
        }
        if (payload.action === 'notesInfo') {
          return response([
            {
              noteId: 1,
              fields: { Sentence: { value: '今日は、いい天気！', order: 0 } },
              tags: []
            },
            {
              noteId: 2,
              fields: { Sentence: { value: '全然違う文。', order: 0 } },
              tags: ['ja-audio-abc123def']
            },
            {
              noteId: 3,
              fields: { Sentence: { value: '今日はいい天気', order: 0 } },
              tags: []
            }
          ])
        }
        return response(null)
      })
    )

    const duplicates = await findDuplicates(settings, '今日は、いい天気！', 'abc123def')

    expect(requests).toContain('findNotes')
    expect(requests).toContain('notesInfo')
    expect(duplicates.map((duplicate) => duplicate.noteId).sort()).toEqual([1, 2])
    expect(duplicates.find((duplicate) => duplicate.noteId === 1)?.audioMatch).toBe(false)
    expect(duplicates.find((duplicate) => duplicate.noteId === 2)?.audioMatch).toBe(true)
  })

  it('returns no duplicates when Anki has no matching notes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body)) as { action: string }
        if (payload.action === 'findNotes') return response([])
        return response([])
      })
    )

    await expect(findDuplicates(settings, 'こんにちは。')).resolves.toEqual([])
  })
})
