import { useCallback, useEffect, useState } from 'react'
import { buildSentences } from '@shared/sentence-split'
import type {
  AddCardResult,
  AppSettings,
  CardSegment,
  ImportedAudio,
  TranscriptionResult
} from '@shared/types'
import { isIpcApiError } from '@shared/errors'
import AppHeader from './components/AppHeader'
import ImportScreen from './features/ImportScreen'
import ReviewWorkspace from './features/ReviewWorkspace'
import SettingsModal from './features/SettingsModal'
import Toast, { type ToastMessage } from './components/Toast'
import { SparklesIcon, UploadIcon } from './components/Icons'

type Phase = 'ready' | 'transcribing' | 'review'

export interface UiError {
  message: string
  detail?: string
  retry?: () => void
}

function errorMessage(error: unknown): string {
  if (isIpcApiError(error) || error instanceof Error) return error.message
  return String(error)
}

function errorDetail(error: unknown): string | undefined {
  if (isIpcApiError(error)) return error.detail
  return undefined
}

function createSegments(result: TranscriptionResult): CardSegment[] {
  return buildSentences(result.segments).map((sentence, index) => ({
    id: `sentence-${index + 1}`,
    startSec: sentence.startSec,
    endSec: sentence.endSec,
    japaneseOriginal: sentence.text,
    japanese: sentence.text,
    reading: '',
    translation: '',
    notes: '',
    status: 'transcribed'
  }))
}

