declare module 'kuroshiro' {
  export interface ConvertOptions {
    to?: 'hiragana' | 'katakana' | 'romaji'
    mode?: 'normal' | 'spaced' | 'okurigana' | 'furigana'
    delimiter?: string
    romajiSystem?: 'nippon' | 'passport' | 'hepburn'
  }

  export default class Kuroshiro {
    init(analyzer: unknown): Promise<void>
    convert(text: string, options?: ConvertOptions): Promise<string>
  }
}

declare module 'kuroshiro-analyzer-kuromoji' {
  interface KuromojiAnalyzerOptions {
    dictPath?: string
  }

  export default class KuromojiAnalyzer {
    constructor(options?: KuromojiAnalyzerOptions)
    init(): Promise<void>
  }
}
