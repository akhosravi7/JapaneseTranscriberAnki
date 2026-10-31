import { AppError } from '@shared/errors'
import type { ReadingResult } from '@shared/types'
import Kuroshiro from 'kuroshiro'
import KuromojiAnalyzer from 'kuroshiro-analyzer-kuromoji'

let converterPromise: Promise<Kuroshiro> | undefined

function dictionaryPath(): string | undefined {
  try {
    return `${require.resolve('kuromoji').replace(/src(?!.*src).*/, 'dict/')}`
  } catch {
    return undefined
  }
}

async function getConverter(): Promise<Kuroshiro> {
  if (!converterPromise) {
    converterPromise = (async () => {
      const converter = new Kuroshiro()
      const dictPath = dictionaryPath()
      await converter.init(new KuromojiAnalyzer(dictPath ? { dictPath } : undefined))
      return converter
    })().catch((error) => {
      converterPromise = undefined
      throw error
    })
  }
  return converterPromise
}

export async function generateReading(text: string): Promise<ReadingResult> {
  if (!text.trim()) {
    throw new AppError('INVALID_INPUT', 'Add a Japanese sentence before generating a reading.')
  }

  try {
    const converter = await getConverter()
    const reading = await converter.convert(text.trim(), { to: 'hiragana', mode: 'normal' })
    return { reading: reading.trim() }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('READING_FAILED', 'Could not generate hiragana for this sentence.', {
      detail: error instanceof Error ? error.message : String(error),
      retryable: false
    })
  }
}