export default function App(): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [audio, setAudio] = useState<ImportedAudio | null>(null)
  const [segments, setSegments] = useState<CardSegment[]>([])
  const [sourceTranscript, setSourceTranscript] = useState('')
  const [phase, setPhase] = useState<Phase>('ready')
  const [error, setError] = useState<UiError | null>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ankiOnline, setAnkiOnline] = useState<boolean | null>(null)
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api
      .getSettings()
      .then((value) => {
        if (!cancelled) setSettings(value)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError({ message: errorMessage(loadError), detail: errorDetail(loadError) })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const notify = useCallback((message: string, tone: ToastMessage['tone'] = 'success') => {
    setToast({ id: Date.now(), message, tone })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4200)
    return () => clearTimeout(timer)
  }, [toast])

  const refreshAnkiStatus = useCallback(() => {
    setAnkiOnline(null)
    void window.api
      .testAnki()
      .then((status) => setAnkiOnline(status.connected))
      .catch(() => setAnkiOnline(false))
  }, [])

  useEffect(() => {
    if (!settings) return
    refreshAnkiStatus()
  }, [settings?.anki.endpoint, refreshAnkiStatus, settings])

  const runTranscription = useCallback(async (target: ImportedAudio) => {
    setPhase('transcribing')
    setError(null)
    try {
      const result = await window.api.transcribe(target.sessionId)
      const nextSegments = createSegments(result)
      if (nextSegments.length === 0) {
        setSegments([])
        setSourceTranscript(result.text)
        setPhase('ready')
        setError({
          message: 'The transcription contained no complete sentences.',
          detail: result.text,
          retry: () => void runTranscription(target)
        })
        return
      }
      setSegments(nextSegments)
      setSourceTranscript(result.text)
      setPhase('review')
      notify(`Transcribed ${nextSegments.length} sentence${nextSegments.length === 1 ? '' : 's'}.`)
    } catch (transcriptionError) {
      setPhase('ready')
      setError({
        message: errorMessage(transcriptionError),
        detail: errorDetail(transcriptionError),
        retry: () => void runTranscription(target)
      })
    }
  }, [notify])

  const handleImported = useCallback(
    (imported: ImportedAudio) => {
      setAudio(imported)
      setSegments([])
      setSourceTranscript('')
      setError(null)
      void runTranscription(imported)
    },
    [runTranscription]
  )

  const handleImport = useCallback(
    async (filePath?: string) => {
      if (segments.length > 0) {
        const confirmed = window.confirm(
          'Import a different recording? The current sentences and edits will be replaced.'
        )
        if (!confirmed) return
      }
      try {
        const imported = filePath
          ? await window.api.importAudioPath(filePath)
          : await window.api.importAudio()
        if (!imported) return
        handleImported(imported)
      } catch (importError) {
        setError({ message: errorMessage(importError), detail: errorDetail(importError) })
      }
    },
    [handleImported, segments.length]
  )

  const handleRetranscribe = useCallback(() => {
    if (!audio) return
    if (segments.length > 0) {
      const confirmed = window.confirm(
        'Transcribe this recording again? All current sentence edits and generated content will be replaced.'
      )
      if (!confirmed) return
    }
    setSegments([])
    void runTranscription(audio)
  }, [audio, runTranscription, segments.length])

  const updateSegment = useCallback((id: string, patch: Partial<CardSegment>) => {
    setSegments((previous) => previous.map((segment) => (segment.id === id ? { ...segment, ...patch } : segment)))
  }, [])

  const generateSegment = useCallback(
    async (target: CardSegment) => {
      const includeNotes = Boolean(settings?.anki.fields.notes)
      const index = segments.findIndex((segment) => segment.id === target.id)
      const context =
        index >= 0
          ? {
              previous: segments[index - 1]?.japanese,
              next: segments[index + 1]?.japanese
            }
          : undefined
      updateSegment(target.id, { status: 'generating', error: undefined })

      const [readingResult, translationResult] = await Promise.allSettled([
        window.api.generateReading(target.japanese),
        window.api.translate({ text: target.japanese, includeNotes, context })
      ])

      const patch: Partial<CardSegment> = {}
      const errors: string[] = []

      if (readingResult.status === 'fulfilled') {
        patch.reading = readingResult.value.reading
        patch.readingSource = target.japanese
      } else {
        errors.push(`Reading: ${errorMessage(readingResult.reason)}`)
      }

      if (translationResult.status === 'fulfilled') {
        patch.translation = translationResult.value.translation
        patch.translationSource = target.japanese
        if (translationResult.value.notes) patch.notes = translationResult.value.notes
        if (translationResult.value.warning) notify(translationResult.value.warning, 'warning')
      } else {
        errors.push(`Translation: ${errorMessage(translationResult.reason)}`)
      }

      updateSegment(target.id, {
        ...patch,
        status: errors.length > 0 ? 'error' : 'ready',
        error: errors.length > 0 ? errors.join(' ') : undefined
      })
    },
    [notify, segments, settings?.anki.fields.notes, updateSegment]
  )

  const generateAll = useCallback(async () => {
    if (!settings) return
    const targets = segments.filter(
      (segment) =>
        !segment.reading.trim() ||
        !segment.translation.trim() ||
        segment.readingSource !== segment.japanese ||
        segment.translationSource !== segment.japanese
    )

    if (targets.length === 0) {
      notify('Every sentence already has a current reading and translation.', 'info')
      return
    }

    setBulkProgress({ done: 0, total: targets.length })
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index]
      if (!target.japanese.trim()) {
        setBulkProgress({ done: index + 1, total: targets.length })
        continue
      }
      await generateSegment(target)
      setBulkProgress({ done: index + 1, total: targets.length })
    }
    setBulkProgress(null)
    notify(`Generated content for ${targets.length} sentence${targets.length === 1 ? '' : 's'}.`)
  }, [generateSegment, notify, segments, settings])

  const addToAnki = useCallback(
    async (target: CardSegment, force: boolean): Promise<AddCardResult> => {
      if (!audio) throw new Error('No audio has been imported.')
      const result = await window.api.addToAnki({
        sessionId: audio.sessionId,
        segment: {
          id: target.id,
          startSec: target.startSec,
          endSec: target.endSec,
          japanese: target.japanese,
          reading: target.reading,
          translation: target.translation,
          notes: target.notes
        },
        force
      })

      if (result.status === 'added') {
        updateSegment(target.id, { status: 'added', noteId: result.noteId, error: undefined })
        setAnkiOnline(true)
        notify(`Added to Anki${result.noteId ? ` (note ${result.noteId})` : ''}.`)
      }

      return result
    },
    [audio, notify, updateSegment]
  )

  const handleSettingsSaved = useCallback(
    (updated: AppSettings) => {
      setSettings(updated)
      setSettingsOpen(false)
      setToast({ id: Date.now(), message: 'Settings saved.', tone: 'success' })
      refreshAnkiStatus()
    },
    [refreshAnkiStatus]
  )

  if (!settings) {
    return (
      <div className="app-loading">
        <div className="loading-mark">
          <span />
        </div>
        <p>Loading Kotoba Cards…</p>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <AppHeader
        ankiOnline={ankiOnline}
        onOpenSettings={() => setSettingsOpen(true)}
        hasAudio={Boolean(audio)}
      />

      <main className="app-main">
        {!audio ? (
          <ImportScreen onImport={handleImport} error={error} onDismissError={() => setError(null)} />
        ) : phase === 'transcribing' ? (
          <div className="transcribing-screen">
            <div className="pulse-orb">
              <SparklesIcon width={30} height={30} />
            </div>
            <h1>Listening closely…</h1>
            <p>
              Transcribing <strong>{audio.fileName}</strong> with kotoba-whisper.
            </p>
            <div className="indeterminate-bar">
              <span />
            </div>
          </div>
        ) : segments.length === 0 ? (
          <div className="ready-screen">
            <div className="imported-file-card">
              <div className="file-icon">
                <UploadIcon width={22} height={22} />
              </div>
              <div>
                <p className="eyebrow">Recording ready</p>
                <h2>{audio.fileName}</h2>
                <p className="muted">{(audio.sizeBytes / 1024 / 1024).toFixed(1)} MB</p>
              </div>
              <button className="button primary" onClick={handleRetranscribe}>
                <SparklesIcon width={17} height={17} />
                Transcribe recording
              </button>
            </div>
            {error ? (
              <div className="error-card">
                <p>{error.message}</p>
                {error.detail ? <pre>{error.detail}</pre> : null}
                <div className="error-actions">
                  {error.retry ? (
                    <button className="button primary small" onClick={error.retry}>
                      Retry transcription
                    </button>
                  ) : null}
                  <button className="button ghost small" onClick={() => setError(null)}>
                    Dismiss
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <ReviewWorkspace
            audio={audio}
            segments={segments}
            sourceTranscript={sourceTranscript}
            settings={settings}
            bulkProgress={bulkProgress}
            onUpdateSegment={updateSegment}
            onGenerate={generateSegment}
            onGenerateAll={generateAll}
            onAdd={addToAnki}
            onRetranscribe={handleRetranscribe}
            onReplaceAudio={() => void handleImport()}
            onOpenSettings={() => setSettingsOpen(true)}
            onError={(message, detail) => setError({ message, detail })}
          />
        )}

        {error && (audio === null || phase === 'review') && segments.length > 0 ? (
          <div className="floating-error">
            <div>
              <strong>{error.message}</strong>
              {error.detail ? <p>{error.detail}</p> : null}
            </div>
            <button onClick={() => setError(null)} aria-label="Dismiss error">
              ×
            </button>
          </div>
        ) : null}
      </main>

      {settingsOpen ? (
        <SettingsModal
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSaved={handleSettingsSaved}
        />
      ) : null}

      {toast ? <Toast toast={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  )
}
