import { writeFileSync } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSentenceClip, hashFile } from '../src/main/services/audio'

function writeWav(path: string, seconds: number, sampleRate = 16000): void {
  const samples = Math.floor(seconds * sampleRate)
  const dataSize = samples * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(Math.sin((index / sampleRate) * Math.PI * 440) * 9000)
    buffer.writeInt16LE(value, 44 + index * 2)
  }
  writeFileSync(path, buffer)
}

describe('createSentenceClip', () => {
  let directory: string

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'kotoba-audio-test-'))
    writeWav(join(directory, 'source.wav'), 2)
  })

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('extracts an mp3 clip and hashes the result', async () => {
    const clip = await createSentenceClip({
      sourcePath: join(directory, 'source.wav'),
      sessionDirectory: directory,
      segmentId: 'sentence-1',
      startSec: 0.4,
      endSec: 1.5,
      paddingMs: 100
    })

    const info = await stat(clip.filePath)
    expect(info.size).toBeGreaterThan(1000)
    expect(clip.fileName).toMatch(/^[a-f0-9]{24}\.mp3$/)
    expect(clip.hash).toHaveLength(64)
    await expect(hashFile(clip.filePath)).resolves.toBe(clip.hash)
  }, 30000)
})
