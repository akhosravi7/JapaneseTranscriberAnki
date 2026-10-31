const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char])
}

export function toAnkiField(value: string): string {
  return escapeHtml(value.trim()).replace(/\r?\n/g, '<br>')
}

export function normalizeJapanese(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[！]/g, '!')
    .replace(/[？]/g, '?')
    .replace(/[、]/g, ',')
    .replace(/[。]/g, '.')
    .replace(/\s+/g, '')
    .trim()
}

export function sanitizeAnkiSearchValue(value: string): string {
  return value.replace(/["\\]/g, '').replace(/\s+/g, ' ').trim()
}

export function hasJapaneseText(value: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]/.test(value)
}

export function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
