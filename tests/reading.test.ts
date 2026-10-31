import { describe, expect, it } from 'vitest'
import { generateReading } from '../src/main/services/reading'

describe('generateReading', () => {
  it('converts kanji to hiragana', async () => {
    const result = await generateReading('今日はいい天気ですね。')
    expect(result.reading).toBe('きょうはいいてんきですね。')
  })

  it('rejects empty text', async () => {
    await expect(generateReading('   ')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
}, 30000)
