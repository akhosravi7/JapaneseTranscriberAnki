import type { SentenceUnit, TranscriptionSegment } from './types'

const TERMINAL = /[。！？!?…]/
const TERMINAL_END = /[。！？!?…]+$/

interface RawPiece {
  text: string
  breakAfter: boolean
}

interface TimedPiece {
  startSec: number
  endSec: number
  text: string
  endsSentence: boolean
  breakAfter: boolean
}

export interface SentenceSplitOptions {
  mergePauseSec?: number
  maxSentenceChars?: number
}

function splitIntoPieces(text: string): RawPiece[] {
  const normalized = text.replace(/\r/g, '').trim()
  if (!normalized) return []

  const pieces: RawPiece[] = []
  let buffer = ''

  for (const char of normalized) {
    if (char === '\n') {
      if (buffer.trim()) {
        pieces.push({ text: buffer.trim(), breakAfter: true })
      } else if (pieces.length > 0) {
        pieces[pieces.length - 1].breakAfter = true
      }
      buffer = ''
      continue
    }
    buffer += char
    if (TERMINAL.test(char)) {
      pieces.push({ text: buffer.trim(), breakAfter: false })
      buffer = ''
    }
  }

  if (buffer.trim()) pieces.push({ text: buffer.trim(), breakAfter: false })
  return pieces.filter((piece) => piece.text.length > 0)
}

function textWeight(text: string): number {
  return Math.max(1, text.replace(/\s+/g, '').length)
}

function expandSegment(segment: TranscriptionSegment): TimedPiece[] {
  const pieces = splitIntoPieces(segment.text)
  if (pieces.length <= 1) {
    const text = segment.text.trim()
    if (!text) return []
    return [
      {
        startSec: segment.startSec,
        endSec: segment.endSec,
        text,
        endsSentence: TERMINAL_END.test(text),
        breakAfter: pieces[0]?.breakAfter ?? false
      }
    ]
  }

  const duration = Math.max(0, segment.endSec - segment.startSec)
  const weights = pieces.map((piece) => textWeight(piece.text))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  let cursor = segment.startSec

  return pieces.map((piece, index) => {
    const share = duration * (weights[index] / totalWeight)
    const startSec = cursor
    const endSec = index === pieces.length - 1 ? segment.endSec : cursor + share
    cursor = endSec
    return {
      startSec,
      endSec,
      text: piece.text,
      endsSentence: TERMINAL_END.test(piece.text),
      breakAfter: piece.breakAfter
    }
  })
}

export function buildSentences(
  segments: TranscriptionSegment[],
  options: SentenceSplitOptions = {}
): SentenceUnit[] {
  const mergePauseSec = options.mergePauseSec ?? 0.55
  const maxSentenceChars = options.maxSentenceChars ?? 180
  const pieces = segments.flatMap(expandSegment)
  const sentences: SentenceUnit[] = []
  let previousBreakAfter = true

  for (const piece of pieces) {
    const previous = sentences[sentences.length - 1]
    const previousEndsSentence = previous ? TERMINAL_END.test(previous.text) : true
    const gap = previous ? Math.max(0, piece.startSec - previous.endSec) : 0
    const combinedLength = previous ? (previous.text + piece.text).length : 0

    const shouldMerge =
      previous !== undefined &&
      !previousEndsSentence &&
      !previousBreakAfter &&
      gap <= mergePauseSec &&
      combinedLength <= maxSentenceChars

    if (shouldMerge) {
      previous.text = `${previous.text}${piece.text}`
      previous.endSec = piece.endSec
    } else {
      sentences.push({ startSec: piece.startSec, endSec: piece.endSec, text: piece.text })
    }
    previousBreakAfter = piece.breakAfter
  }

  return sentences
}
