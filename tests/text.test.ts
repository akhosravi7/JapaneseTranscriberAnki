import { describe, expect, it } from 'vitest'
import { escapeHtml, normalizeJapanese, sanitizeAnkiSearchValue, stripHtml, toAnkiField } from '@shared/text'
import { audioTranscriptionUrl, chatCompletionsUrl, formatSeconds } from '@shared/urls'

describe('text helpers', () => {
  it('escapes HTML in Anki fields', () => {
    expect(toAnkiField('a < b & c > d\nnext')).toBe('a &lt; b &amp; c &gt; d<br>next')
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;')
  })

  it('normalizes Japanese punctuation and whitespace for duplicate matching', () => {
    expect(normalizeJapanese(' 今日は、いい天気！ ')).toBe('今日は,いい天気!')
    expect(normalizeJapanese('ＡＢＣ')).toBe('ABC')
  })

  it('strips HTML from Anki field values', () => {
    expect(stripHtml('line<br>two &amp; three')).toBe('line\ntwo & three')
  })

  it('sanitizes Anki search terms', () => {
    expect(sanitizeAnkiSearchValue(' say "hello" \\ ')).toBe('say hello')
  })
})

describe('url helpers', () => {
  it('normalizes transcription endpoints', () => {
    expect(audioTranscriptionUrl('https://host/v1')).toBe('https://host/v1/audio/transcriptions')
    expect(audioTranscriptionUrl('https://host/v1/audio/transcriptions')).toBe(
      'https://host/v1/audio/transcriptions'
    )
    expect(audioTranscriptionUrl('https://host/v1/audio/transcriptions/')).toBe(
      'https://host/v1/audio/transcriptions'
    )
  })

  it('normalizes chat endpoints', () => {
    expect(chatCompletionsUrl('http://localhost:11434/v1')).toBe(
      'http://localhost:11434/v1/chat/completions'
    )
    expect(chatCompletionsUrl('https://api.example.com/openai/v1/chat/completions')).toBe(
      'https://api.example.com/openai/v1/chat/completions'
    )
  })

  it('formats timestamps', () => {
    expect(formatSeconds(0)).toBe('0:00')
    expect(formatSeconds(75.9)).toBe('1:15')
    expect(formatSeconds(Number.NaN)).toBe('0:00')
  })
})
