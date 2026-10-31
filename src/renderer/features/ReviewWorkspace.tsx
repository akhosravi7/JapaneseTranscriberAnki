import { useEffect, useMemo, useState } from 'react'
import type { AddCardResult, AppSettings, CardSegment, DuplicateNote, ImportedAudio } from '@shared/types'
import { formatSeconds } from '@shared/urls'
import { isIpcApiError } from '@shared/errors'
import AudioPlayer from '../components/AudioPlayer'
import {
  CheckIcon,
  CloseIcon,
  MusicIcon,
  RefreshIcon,
  SparklesIcon,
  UploadIcon,
  WarningIcon
} from '../components/Icons'
import CardPreview from './CardPreview'
import SentenceEditor from './SentenceEditor'

interface Props {
  audio: ImportedAudio
  segments: CardSegment[]
  sourceTranscript: string
  settings: AppSettings
  bulkProgress: { done: number; total: number } | null
  onUpdateSegment: (id: string, patch: Partial<CardSegment>) => void
  onGenerate: (segment: CardSegment) => void
  onGenerateAll: () => void
  onAdd: (segment: CardSegment, force: boolean) => Promise<AddCardResult>
  onRetranscribe: () => void
  onReplaceAudio: () => void
  onOpenSettings: () => void
  onError: (message: string, detail?: string) => void
}

