import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { AUDIO_EXTENSIONS, type AudioExtension, type ImportedAudio } from '@shared/types'
import { AppError } from '@shared/errors'

interface SessionMeta {
  id: string
  fileName: string
  extension: AudioExtension
  sizeBytes: number
  importedAt: string
}

export interface SessionRecord extends SessionMeta {
  audioPath: string
  directory: string
}

function isAudioExtension(value: string): value is AudioExtension {
  return (AUDIO_EXTENSIONS as readonly string[]).includes(value)
}

export class SessionStore {
  private readonly root: string
  private readonly sessions = new Map<string, SessionRecord>()

  constructor(root: string) {
    this.root = root
  }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    const entries = await readdir(this.root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const metaPath = join(this.root, entry.name, 'session.json')
      if (!existsSync(metaPath)) continue
      try {
        const meta = JSON.parse(await readFile(metaPath, 'utf8')) as SessionMeta
        const audioPath = join(this.root, entry.name, `original.${meta.extension}`)
        if (!existsSync(audioPath)) continue
        this.sessions.set(meta.id, {
          ...meta,
          audioPath,
          directory: join(this.root, entry.name)
        })
      } catch {
        continue
      }
    }
  }

  async importFile(sourcePath: string): Promise<ImportedAudio> {
    if (!sourcePath || typeof sourcePath !== 'string') {
      throw new AppError('INVALID_INPUT', 'No audio file was selected.')
    }
    const absolute = resolve(sourcePath)
    if (!existsSync(absolute)) {
      throw new AppError('FILE_NOT_FOUND', 'The selected audio file no longer exists.')
    }

    const info = await stat(absolute)
    if (!info.isFile()) {
      throw new AppError('IMPORT_FAILED', 'The selected path is not a file.')
    }
    if (info.size === 0) {
      throw new AppError('IMPORT_FAILED', 'The selected audio file is empty.')
    }

    const extension = extname(absolute).slice(1).toLowerCase()
    if (!isAudioExtension(extension)) {
      throw new AppError(
        'UNSUPPORTED_AUDIO',
        `Unsupported audio format${extension ? ` ".${extension}"` : ''}. Use ${AUDIO_EXTENSIONS.join(', ')}.`
      )
    }

    const id = randomUUID()
    const directory = join(this.root, id)
    await mkdir(directory, { recursive: true })
    const audioPath = join(directory, `original.${extension}`)
    await copyFile(absolute, audioPath)

    const meta: SessionMeta = {
      id,
      fileName: absolute.split('/').pop() ?? `audio.${extension}`,
      extension,
      sizeBytes: info.size,
      importedAt: new Date().toISOString()
    }
    await writeFile(join(directory, 'session.json'), JSON.stringify(meta, null, 2), 'utf8')

    this.sessions.set(id, { ...meta, audioPath, directory })

    return {
      sessionId: id,
      fileName: meta.fileName,
      mediaUrl: `media://session/${id}`,
      sizeBytes: meta.sizeBytes,
      extension: meta.extension,
      importedAt: meta.importedAt
    }
  }

  get(id: string): SessionRecord {
    const record = this.sessions.get(id)
    if (!record) {
      throw new AppError('SESSION_NOT_FOUND', 'The imported audio session could not be found. Please import the file again.')
    }
    return record
  }

  getDirectory(id: string): string {
    return this.get(id).directory
  }

  getMediaPath(id: string): string {
    return this.get(id).audioPath
  }
}
