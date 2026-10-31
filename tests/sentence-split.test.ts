import { describe, expect, it } from 'vitest'
import { buildSentences } from '@shared/sentence-split'

describe('buildSentences', () => {
  it('splits multiple sentences inside one whisper segment and allocates time by length', () => {
    const result = buildSentences([
      { startSec: 0, endSec: 4, text: 'こんにちは。元気ですか？' }
    ])

    expect(result).toHaveLength(2)
    expect(result[0].text).toBe('こんにちは。')
    expect(result[1].text).toBe('元気ですか？')
    expect(result[0].startSec).toBe(0)
    expect(result[0].endSec).toBeCloseTo(2, 5)
    expect(result[1].endSec).toBe(4)
  })

  it('merges a short fragment into the next sentence when the pause is small', () => {
    const result = buildSentences([
      { startSec: 0, endSec: 1, text: '今日は' },
      { startSec: 1.2, endSec: 3, text: 'いい天気ですね。' }
    ])

    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('今日はいい天気ですね。')
    expect(result[0].startSec).toBe(0)
    expect(result[0].endSec).toBe(3)
  })

  it('keeps sentences separate across a long pause', () => {
    const result = buildSentences([
      { startSec: 0, endSec: 1, text: 'ちょっと' },
      { startSec: 2.5, endSec: 4, text: '待ってください。' }
    ])

    expect(result).toHaveLength(2)
    expect(result[0].text).toBe('ちょっと')
    expect(result[1].text).toBe('待ってください。')
  })

  it('treats newlines as sentence boundaries', () => {
    const result = buildSentences([{ startSec: 0, endSec: 2, text: 'はい\nいいえ' }])
    expect(result.map((sentence) => sentence.text)).toEqual(['はい', 'いいえ'])
  })

  it('ignores empty segments and trims whitespace', () => {
    const result = buildSentences([
      { startSec: 0, endSec: 1, text: '   ' },
      { startSec: 1, endSec: 2, text: '  そうです。  ' }
    ])

    expect(result).toEqual([{ startSec: 1, endSec: 2, text: 'そうです。' }])
  })
})
