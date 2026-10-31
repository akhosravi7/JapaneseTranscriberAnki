import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import ffmpegStatic from 'ffmpeg-static'
import { AppError } from '@shared/errors'

export interface ClipResult {
  filePath: string
  fileName: string
  hash: string
}

function ffmpegPath(): string {
  const fallback = ffmpegStatic ?? 'ffmpeg'
  return fallback.replace('app.asar', 'app.asar.unpacked')
}

export function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function runFfmpeg(args: string[]): Promise<void> {
  const binary = ffmpegPath()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(
        new AppError('AUDIO_CLIP_FAILED', 'Audio clip extraction timed out.', { retryable: true })
      )
    }, 90_000)

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      if (stderr.length > 4000) stderr = stderr.slice(-4000)
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(
        new AppError('AUDIO_CLIP_FAILED', 'Could not start ffmpeg for audio clipping.', {
          detail: error.message,
          retryable: false
        })
      )
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve()
        return
      }
      reject(
        new AppError('AUDIO_CLIP_FAILED', 'ffmpeg could not extract the sentence audio.', {
          detail: stderr.trim() || `ffmpeg exited with code ${code}`,
          retryable: false
        })
      )
    })
  })
}

export async function createSentenceClip(options: {
  sourcePath: string
  sessionDirectory: string
  segmentId: string
  startSec: number
  endSec: number
  paddingMs: number
}): Promise<ClipResult> {
  const { sourcePath, sessionDirectory, segmentId, startSec, endSec } = options
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) {
    throw new AppError('INVALID_INPUT', 'The sentence timestamps are invalid.')
  }

  const padding = Math.max(0, options.paddingMs) / 1000
  const start = Math.max(0, Math.min(startSec, endSec) - padding)
  const duration = Math.max(0.2, Math.abs(endSec - startSec) + padding * 2)
  const clipsDirectory = join(sessionDirectory, 'clips')
  await mkdir(clipsDirectory, { recursive: true })

  const safeId = segmentId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const filePath = join(clipsDirectory, `${safeId}.mp3`)

  const sourceInfo = await stat(sourcePath).catch(() => undefined)
  if (!sourceInfo) {
    throw new AppError('FILE_NOT_FOUND', 'The original audio file is missing from this session.')
  }

  await runFfmpeg([
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    start.toFixed(3),
    '-i',
    sourcePath,
    '-t',
    duration.toFixed(3),
    '-vn',
    '-ac',
    '1',
    '-ar',
    '44100',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    filePath
  ])

  const hash = await hashFile(filePath)
  return { filePath, fileName: `${hash.slice(0, 24)}.mp3`, hash }
}