interface DuplicatePrompt {
  segment: CardSegment
  duplicates: DuplicateNote[]
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function errorDetail(error: unknown): string | undefined {
  return isIpcApiError(error) ? error.detail : undefined
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function ReviewWorkspace({
  audio,
  segments,
  sourceTranscript,
  settings,
  bulkProgress,
  onUpdateSegment,
  onGenerate,
  onGenerateAll,
  onAdd,
  onRetranscribe,
  onReplaceAudio,
  onOpenSettings,
  onError
}: Props): React.JSX.Element {
  const [selectedId, setSelectedId] = useState(segments[0]?.id ?? '')
  const [addingId, setAddingId] = useState<string | null>(null)
  const [duplicatePrompt, setDuplicatePrompt] = useState<DuplicatePrompt | null>(null)

  useEffect(() => {
    if (!segments.some((segment) => segment.id === selectedId)) {
      setSelectedId(segments[0]?.id ?? '')
    }
  }, [segments, selectedId])

  const selected = useMemo(
    () => segments.find((segment) => segment.id === selectedId) ?? segments[0],
    [segments, selectedId]
  )
  const selectedIndex = selected ? segments.findIndex((segment) => segment.id === selected.id) : -1
  const previousText = selectedIndex > 0 ? segments[selectedIndex - 1]?.japanese : undefined
  const nextText =
    selectedIndex >= 0 && selectedIndex < segments.length - 1
      ? segments[selectedIndex + 1]?.japanese
      : undefined

  const showNotes = Boolean(settings.anki.fields.notes)
  const readyCount = segments.filter(
    (segment) => segment.reading.trim() && segment.translation.trim()
  ).length
  const addedCount = segments.filter((segment) => segment.status === 'added').length

  const handleAdd = async (segment: CardSegment, force: boolean): Promise<void> => {
    setAddingId(segment.id)
    try {
      const result = await onAdd(segment, force)
      if (result.status === 'duplicate') {
        setDuplicatePrompt({ segment, duplicates: result.duplicates })
      } else {
        setDuplicatePrompt(null)
      }
    } catch (addError) {
      onError(errorMessage(addError), errorDetail(addError))
    } finally {
      setAddingId(null)
    }
  }

  return (
    <div className="workspace">
      <aside className="sentence-sidebar">
        <div className="file-summary">
          <span className="file-icon">
            <MusicIcon width={18} height={18} />
          </span>
          <div className="file-summary-text">
            <strong title={audio.fileName}>{audio.fileName}</strong>
            <span>
              {formatBytes(audio.sizeBytes)} · {segments.length} sentences
            </span>
          </div>
          <button
            className="icon-button soft"
            title="Replace audio"
            aria-label="Replace audio"
            onClick={onReplaceAudio}
          >
            <UploadIcon width={16} height={16} />
          </button>
          <button
            className="icon-button soft"
            title="Transcribe again"
            aria-label="Transcribe again"
            onClick={onRetranscribe}
          >
            <RefreshIcon width={16} height={16} />
          </button>
        </div>

        <div className="sidebar-toolbar">
          <div>
            <p className="eyebrow">Sentences</p>
            <span className="sidebar-count">
              {readyCount}/{segments.length} ready
              {addedCount > 0 ? ` · ${addedCount} added` : ''}
            </span>
          </div>
          <button className="button secondary small" onClick={onGenerateAll} disabled={Boolean(bulkProgress)}>
            <SparklesIcon width={15} height={15} />
            {bulkProgress ? `${bulkProgress.done}/${bulkProgress.total}` : 'Generate all'}
          </button>
        </div>

        <div className="sentence-list" role="listbox" aria-label="Sentences">
          {segments.map((segment, index) => (
            <button
              key={segment.id}
              role="option"
              aria-selected={segment.id === selected?.id}
              className={`sentence-row ${segment.id === selected?.id ? 'selected' : ''}`}
              onClick={() => setSelectedId(segment.id)}
            >
              <span className="sentence-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="sentence-row-body">
                <span className="sentence-time">
                  {formatSeconds(segment.startSec)} – {formatSeconds(segment.endSec)}
                </span>
                <span className="sentence-snippet" lang="ja">
                  {segment.japanese.trim() || 'Empty sentence'}
                </span>
              </span>
              <span className={`sentence-state ${segment.status}`} title={segment.status}>
                {segment.status === 'added' ? (
                  <CheckIcon width={14} height={14} />
                ) : segment.status === 'generating' ? (
                  <span className="tiny-spinner" />
                ) : segment.status === 'error' ? (
                  <WarningIcon width={14} height={14} />
                ) : (
                  <span className="dot" />
                )}
              </span>
            </button>
          ))}
        </div>

        <details className="source-transcript">
          <summary>Original transcript</summary>
          <p lang="ja">{sourceTranscript}</p>
        </details>
      </aside>

      {selected ? (
        <section className="review-main">
          <div className="review-audio-strip">
            <AudioPlayer src={audio.mediaUrl} startSec={selected.startSec} endSec={selected.endSec} />
            {!settings.translation.endpoint ? (
              <button className="link-button" onClick={onOpenSettings}>
                Translation endpoint missing — open settings
              </button>
            ) : settings.translation.endpoint.includes('api.openai.com') &&
              !settings.translation.apiKeySet ? (
              <button className="link-button" onClick={onOpenSettings}>
                Translation API key missing — open settings
              </button>
            ) : null}
          </div>
          <div className="review-columns">
            <SentenceEditor
              segment={selected}
              showNotes={showNotes}
              generating={selected.status === 'generating'}
              adding={addingId === selected.id}
              previousText={previousText}
              nextText={nextText}
              onUpdate={onUpdateSegment}
              onGenerate={onGenerate}
              onAdd={(segment) => void handleAdd(segment, false)}
            />
            <div className="preview-column">
              <CardPreview segment={selected} mediaUrl={audio.mediaUrl} showNotes={showNotes} />
            </div>
          </div>
        </section>
      ) : null}

      {duplicatePrompt ? (
        <div className="modal-backdrop" onMouseDown={() => setDuplicatePrompt(null)}>
          <div
            className="duplicate-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Duplicate cards found"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">Duplicate check</p>
                <h2>This card may already exist</h2>
              </div>
              <button
                className="icon-button soft"
                onClick={() => setDuplicatePrompt(null)}
                aria-label="Close"
              >
                <CloseIcon width={17} height={17} />
              </button>
            </div>
            <p className="modal-copy">
              Anki already contains {duplicatePrompt.duplicates.length} note
              {duplicatePrompt.duplicates.length === 1 ? '' : 's'} matching this sentence or audio in
              <strong> {settings.anki.deck}</strong>.
            </p>
            <ul className="duplicate-list">
              {duplicatePrompt.duplicates.map((duplicate) => (
                <li key={duplicate.noteId}>
                  <span className="duplicate-id">#{duplicate.noteId}</span>
                  <span lang="ja">{duplicate.sentence || '(empty sentence)'}</span>
                  {duplicate.audioMatch ? <span className="match-tag">same audio</span> : null}
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button className="button ghost" onClick={() => setDuplicatePrompt(null)}>
                Cancel
              </button>
              <button
                className="button primary"
                onClick={() => {
                  const prompt = duplicatePrompt
                  setDuplicatePrompt(null)
                  void handleAdd(prompt.segment, true)
                }}
                disabled={addingId !== null}
              >
                Add anyway
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {bulkProgress ? (
        <div className="bulk-toast">
          <span className="tiny-spinner" />
          Generating {bulkProgress.done}/{bulkProgress.total}
        </div>
      ) : null}
    </div>
  )
}
