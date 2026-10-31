import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionStore } from '../src/main/session-store'
import { AppError } from '../src/shared/errors'

describe('SessionStore.importRecording', () => {
  let directory: string
  let store: SessionStore

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'kotoba-recording-test-'))
    store = new SessionStore(directory)
    await store.init()
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('stores a microphone recording as a webm session', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5])
    const imported = await store.importRecording(data, 'audio/webm;codecs=opus', 'microphone')

    expect(imported.extension).toBe('webm')
    expect(imported.fileName).toMatch(/^Microphone .*\.webm$/)
    expect(imported.mediaUrl).toBe(`media://session/${imported.sessionId}`)
    expect(imported.sizeBytes).toBe(data.byteLength)

    const record = store.get(imported.sessionId)
    const stored = await readFile(record.audioPath)
    expect([...stored]).toEqual([...data])
    expect(existsSync(join(record.directory, 'session.json'))).toBe(true)
  })

  it('labels system audio recordings separately', async () => {
    const imported = await store.importRecording(new Uint8Array([9, 8, 7]), 'audio/webm', 'system')
    expect(imported.fileName).toMatch(/^System audio .*\.webm$/)
  })

  it('rejects empty recordings', async () => {
    await expect(store.importRecording(new Uint8Array(), 'audio/webm', 'microphone')).rejects.toMatchObject({
      code: 'IMPORT_FAILED'
    })
  })

  it('rejects unsupported recording formats', async () => {
    await expect(
      store.importRecording(new Uint8Array([1]), 'audio/x-unknown', 'microphone')
    ).rejects.toBeInstanceOf(AppError)
  })
})
