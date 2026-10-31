import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { safeStorage } from 'electron'

const SECRET_NAMES = ['transcription', 'translation'] as const
type SecretName = (typeof SECRET_NAMES)[number]

export class SecretsStore {
  private readonly filePath: string
  private data: Record<string, string> = {}

  constructor(directory: string) {
    this.filePath = join(directory, 'secrets.json')
    this.load()
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Record<string, string>
      if (parsed && typeof parsed === 'object') this.data = parsed
    } catch {
      this.data = {}
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temp = `${this.filePath}.tmp`
    writeFileSync(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 })
    renameSync(temp, this.filePath)
  }

  has(name: SecretName): boolean {
    return Boolean(this.get(name))
  }

  get(name: SecretName): string | undefined {
    if (!SECRET_NAMES.includes(name)) return undefined
    const stored = this.data[name]
    if (!stored) return undefined
    try {
      if (stored.startsWith('safe:') && safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(stored.slice(5), 'base64'))
      }
      if (stored.startsWith('plain:')) return stored.slice(6)
      return undefined
    } catch {
      return undefined
    }
  }

  set(name: SecretName, value: string | null | undefined): void {
    if (!SECRET_NAMES.includes(name)) return
    if (value === undefined) return
    const trimmed = value?.trim() ?? ''
    if (!trimmed) {
      delete this.data[name]
      this.persist()
      return
    }
    if (safeStorage.isEncryptionAvailable()) {
      this.data[name] = `safe:${safeStorage.encryptString(trimmed).toString('base64')}`
    } else {
      this.data[name] = `plain:${trimmed}`
    }
    this.persist()
  }
}
