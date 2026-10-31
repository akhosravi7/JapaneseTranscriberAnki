export type AppErrorCode =
  | 'INVALID_INPUT'
  | 'FILE_NOT_FOUND'
  | 'UNSUPPORTED_AUDIO'
  | 'IMPORT_FAILED'
  | 'SETTINGS_MISSING'
  | 'TRANSCRIPTION_FAILED'
  | 'TRANSCRIPTION_EMPTY'
  | 'TRANSLATION_FAILED'
  | 'PROOFREADING_FAILED'
  | 'READING_FAILED'
  | 'ANKI_UNREACHABLE'
  | 'ANKI_ERROR'
  | 'AUDIO_CLIP_FAILED'
  | 'SESSION_NOT_FOUND'
  | 'UNKNOWN'

export interface AppErrorShape {
  code: AppErrorCode
  message: string
  detail?: string
  retryable: boolean
}

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly detail?: string
  readonly retryable: boolean

  constructor(code: AppErrorCode, message: string, options: { detail?: string; retryable?: boolean } = {}) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.detail = options.detail
    this.retryable = options.retryable ?? false
  }

  toShape(): AppErrorShape {
    return { code: this.code, message: this.message, detail: this.detail, retryable: this.retryable }
  }
}

export class IpcApiError extends Error {
  readonly code: AppErrorCode
  readonly detail?: string
  readonly retryable: boolean

  constructor(shape: AppErrorShape) {
    super(shape.message)
    this.name = 'IpcApiError'
    this.code = shape.code
    this.detail = shape.detail
    this.retryable = shape.retryable
  }
}

export function toAppErrorShape(error: unknown): AppErrorShape {
  if (error instanceof AppError) return error.toShape()
  if (error instanceof Error) {
    return { code: 'UNKNOWN', message: error.message, retryable: false }
  }
  return { code: 'UNKNOWN', message: 'An unexpected error occurred.', retryable: false }
}

export function isIpcApiError(error: unknown): error is IpcApiError {
  return error instanceof IpcApiError
}
